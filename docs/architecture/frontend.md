# 前端架构

源码位于 `desktop/src/`。Vue 3 Composition API，TypeScript 严格模式，无路由库和全局状态库。视觉、布局、文案规则见[前端设计规范](../design/frontend-design.md)；本页说明代码结构、状态流转和与核心的请求映射。

## 源码结构

| 路径 | 职责 |
| --- | --- |
| `main.ts` | 挂载应用，引入 IBM Plex 字体与全局样式 |
| `App.vue` | 窗口外壳：顶栏标签、全局提示、当前工作区、作业栏；注册原生关闭事件 |
| `core/types.ts` | 与桥接协议一一对应的类型 |
| `core/api.ts` | 唯一调用 Tauri 的位置：`core_call`、目录对话框、打开报告、打开获取页面 |
| `core/model.ts` | 纯函数：请求构造、步骤生成与切换、格式化、恢复勾选、任务状态 |
| `core/workbench.ts` | 工作台状态与全部动作：初始化、配置、作业生命周期、处理/任务/恢复操作 |
| `core/preview-core.ts` | 仅浏览器调试使用的模拟核心，生产构建不包含 |
| `views/ProcessView.vue` | 处理页：处理线 + 站点编辑器 + 运行栏 |
| `views/TasksView.vue` | 任务页：任务列表与详情 |
| `views/RestoreView.vue` | 恢复页：选择备份来源并检查 |
| `views/ToolsView.vue` | 工具页：处理工具可用性、获取渠道、识别类型 |
| `components/PipelineRail.vue` | 处理线与添加步骤菜单 |
| `components/StepEditor.vue` | 单个步骤：组合、启用、两组参数、排序、删除 |
| `components/ParameterFields.vue` | 按字段描述渲染参数控件 |
| `components/PathField.vue` | 路径输入与原生选择 |
| `components/ScanSummary.vue` | 扫描结果 |
| `components/RestoreTable.vue` | 恢复检查结果的筛选、搜索、勾选、分页 |
| `components/JobDock.vue` | 底部作业栏 |
| `styles/tokens.css`、`styles/base.css` | 设计令牌与共享控件；组件布局写在各自的 scoped 样式中 |

## 工作台状态

`App.vue` 调用 `createWorkbench()` 并通过 `provide(workbenchKey)` 交给所有视图，视图用 `useWorkbench()` 取得。每次挂载 App 创建一份新状态，组件测试因此互不影响。

| 状态 | 说明 |
| --- | --- |
| `page` | 当前工作区：`process` / `tasks` / `restore` / `tools` |
| `boot`、`config`、`definition` | `bootstrap` 结果；`config` 是可编辑副本，先复制原始响应再放进响应式状态 |
| `station` | 处理线选中的站点：`source`、`output`、`scan` 或 `step:<步骤 ID>` |
| `scan`、`scanStale` | 最近一次扫描结果；当前配置生成的请求与扫描时不同即视为过期 |
| `tasks`、`selectedTaskFile` | 任务摘要与任务页选中项 |
| `restoreSource`、`restorePreview`、`restoreScope` | 恢复来源（任务或独立备份）、检查结果、默认勾选范围 |
| `job`、`submitting`、`closing` | 当前作业、start 请求进行中、窗口正在安全关闭 |
| `missingProviders`、`blockedSteps` | 缺依赖的工具；启用了缺依赖工具的步骤 |

处理页运行栏根据当前配置实时显示写入策略，点击只切换到 `output` 站点，不保存配置或启动作业；缺依赖入口只切换到工具页。处理线添加菜单关闭时恢复按钮焦点。容器查询负责步骤表单布局，不参与核心参数转换。

视图不直接调用 `call('start')`。所有作业都经 `launch(request, kind, title, onDone)` 启动。

## 作业生命周期

```mermaid
stateDiagram-v2
    [*] --> 提交中: launch()
    提交中 --> 运行中: start 返回 id
    提交中 --> [*]: start 失败，显示错误
    运行中 --> 运行中: 每 250ms poll
    运行中 --> 等待结束: cancelJob() 或关闭窗口
    等待结束 --> 已结束: poll 返回 done
    运行中 --> 已结束: poll 返回 done
    已结束 --> [*]: 预览类且拿到结果，自动收起
    已结束 --> [*]: 用户关闭作业栏
```

