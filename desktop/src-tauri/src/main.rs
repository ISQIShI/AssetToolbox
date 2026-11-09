#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex}};
#[cfg(windows)] use std::os::windows::process::CommandExt;

struct Bridge { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, sequence: u64 }
fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}
fn tool_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let installed = exe.parent().ok_or("无法定位程序目录")?;
    if installed.join("resCompress/desktop-bridge.js").is_file() { return Ok(installed.to_path_buf()); }
    #[cfg(debug_assertions)] {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        if development.join("resCompress/desktop-bridge.js").is_file() { return development.canonicalize().map_err(|e| e.to_string()); }
    }
    Err("请把程序放在包含 resCompress 和 runtime 的工具目录中。".into())
}
impl Bridge {
    fn start() -> Result<Self, String> {
        let root = tool_root()?;
        let mut command = Command::new(root.join("runtime/node.exe"));
        let mut child = hidden(&mut command).arg(root.join("resCompress/desktop-bridge.js")).current_dir(&root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| format!("无法启动内置 Node.js：{e}"))?;
        let input = child.stdin.take().ok_or("无法建立输入通道")?;
        let output = BufReader::new(child.stdout.take().ok_or("无法建立输出通道")?);
        Ok(Self { child, input, output, sequence: 0 })
    }
    fn call(&mut self, action: &str, payload: Value) -> Result<Value, String> {
        if self.child.try_wait().map_err(|e| e.to_string())?.is_some() { return Err("核心进程已退出，请重新打开工具；未完成文件可从任务历史继续。".into()); }
        self.sequence += 1;
        let message = json!({"id":self.sequence,"action":action,"payload":payload});
        writeln!(self.input, "{message}").and_then(|_| self.input.flush()).map_err(|e| e.to_string())?;
        let mut line = String::new();
        if self.output.read_line(&mut line).map_err(|e| e.to_string())? == 0 { return Err("核心通信中断，请重新打开工具。".into()); }
        let answer: Value = serde_json::from_str(&line).map_err(|e| format!("核心响应无效：{e}"))?;
        if answer["id"].as_u64() != Some(self.sequence) { return Err("核心响应序号不匹配".into()); }
        if let Some(error) = answer["error"].as_str() { return Err(error.into()); }
        Ok(answer["result"].clone())
    }
}
struct Host(Arc<Mutex<Option<Bridge>>>);
#[tauri::command]
async fn core_call(host: tauri::State<'_, Host>, action: String, payload: Value) -> Result<Value, String> {
    // 同步 stdio 放到阻塞线程池，避免阻塞 WebView 和原生窗口事件。
    let shared = host.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared.lock().map_err(|_| "核心会话锁异常")?;
        if guard.is_none() { *guard = Some(Bridge::start()?); }
        guard.as_mut().unwrap().call(&action, payload)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_report(host: tauri::State<'_, Host>, id: String) -> Result<(), String> {
    let result = core_call(host, "report".into(), json!({"id":id})).await?;
    let directory = result.as_str().ok_or("没有报告目录")?;
    hidden(&mut Command::new("explorer.exe")).arg(directory).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
fn main() {
    let mut context = tauri::generate_context!();
    // WebView2 150+ 的提升权限进程忽略环境中的 Chromium 参数；测试端口须通过原生 API 设置。
    // 仅显式提供本地测试端口时启用，普通启动不监听任何端口。
    if let Some(port) = std::env::var("RESOURCE_COMPRESSOR_TEST_PORT").ok().and_then(|value| value.parse::<u16>().ok()).filter(|port| *port > 0) {
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.additional_browser_args = Some(format!("--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"));
            window.visible = false;
        }
    }
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .manage(Host(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![core_call, open_report])
        .run(context).expect("无法启动资源压缩窗口");
}
