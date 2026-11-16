# 版本与 GitHub Release 流程

状态：已实现源码发布工作流；实际远端运行证据见[项目状态](project-status.md)。当前仓库保持私有，Release 仅提供 GitHub 自动生成的源码 ZIP/tar.gz，不发布 EXE、依赖或便携包。二进制放行另见[分发核对](distribution.md)。

## 版本规则

全项目采用一个产品版本，权威来源为根 `VERSION`。`resource-core`、`desktop`、`agent-mcp` 的 package.json/锁文件、Tauri 配置及 Cargo 清单/锁文件必须一致，用脚本同步，不逐个手改。提供方版本、适配器版本、API/schema 版本继续独立管理，产品版本不代替协议的升级/拒绝策略。

MCP stdio 与 HTTP 的服务端版本声明读取 `agent-mcp/package.json`，不再写死版本；部署和测试副本必须携带该文件。

采用 [SemVer](https://semver.org/lang/zh-CN/) 的含义，并限定标签形式：

| 变更 | 版本与提交示例 |
| --- | --- |
| 兼容的缺陷修复、安全修复 | PATCH：`1.2.3 → 1.2.4`，`fix(core): …` |
| 兼容的新功能、明显功能改进 | MINOR：`1.2.3 → 1.3.0`，`feat(desktop): …` |
| 破坏 CLI/应用契约、拒绝原可读取的数据格式、删除能力 | MAJOR：`1.2.3 → 2.0.0`，`feat(core)!: …` 并描述影响 |
| 试用、联调、候选验收 | `1.3.0-alpha.1`、`1.3.0-beta.1`、`1.3.0-rc.1`，序号从 1 开始 |

Git 标签为 `v` 加完整版本，例如 `v1.3.0-rc.1`。不使用日期版本、前导零或 `+build` 后缀。CI 保证格式、一致性和递增；变更应升哪一级由维护者根据实际兼容性判断，不能仅按提交类型自动推断。产品升级即使为新项目也不能悄悄绕过已有格式拒绝约定。

当前已有清单中的 `1.0.0` 是历史开发标记，不代表已发布。建立流程时没有远端版本标签。首次建议准备 `1.0.0-rc.1`，验收后发布 `1.0.0`；本次配置流程不自动打标签或创建试验 Release。首个标签定义当前应用 /8 等契约的产品基线，此前开发历史不反推为若干已发布版本。

## 何时发布

- 功能形成可独立使用的增量，相关测试、文档与兼容性说明闭合后发布；不是每个提交都发布。
- 普通功能可先发 RC 给仓库协作者试用；阻断使用或文件安全缺陷修复后尽快发 PATCH。
- 纯文档/测试/CI 改动通常随下一产品版本合并发布；确需单独源码快照时仍说明目的并递增 PATCH。
- 当前只维护一条版本线，按顺序发布一个候选版本；新标签必须高于仓库全部既有 `v*` 标签，包含预发布及发布失败但保留的标签。暂不支持旧主版本并行维护。

## 工作流与门槛

1. `.github/workflows/source.yml`：分支 push、PR、手动运行及 `workflow_call` 共用同一套源码验证，包含版本一致性、发布工具回归、核心 source、MCP、前端组件/生产构建、文档与源码分发检查。完整 fetch 历史，避免只审查浅克隆。
2. `.github/workflows/release.yml`：仅 `v*` 标签 push 触发，先调用上述 CI，再检查标签等于 VERSION、标签提交等于检出提交、提交已进入 `origin/main`、版本递增及版本说明完整。
3. 发布步骤重新确认远端标签未移动、仓库为 private，再创建 GitHub Release；正文来自人工审核的版本说明，补充提交 SHA 和当前 Actions 链接。预发布设置 `prerelease=true` 且不替换 Latest；正式版使用 GitHub 的版本排序策略。

普通 CI 为 `contents: read`；仅发布 job 为 `contents: write`，写令牌只注入发布步骤。Actions 固定完整 SHA、checkout 不保存凭据；不需要 PAT、新的组织密钥、自动 npm 发布或上传构建目录。发布 job 不执行 npm 安装脚本。使用 [GitHub 的可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)和 [Release REST API](https://docs.github.com/en/rest/releases/releases)。

GitHub 托管 CI 只覆盖源码层，不能声称完成真实编码器或原生验收。涉及桌面、Rust、桥接或版本元数据时，发布前在本机重新构建并跑原生 E2E；涉及提供方再跑真实编码器和必要的联网安装测试。结果写入版本说明并链接验证记录，未运行项明确列出。云端不能自动核验本机记录的真实性，维护者负责审核；无需为了 CI 上传本地第三方 EXE。

## 准备与发布操作

以下命令均从仓库根执行，使用 `.nvmrc` 对应 Node。工作区先整理干净，拉取最新 main 与标签；版本号只是示例，实际取决于上面的规则。

```powershell
git fetch origin --tags
git switch main
git pull --ff-only
git switch -c codex/release-1.0.0-rc.1
node scripts/version.mjs --set 1.0.0-rc.1
node scripts/version.mjs --check
node --test scripts/tests/*.test.mjs
```

随后：

1. 按[版本说明模板](releases/README.md)新增 `docs/releases/1.0.0-rc.1.md`，补齐变更、兼容性、实际验证和获取限制。更新对应专题与项目状态。不要用占位说明发布。
2. 按[测试分层](testing.md)执行本轮范围的检查，尤其在最终版本号下构建新 EXE 并验收。检查版本脚本只修改产品自身版本，没有改动依赖版本。
3. 提交 `chore(release): 准备 v1.0.0-rc.1`，通过 PR 合并 main（单维护者直接提交也必须满足相同检查）。确认 main CI 成功。
4. 在最终 main 提交打带注释标签，并进行本地门槛检查，再只推送该标签：

```powershell
git switch main
git pull --ff-only
git fetch origin --tags
git tag -a v1.0.0-rc.1 -m "release: v1.0.0-rc.1"
node scripts/release.mjs --check v1.0.0-rc.1
if ($LASTEXITCODE -ne 0) { throw '发布检查失败，停止推送' }
git push origin refs/tags/v1.0.0-rc.1
```

本地 `--check` 不发网络请求、不发布 Release。正式发布命令 `--publish` 只接受匹配的 GitHub Actions 标签 push 上下文。推送标签是发布意图，不需要再从网页手动创建 Release。

5. 在仓库 Actions 确认“源码版本发布”成功，核对 Releases 页面版本、预发布标记、提交与说明，确认只有自动源码下载项；保持仓库 private。发布后不改标签或已发布版本说明源文件，修正行为发布新版本。

建议维护者启用 main 的 PR/必需检查、标签禁止删除/强推和不可变 Release；是否可用取决于仓库套餐及设置。本轮工作流不会自动修改这些仓库级规则，也不宣称它们已启用。

## 失败、重试与撤回

- 任一检查失败，不创建 Release。先区分网络/runner 故障与源码问题；同一提交的基础设施失败可在 Actions 选择重新运行，不能通过修改标签绕过失败。
- API 暂时失败可重跑；若请求实际已成功但响应丢失，脚本核对同标签的提交标记、说明和预发布类型后一致即退出，不重复创建、不上传覆盖附件。
- 遇到人工创建的同名 Release、草稿、说明或提交不匹配，脚本明确拒绝；维护者调查后处理，不自动删除重建。
- 已推送标签发现代码、版本或说明错误，保留历史，准备更高版本修复；不要删除/强推旧标签。重大安全问题可在 GitHub 将旧版本标为不建议使用并提供修复版链接，不能靠静默重打包回滚用户数据。
- 本地正式版切回旧版本仍须遵守旧应用对配置/任务格式的拒绝规则。Release 管理不执行数据迁移或恢复。

## 未来便携包

待依赖许可、运行时和组件声明闭合后，单独设计 Windows 构建/签名、产物哈希、原生验收及附件上传 job，再放开 `--portable`。当前流程不生成或分发可运行软件包，GitHub Source code 下载后仍需按[开发指南](development.md)安装依赖和构建。