- `busy` 为真（提交中或作业未结束）时，所有会改变配置或启动作业的控件停用；导航、查看和取消仍可用。
- 在 start 返回前点击取消会记录待取消，拿到 ID 后立即发送 `cancel`。
- 作业结束后执行 `onDone` 回调并刷新任务列表。`preview` 和 `restore-check` 两类在 `state.preview` 存在时清除 `job`，结果由页面显示；出错时保留作业栏。
- 窗口关闭：有作业时阻止关闭，设 `closing` 并取消；poll 收到 done 后再调用原生 `close()`。桥接保证工作进程已退出。
- 作业栏在任何页面都显示，直到用户关闭。关闭只清除前端状态，不删除任务或报告。

## 请求映射

| 界面动作 | 请求 | 说明 |
| --- | --- | --- |
| 启动 | `bootstrap`、`tasks` | 处理配置加载失败时仍可使用任务和恢复 |
| 保存配置 | `save` | 成功后用返回值替换当前配置 |
| 扫描预览 | `normalize` → `start {mode:'preview'}` | 不保存配置；结果写入 `scan` 并选中“扫描结果”站点 |
| 开始处理 | `normalize` → `save` → `start {mode:'process'}` | 保存失败显示提示，但本次仍处理 |
| 刷新依赖状态 | `providers` | 只替换目录中的工具列表，不重置配置 |
| 打开获取页面 | 原生 `open_provider_source({id})` | 前端只传 ID，地址由核心解析 |
| 继续未完成 / 重试失败项 | `start {mode:'resume'/'retry', taskFile}` | 不使用当前表单 |
| 检查备份（任务） | `start {mode:'restore-preview', taskFile}` | 继续上次恢复、重试恢复失败项同样请求，只是默认勾选范围不同 |
| 检查独立备份 | `start {mode:'restore-export-preview', backupDir, outputDir}` | 两个路径都必填 |
| 恢复所选 | `start {mode:'restore' 或 'restore-export', …, selection}` | 始终显式传 `{path, backupHash, targetHash}` 数组，空选择不能提交 |
| 取消 | `cancel {id}` | 协作取消，在文件边界生效 |
| 打开报告 | 原生 `open_report({id})` | Rust 校验报告目录属于本次作业 |

`processingRequest()` 负责把配置转换为请求：去除路径首尾空白和引号；另存只传 `outputDir`；覆盖且启用备份才传 `backupDir`；缺少必填路径时在发送前报错。

## 步骤编辑

- 添加步骤菜单列出目录中所有“资源类型 + 操作”组合（`stepChoices`），选择后用默认工具和默认参数创建步骤并选中它。最多 64 步。
- 切换资源类型、操作或工具时由 `retargetStep` 重建两组参数，保留步骤 ID 和启用状态。
- “恢复默认参数”只重置当前步骤的参数（`resetStep`），不改变组合、顺序和启用状态。
- 停用的步骤仍保存参数，参数控件只读。数值框清空时暂存空串，由核心在 `normalize` 时拒绝。
- 删除步骤后选中相邻步骤；没有步骤时回到“来源”。

## 恢复勾选

`RestoreTable` 独立维护勾选集合。筛选和搜索只改变显示，被隐藏的已勾选项保留并提示数量。重新检查后，之前出现过的可选文件沿用用户勾选，新出现的文件按范围（全部 / 上次未完成 / 上次失败）默认勾选。冲突和已恢复文件不可勾选；检查被取消时整表只读。

## 验证

| 层级 | 文件 | 覆盖 |
| --- | --- | --- |
| 组件与模型 | `desktop/tests/ui.test.ts` | 动态参数及命名空间、组合切换、停用只读、缺依赖提示；恢复筛选与勾选、范围预选、取消后只读；工具页渠道与刷新；请求构造、体积格式、组合列表、任务状态 |
| 应用流程 | `desktop/tests/app.test.ts` | 扫描结果归位与过期、跨页取消、作业栏持久与关闭、预览错误、缺依赖拦截、添加/排序/删除步骤、续跑与重试请求、任务恢复与独立备份请求 |
| 原生 | `desktop/tests/native.spec.ts` | 构建后的 EXE：工具缺失与恢复、动态扩展参数、840×620 无横向滚动、扫描、另存、覆盖备份、跨页取消、续跑、重试、选择性恢复、真实图片缩放、配置重启、运行中关闭 |

测试只依赖语义选择器、`data-station`、`data-step-id`、`data-provider-id` 以及作业栏的 `data-job-id`、`data-state`。调整样式类名时保持这些钩子。截图保存在 `desktop/test-results/`，不提交。
