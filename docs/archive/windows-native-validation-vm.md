# 保留主机智能应用控制的原生开发环境方案

状态：**历史备选，未实施，不属于当前待办**。日期：2026-11-10。用户随后自行关闭主机 Smart App Control（SAC），决定回到本机原生构建与 E2E；实际结果以[项目状态](../project-status.md)为准。未启用 Hyper-V、创建虚拟机或购买签名服务。下文保留当时准备的隔离开发方案，不构成当前执行指令。

## 结论与必要前提

推荐 **Hyper-V 持久化 Windows 11 开发虚拟机**。主机继续编辑源码，构建、运行未签名程序及原生 E2E 全部在虚拟机内完成；不共享主机工作目录供来宾直接写入。

这是一种隔离开发方案，**不是让主机信任未签名文件的方法**。开发虚拟机必须允许未签名本地代码，SAC 不能处于会阻断这些代码的强制模式；Defender 防病毒、系统更新、Secure Boot 和 vTPM 保留。若主机和虚拟机都必须强制开启 SAC，需改用受信任公共 CA 签名，并覆盖编译时加载的宏 DLL、构建辅助 EXE 和最终产物。

官方 SAC 当前没有单应用/目录放行入口；本地自签名证书不满足其公共信任要求。不能把 Defender 排除项、开发者模式、改名或迁移缓存当作可靠解决方案。已有 App Control for Business 的定制策略与修改内置 SAC 策略也不是同一回事。依据：[SAC FAQ](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)、[签名要求](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)。

## 本机核验与配置建议

2026-11-10 只读检查：Windows 11 专业版，build 26300；i5-12400F，12 逻辑处理器；物理内存约 31.8 GiB、当时空闲 15.7 GiB；C 盘空闲约 191 GiB、D 盘约 161 GiB。Hyper-V、Sandbox 和 VirtualMachinePlatform 均为 Disabled；未发现本地代码签名证书。SAC 的 VerifiedAndReputableDesktop 策略处于 Enforced，注册表状态为 1。

HypervisorPresent 为 true；CIM 的 VirtualizationFirmwareEnabled/SLAT 同时返回 false。在已有 hypervisor 的环境下不能据此断言 BIOS 虚拟化关闭。启用功能前再核对系统要求及重启后的 Hyper-V 状态，不自动调整 BIOS 或关闭 VBS。

| 项目 | 推荐配置 |
| --- | --- |
| 名称与系统 | `AssetToolbox-Dev`；Windows 11 x64，优先稳定发行版，记录来宾具体 build |
| 虚拟硬件 | 第 2 代，4 vCPU，Secure Boot（Microsoft Windows 模板）、vTPM 2.0 |
| 内存 | 启动/最低 8 GiB，动态上限 12 GiB；主机压力大时关闭其他大型程序 |
| 存储 | 独立 100 GiB 动态 VHDX，建议 `C:\VMs\AssetToolbox-Dev\`；控制实际占用，保留至少 40 GiB 主机空闲空间 |
| 网络 | Hyper-V 默认 NAT 交换机；不建外部桥接，不向局域网开放 CDP 或远程管理端口 |
| 工作目录 | 来宾 `C:\work\AssetToolbox`，缓存与依赖保存在来宾磁盘 |
| 检查点 | 工具链配置完成后保留一个基线；源码/日志另行导出，避免持续累积检查点 |

Hyper-V 在 Windows 专业版受支持；第 2 代 Windows 11 VM 需要 Secure Boot/vTPM，参考[安装要求](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v)与[Windows 11 虚拟机要求](https://learn.microsoft.com/en-us/windows/whats-new/windows-11-requirements)。这里的 CPU、内存和磁盘数值是本项目建议，不是微软最低配置。

未选 Windows Sandbox：其关闭后丢弃环境，反复安装 MSVC/Rust 和下载依赖不适合持续开发。未选 WSL：不能代替本项目的 Windows WebView2 原生窗口验收。另购虚拟化产品或远程 CI 暂无必要。

## 分阶段实施

### 1. 安装介质、授权与主机功能

准备微软官方 Windows 11 x64 ISO，并核对适用于来宾的 Windows 许可；不默认主机激活即覆盖新增虚拟机。仅短期评估可考虑[Windows 11 Enterprise 90 天评估版](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise)，按官方评估条款和注册流程取得，不作为永久开发授权。

在实际实施时，以管理员 PowerShell 启用组件，先不自动重启：

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart
```

保存工作后安排主机重启，核对 Hyper-V 功能可用且 `CiTool.exe --list-policies --json` 中 SAC 仍为 Enforced。在 Hyper-V 管理器按上表新建来宾，不复用/覆盖已有磁盘。参考[创建虚拟机](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-machine-in-hyper-v)。

### 2. 来宾基线与源码传入

