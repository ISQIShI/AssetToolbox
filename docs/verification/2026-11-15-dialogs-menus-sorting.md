# 确认对话框、右键菜单与步骤排序验收

日期：2026-11-15。基线 `5db1495`。用户要求在引入 Reka UI 之后把这一轮界面改造做完；外观令牌、核心、协议与数据格式不变。决策见 [ADR 0018](../decisions/0018-headless-ui-primitives.md)。

## 变更与边界

- **确认对话框**（`ConfirmDialog.vue`，Reka AlertDialog）：只用于无法撤销的操作——删除步骤；覆盖原文件且未启用备份时开始处理。状态在工作台 `bench.confirmation`，取消时不保存配置、不提交作业。
- **步骤右键菜单**（`StepMenu.vue`，Reka ContextMenu）：上移、下移、停用/启用、删除步骤…；打开时选中该步骤。命令仍由工作台执行，删除同样先确认。
- **步骤排序**：按住拖动（指针事件，自己实现，未用 HTML5 拖放或排序库）与 `Alt+↑` / `Alt+↓`。新增 `bench.moveStepTo`、`bench.toggleStep`。
- **添加步骤选择器定位**：改用 `@floating-ui/dom` 1.8.0（原为 Reka 的传递依赖，提升为直接依赖并精确锁定）；选择器本身未迁移。
- **折叠面板**：所有 `details` 增加 0.15 秒高度过渡，纯 CSS。
- 新增令牌 `--scrim`；新增 `.menu-*`、`.dialog*`、`.button.danger-solid` 共享样式；新增图标 `power`。
- 没有改动：权限、作业生命周期、请求构造、Tauri 窗口与拖放配置。

## 实际验证

Windows x64，开发 Node 26.13.0，便携 Node 24.19.0，仓库锁定 Rust 工具链。测试使用生成素材、隔离核心与独立配置，没有操作真实素材。

| 工作目录 / 命令 | 结果 |
| --- | --- |
| desktop：`npm test` | 8 个文件、60 项通过；新增 3 项（不备份覆盖的确认、键盘排序与选中保持、`moveStepTo`/`toggleStep`），删除步骤用例补充“取消保留、确认才删” |
| desktop：`npm run typecheck` | 通过；原生构建内再次执行通过 |
| desktop：`npm audit` | 0 项漏洞 |
| desktop：`npm run build` | Vite、Rust release（约 1 分 23 秒）及便携 Sharp 校验通过；前端 JS 334.8 kB，CSS 45.8 kB |
| desktop：`npm run test:e2e` | 新 EXE 3 项通过，约 1.1 分钟。综合用例新增：真实鼠标拖拽把第一步拖到第二步下方、右键菜单“上移”移回、两处删除步骤经确认对话框 |
| 浏览器模拟核心 | 1100×760 下查看：右键菜单内容与选中联动、拖拽中的实时重排与结束状态、确认对话框（默认焦点在“取消”）、选择器定位；无控制台错误 |
| 根目录：`node scripts/check-docs.cjs` | 通过，无失效链接 |
| 根目录：`node scripts/check-release.mjs --source` | 通过，未包含第三方二进制 |
| 根目录：`git diff --check` | 通过 |

最终 EXE 为 9,116,672 字节，SHA-256 `8919fd2f8e80a5ae00f9abd5f422ae64d239494b76ff09ac0938699b34b6aa50`，只留本地。

预览核对中发现并修复一个缺陷：拖拽结束后用于吞掉“松开即点击”的拦截器，在没有随后点击发生时会留存并吞掉下一次无关点击；现改为下一轮事件循环自动撤销。

## 未执行与限制

- 核心全量、MCP 独立包、联网 E2E 未运行：本轮没有修改对应代码。
- “不备份覆盖”的确认只有组件测试覆盖，原生用例里的覆盖处理都启用了备份。
- 对话框与菜单的键盘操作（Tab 循环、Esc、方向键）由 Reka UI 实现，没有逐项自动化用例，也没有在原生窗口里人工逐项确认。
- 拖拽排序不会在处理线滚动区边缘自动滚动；步骤很多时跨屏移动用键盘或右键菜单。深色外观下的对话框与菜单只依赖令牌，本轮没有单独截图核对。
- 折叠动画依赖 `::details-content` 与 `interpolate-size`（Chromium 131 及以上）；更旧的 WebView2 会直接展开，不影响功能。
