# 前端设计

源码入口：`desktop/src/App.vue`、`StepEditor.vue`、`ParameterFields.vue`、`RestoreTable.vue`、`model.ts`、`types.ts`、`api.ts`。Vue 3 Composition API，TypeScript 严格模式；当前无全局状态库或独立路由库。

## 页面与模型

App 维护处理资源、任务历史、备份恢复三个工作区及当前单一作业。`bootstrap` 返回 Configuration 与 Definition：资源类型、操作、提供方分开描述。前端不内置编码器参数表，按 schema 返回的字段渲染；本地 createStep 从目录找到支持关系并填默认参数。

StepEditor 编辑资源类型、操作、提供方、启用状态以及两个参数命名空间。切换组合会重建参数，保留步骤 ID 和开关；上移/下移改变执行顺序，删除只移除该步骤。ParameterFields 支持整数、小数、布尔、枚举、文本。禁用步骤仍保留并校验参数；空数值暂存为空串，提交时由核心拒绝。最多 64 步；恢复默认参数不改变路径、选择、顺序和启用状态。

## 请求与进度

`processingRequest()` 将 Configuration 转为 preview/process 请求，携带 pipeline；另存才传 outputDir，覆盖且启用备份才传 backupDir。开始处理先 normalize，再 save，保存失败显示提示但继续本次操作。预览不保存。

start 返回会话 ID，App 每 250ms poll；提交中/运行中禁用相关输入，取消通过当前会话发送。作业期间切换页面仍可取消；完成卡片只显示在所属工作区。扫描完成后用扫描结果替代进度卡。关闭结果只隐藏界面，不删除持久记录。体积变化负值用“−”显示，不能假定所有操作都节省空间。

窗口关闭请求先取消正在运行的作业，待 done 再关闭；桥接确保工作进程已退出。bootstrap 错误显示处理配置错误，任务和恢复入口仍可使用。目录选择和报告打开由 api.ts 调用 Tauri，不在浏览器执行文件 IO。

## 历史和恢复

任务历史采用核心返回的 canResume/canRetry/canRestore 等能力标记；继续/重试只传 taskFile，不使用当前表单。恢复前获得文件状态与哈希，RestoreTable 独立维护勾选及搜索筛选；隐藏的已选项仍保留并提示数量。空选择不能启动恢复。提交显式 `{path, backupHash, targetHash}` 清单，由后端再次核对。

## 验证

Vitest + Vue Test Utils + jsdom 验证动态字段、默认值重置、请求、恢复勾选和跨页作业。原生 Playwright 用构建后的 EXE 与独立便携副本验证动态扩展、中文路径、缩放步骤排序/删除、真实输出、配置重启、取消/续跑/重试/恢复与关闭。截图保存在 `desktop/test-results/`，不提交。

## 提供方获取界面

ProviderInventory 展示全部提供方，不要求先创建对应步骤。缺失项默认展开，显示原因、获取链接、文件安装位置、核验版本和许可提示；已安装项可折叠。刷新只读调用 providers，不重置配置。获取链接调用原生 open_provider_source，并由核心根据 ID 解析地址。未启用的缺失提供方不阻塞处理；启用时在步骤卡片提示并禁用开始按钮。