安装系统、更新与 WebView2，建立专用开发用户；确认来宾允许执行未签名开发代码。该前提若不获接受或无法满足，应停在此处，改走公共 CA 签名方案，不能悄悄调整主机 SAC。

主机只导出已核验的源码提交，不携带主机凭据、用户 data、构建缓存或历史备份分支。以下在仓库根目录执行；产物放在已忽略的 `.local/`：

```powershell
New-Item -ItemType Directory -Force .local/vm-transfer | Out-Null
git bundle create .local/vm-transfer/source.bundle main
git bundle verify .local/vm-transfer/source.bundle
git rev-parse main
Get-FileHash .local/vm-transfer/source.bundle -Algorithm SHA256
```

记录提交 ID 和 bundle 摘要，在来宾复核后用 `git clone C:\transfer\source.bundle C:\work\AssetToolbox` 建立独立副本。后续新轮次使用新 bundle 或只传已审查补丁，避免主客两边同时修改同一目录。

文件传输使用 Hyper-V PowerShell Direct 的 `Copy-Item -ToSession/-FromSession`，会话使用用户交互输入的来宾凭据；不把密码写入仓库。它不依赖给来宾开放网络管理端口，详见[官方流程](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/powershell-direct)。不挂载整个主机磁盘为来宾可写盘。

### 3. 来宾工具链与处理工具

按[开发指南](../development.md)安装 Git、Node 26.13.0、Rust 1.99.1 MSVC、`.vsconfig` 中的 C++ Build Tools 与 Windows SDK 26100，以及 WebView2 Runtime。执行版本检查，在 `resource-core/` 和 `desktop/` 分别运行 `npm ci`，不自动升级锁文件。

只传入必要的本地处理工具副本：pngquant、JPG-C、LAME 及其 DLL、FFmpeg/FFprobe；逐一比对[来源记录](../../third-party/provider-artifacts.json)和 SHA-256，不复制整个 data。Sharp 在来宾通过 npm ci 安装。完整原生综合测试需要这些工具，且会真实联网获取 LAME/Sharp 核验版本。

为了与当前核心验收一致，单独复制本地 `runtime/node.exe`（24.19.0）并核对摘要及 Node 许可文本。开发 Node 与便携运行时分别记录；不得让首次构建不知情地把便携运行时换成 26.13.0。第三方文件只作本地环境准备，不进入 Git 或公开下载附件；依据[来源与分发范围](../../THIRD_PARTY_NOTICES.md)执行。

### 4. 构建与真正的原生 E2E

在**已登录的来宾交互式桌面终端**执行，以提供真实 WebView2 桌面会话；PowerShell Direct 可传文件和做准备，但不把非交互远程会话当作 GUI 验收环境。所有命令逐项检查退出码，失败立即停止后续验收：

```powershell
# 来宾仓库根目录
.\runtime\node.exe --test resource-core/tests/*.test.js
Set-Location desktop
npm test
npm run typecheck
npm run build
Remove-Item Env:ASSET_TOOLBOX_AUDIO_BROWSER -ErrorAction SilentlyContinue
npm run test:e2e
```

`npm run build` 必须成功并刷新根 EXE，再执行默认原生路径的两个综合用例：`native.spec.ts` 和 `audio.spec.ts`。不使用浏览器替代变量、不更改安全断言、不把旧 EXE 或浏览器集成结果计入本轮原生通过。网络或桌面会话导致失败时先修环境，不跳过对应断言。

### 5. 证据、导出与后续开发

记录源码提交、主客系统 build、工具版本、命令退出码、测试数量、构建日志、EXE SHA-256/大小及原生截图。查看 1220×850、840×620 的音频结果浅色/深色截图，并验证原文件保护、峰值限制/拒绝、达标状态和依赖获取指引。

只将日志、截图、清单和 EXE 导出到主机独立 `.local/vm-validation/<轮次>/`，接收后比对 SHA-256。不自动覆盖主机根 EXE，也不导回来宾的配置、任务、node_modules 或凭据。更新[项目状态](../project-status.md)，把原生构建/E2E从未执行改为实际结果后再提交相关修复与文档。

**即使来宾验收成功，未签名 EXE 在主机上仍可能被 SAC 拦截。**当前方案的日常运行与调试也在来宾进行；若要回到开启 SAC 的主机直接运行或正式分发，另行接入受信任代码签名。虚拟机验收不等于主机 SAC 兼容验收。

## 原方案交接点（历史记录）

- 已完成：官方支持路径研究、本机资源与策略只读核验、具体配置及实施/验收步骤。
- 未执行：启用 Hyper-V、重启、获取 ISO、确认来宾授权、创建来宾、配置来宾 SAC 状态、安装工具链、原生构建/E2E。
- 开始实施前需要落实：来宾安装介质与许可、可重启窗口，以及接受“主机 SAC 保持强制、开发来宾允许未签名代码”的边界。尚无已安装环境或成功原生产物。
