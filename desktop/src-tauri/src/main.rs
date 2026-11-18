#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}};
#[cfg(windows)] use std::os::windows::process::CommandExt;

struct Bridge { child: Child, input: Option<ChildStdin>, output: BufReader<ChildStdout>, sequence: u64 }
fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}
fn tool_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let installed = exe.parent().ok_or("无法定位程序目录")?;
    if installed.join("resource-core/desktop-bridge.js").is_file() { return Ok(installed.to_path_buf()); }
    #[cfg(debug_assertions)] {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        if development.join("resource-core/desktop-bridge.js").is_file() { return development.canonicalize().map_err(|e| e.to_string()); }
    }
    Err("请把程序放在包含 resource-core 和 runtime 的工具目录中。".into())
}
impl Bridge {
    fn start() -> Result<Self, String> {
        let root = tool_root()?;
        let mut command = Command::new(root.join("runtime/node.exe"));
        let mut child = hidden(&mut command).arg(root.join("resource-core/desktop-bridge.js")).current_dir(&root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| format!("无法启动内置 Node.js：{e}"))?;
        let input = child.stdin.take().ok_or("无法建立输入通道")?;
        let output = BufReader::new(child.stdout.take().ok_or("无法建立输出通道")?);
        Ok(Self { child, input: Some(input), output, sequence: 0 })
    }
    fn call(&mut self, action: &str, payload: Value) -> Result<Value, String> {
        let input = self.input.as_mut().ok_or("核心通信中断，正在等待旧会话退出")?;
        self.sequence += 1;
        let message = json!({"id":self.sequence,"action":action,"payload":payload});
        let mut line = String::new();
        let received = writeln!(input, "{message}")
            .and_then(|_| input.flush())
            .and_then(|_| self.output.read_line(&mut line));
        match received {
            Ok(0) => { self.input.take(); return Err("核心通信中断，响应管道已关闭".into()); }
            Err(error) => { self.input.take(); return Err(format!("核心通信中断：{error}")); }
            Ok(_) => {}
        }
        let answer: Value = serde_json::from_str(&line).map_err(|e| format!("核心响应无效：{e}"))?;
        if answer["id"].as_u64() != Some(self.sequence) { return Err("核心响应序号不匹配".into()); }
        if answer["schema"].as_str() != Some("asset-toolbox.response/8") { return Err("核心接口版本不匹配，需要应用接口 /8".into()); }
        if answer["ok"].as_bool() != Some(true) {
            return Err(format!("{}：{}", answer["error"]["code"].as_str().unwrap_or("INVALID_REQUEST"), answer["error"]["message"].as_str().unwrap_or("核心请求失败")));
        }
        Ok(answer["result"].clone())
    }
}
struct Host { bridge: Arc<Mutex<Option<Bridge>>>, closing: Arc<AtomicBool> }
#[tauri::command]
async fn core_call(host: tauri::State<'_, Host>, action: String, payload: Value) -> Result<Value, String> {
    // 同步 stdio 放到阻塞线程池，避免阻塞 WebView 和原生窗口事件。
    let shared = host.bridge.clone();
    let closing = host.closing.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared.lock().map_err(|_| "核心会话锁异常")?;
        if closing.load(Ordering::SeqCst) { return Err("应用正在退出".into()); }
        // 只在旧桥接已退出后建立新会话。已发出但丢失响应的命令可能已执行，不能重放。
        if let Some(bridge) = guard.as_mut() {
            if bridge.child.try_wait().map_err(|e| e.to_string())?.is_some() { *guard = None; }
        }
        if guard.is_none() { *guard = Some(Bridge::start()?); }
        guard.as_mut().unwrap().call(&action, payload)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_report(host: tauri::State<'_, Host>, id: String) -> Result<(), String> {
    let result = core_call(host, "report".into(), json!({"jobId":id})).await?;
    let directory = result.as_str().ok_or("没有报告目录")?;
    hidden(&mut Command::new("explorer.exe")).arg(directory).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn open_provider_source(host: tauri::State<'_, Host>, id: String) -> Result<(), String> {
    let result = core_call(host, "provider-source".into(), json!({"id":id})).await?;
    let url = result.as_str().ok_or("没有获取地址")?;
    if !url.starts_with("https://") || url.chars().any(|c| c.is_control()) { return Err("获取地址必须使用 HTTPS".into()); }
    hidden(&mut Command::new("rundll32.exe")).args(["url.dll,FileProtocolHandler", url]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
/// 在资源管理器中打开文件夹。只接受绝对路径且必须是现有文件夹：把文件交给 explorer 会按关联程序打开它。
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    if !target.is_absolute() || path.chars().any(|c| c.is_control()) { return Err("文件夹路径无效".into()); }
    if !target.is_dir() { return Err(format!("文件夹不存在或已被移动：{path}")); }
    hidden(&mut Command::new("explorer.exe")).arg(target).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
/// 拖入窗口的路径是否为现有文件夹；只读判断，不访问内容。
#[tauri::command]
fn is_directory(path: String) -> bool { std::path::Path::new(&path).is_dir() }
fn main() {
    let mut context = tauri::generate_context!();
    // WebView2 150+ 的提升权限进程忽略环境中的 Chromium 参数；测试端口须通过原生 API 设置。
    // 仅显式提供本地测试端口时启用，普通启动不监听任何端口。
    if let Some(port) = std::env::var("ASSET_TOOLBOX_TEST_PORT").ok().and_then(|value| value.parse::<u16>().ok()).filter(|port| *port > 0) {
        if let Some(window) = context.config_mut().app.windows.first_mut() {
            window.additional_browser_args = Some(format!("--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"));
            window.visible = false;
        }
    }
    let bridge = Arc::new(Mutex::new(None));
    let closing = Arc::new(AtomicBool::new(false));
    let exit_ready = Arc::new(AtomicBool::new(false));
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .manage(Host { bridge: bridge.clone(), closing: closing.clone() })
        .invoke_handler(tauri::generate_handler![core_call, open_report, open_provider_source, is_directory, open_folder])
        .build(context).expect("无法启动资源工具箱窗口")
        .run(move |app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !exit_ready.load(Ordering::SeqCst) { api.prevent_exit(); }
                if !closing.swap(true, Ordering::SeqCst) {
                    let shared = bridge.clone();
                    let handle = app.clone();
                    let ready = exit_ready.clone();
                    tauri::async_runtime::spawn(async move {
                        // 关闭输入触发统一上下文退出，等待全部自有作业到达文件边界。
                        let _ = tauri::async_runtime::spawn_blocking(move || {
                            if let Ok(mut guard) = shared.lock() {
                                if let Some(Bridge { mut child, input, output, .. }) = guard.take() {
                                    drop(input);
                                    drop(output);
                                    let _ = child.wait();
                                }
                            }
                        }).await;
                        ready.store(true, Ordering::SeqCst);
                        handle.exit(0);
                    });
                }
            }
        });
}
