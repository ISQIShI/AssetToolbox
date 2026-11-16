# ADR 0018：用无样式组件库提供浮层与选择行为

状态：已采用。日期：2026-11-15。

关联：[前端设计规范](../design/frontend-design.md)、[前端架构](../architecture/frontend.md)、[ADR 0006](0006-desktop-application-shell.md)、`desktop/src/components/SelectBox.vue`、`desktop/src/components/Tip.vue`、`desktop/package.json`。

## 背景与约束

ADR 0006 之后界面的外观全部由项目自己的令牌和样式决定，没有使用组件库。外观已经统一，短板在行为：

- 下拉框是原生 `<select>`，弹出的列表由 Chromium 绘制，字号、圆角、分组标题和深色外观都不受令牌控制，是界面里最后一块“浏览器控件”。
- 提示用 `title` 属性：延迟长、样式是系统的、不能标注快捷键，键盘聚焦时不出现。
- 之后要做的确认对话框、右键菜单等都需要焦点管理、键盘导航和浮层定位，自己写成本高且容易出可访问性问题。

约束：不改变设计令牌与外观主张；不放宽 CSP；不改变核心、协议和数据格式；组件测试与原生 E2E 的行为断言保持不变；新增依赖须登记来源与许可。

## 决定

- 引入 **Reka UI 2.11.0**（MIT，精确锁定版本）作为无样式的行为层。它只提供交互、ARIA 和浮层定位，不带任何视觉样式。
- 不直接在视图里使用 Reka 组件，而是封装成项目自己的组件，视图只依赖封装的接口：
    - `SelectBox.vue`：下拉选择。接口是 `modelValue`、`options`（可含分组）、`id`、`disabled`、`placeholder`。替换全部 10 处原生 `<select>`。
    - `Tip.vue`：提示。接口是 `text`、`shortcut`、`side`。替换按钮上的 `title`。
- 浮层由 Reka 挂到 `body`，样式写在 `styles/base.css` 的 `.select-popup`、`.select-item`、`.tooltip` 中，只引用令牌。
- 按需求逐个引入：本次只做 Select 和 Tooltip。对话框、右键菜单、折叠等在有实际需求时再封装，不预先铺开。
- 按钮、输入框、勾选框、表格等没有复杂行为的控件继续自写，不换成库组件。

明确不包含：带外观的组件库（Element Plus、Naive UI 等）；把现有“添加步骤”选择器迁移到 Reka；主题系统变更。

## 备选方案与取舍

- **带外观的组件库**：开箱即用，但默认外观是网页后台的样子，要压到本项目的桌面密度需要大量覆盖，并与令牌体系并存两套主题；体积也更大。与 ADR 0006 的方向相反。
- **只用 Floating UI 自己写交互**：依赖更小，但键入定位、焦点陷阱、ARIA 仍要自己实现，正是容易出错的部分。
- **继续用原生 `<select>` 和 `title`**：零依赖、测试最简单，但弹出列表无法与界面一致，提示无法承载快捷键。
- **视图直接使用 Reka 组件**：少一层封装，但每个调用点都要重复十来个组件的组合，升级或替换库时改动面是全部视图。

代价：前端 JS 约增加 100 KB（未压缩）；jsdom 不模拟指针与浮层交互，组件测试改为通过 `SelectBox` 的公开接口验证本项目逻辑，真实的点开与点选由原生 E2E 覆盖；E2E 不能再用 `selectOption`，改用 `tests/native-select.ts` 的 `pickOption`。

## 影响与验证

- 新增运行依赖 `reka-ui` 及其传递依赖（`@floating-ui/*`、`@vueuse/*`、`@tanstack/vue-virtual`、`aria-hidden`、`defu`、`ohash` 为 MIT；`@internationalized/date`、`@internationalized/number`、`@swc/helpers` 为 Apache-2.0；`tslib` 为 0BSD），登记在第三方声明。安装时未执行安装脚本，`npm audit` 为 0 项漏洞。
- 目录外的旧过滤值仍作为可见选项保留；空值用占位文字表达，不再是一个空选项。
- 被截断数据的完整内容（作业编号等）仍可用原生 `title`，不要求换成 `Tip`。
- 验证结果见[验证记录](../verification/2026-11-15-headless-ui-primitives.md)。
- 回退方式：还原本次提交。配置、任务和报告格式未变。
