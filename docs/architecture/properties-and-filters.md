# 资源属性与过滤器

状态：已实现；决策见 [ADR 0017](../decisions/0017-properties-and-filters.md)。源码为 `properties/`、`framework/properties.js`、`framework/filters.js`、`engine.js` 和桌面 `FilterEditor.vue`。属性由可信本地代码定义和读取，过滤器只引用属性，不接受脚本、任意表达式或下载插件。

## 属性目录与扩展

目录 API **4** 的 `properties` 描述每项属性的 `id/group/version/type/label/unit?/resourceTypes/operators`；`filterSchema` 为 `asset-toolbox.filter/1`。ApplicationService 的 capabilities 向所有入口公布同一目录。

| 属性组 | 适用资源 | 当前字段 |
| --- | --- | --- |
| file（common） | 全部已注册资源类型 | `file-size` 字节数、`file-name` 含扩展名、`relative-path` 相对路径、`extension` 小写含点、`resource-type` 类型 ID、`resource-kind` 种类 |
| image | PNG、JPG/JPEG | `image-width`、`image-height`（px）、`image-pixels` 总像素数、`image-aspect-ratio` 宽高比 |

在 `resource-core/properties/<group>/index.js` 导出属性组；`common:true` 自动应用于所有类型，专属组由类型的 `propertyGroups` 显式关联。例如：

```javascript
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '文件属性', common: true,
    fields: { 'file-size': { type: 'number', label: '文件大小', unit: 'B' } },
    read({ stat, buffer }) {
        return { 'file-size': buffer ? buffer.length : stat.size };
    },
};
```

这是替换现有 file 组的接口示意，不能与其重复注册同一 ID。字段 ID 全局唯一，类型为 number/string/boolean；读取函数同步返回字段值对象，不得修改素材。上下文还提供 filename、relativePath、resourceType 和 `readPrefix(length)`；同一文件/步骤上下文中按需读取并缓存整组，下一步新建上下文。专属组示例见 `properties/image/index.js`，PNG/JPG 类型声明 `propertyGroups:['image']`。行为、单位或字段含义改变必须升级组 version，不能依靠重启静默改变已有任务含义。

图片尺寸最多读取 1 MiB 文件头，不要求 Sharp 或 FFmpeg。PNG 使用 IHDR 编码尺寸；JPEG 使用 SOF 尺寸并按 EXIF 方向交换宽高，XMP 不覆盖 EXIF。PNG eXIf 方向尚未解释。此读取不是完整图像解码或格式验收；超过头部上限、损坏/缺失尺寸明确报错。音频目前只有通用属性，尚无时长、采样率等专属读取器。

## 过滤表达式

`any` 内组间为“或”，组内 `all` 为“且”。例如只选择宽度大于 1024 px 的 JPG（`.jpeg` 也识别为 jpg）：

```json
{
  "schema": "asset-toolbox.filter/1",
  "any": [{ "all": [
    { "property": "resource-type", "operator": "eq", "value": "jpg" },
    { "property": "image-width", "operator": "gt", "value": 1024 }
  ] }]
}
```

分辨率没有单一大小顺序：可分别约束宽/高，也可按总像素数过滤。空 `any:[]` 或省略过滤器表示全部通过。最多 16 组，每组 1–16 条，总计 64 条。数字支持 eq/ne/gt/gte/lt/lte；字符串支持 eq/ne/contains/starts-with/ends-with，区分大小写，相对路径统一 `/`；布尔值支持 eq/ne。不支持正则或隐式单位换算。数值须有限且绝对值不超过安全整数上限，字符串最多 1024 字符且不能含 NUL。

规范化拒绝未知字段、属性、运算符、错误值类型及版本，并为每条规则填入属性组 `version`；提交、执行及续跑均核对。属性不适用时为不匹配（包括 ne），读取失败则报错，不能当作普通排除。AND/OR 短路求值，因此建议先放类型等廉价判断。界面从目录生成属性/运算符选项，不复制判断逻辑。

## 两个执行位置

| 位置 | 输入与时机 | 未匹配行为 |
| --- | --- | --- |
| 请求/settings 的 `sourceFilter` | 扫描已识别扩展名，排除输出/备份目录后，读取原始资源 | 不进入固定 plan，不复制、不处理、不备份；预览/汇总显示 discovered 与 filteredOut |
| `pipeline[].filter` | 对类型匹配、启用的步骤，在调用适配器前读取当前中间产物 | 步骤记为 filtered，继续后续步骤；不移除该文件 |

先缩放到 256 px，再设置下一步骤宽度大于 512 px，第二步不会执行。文件大小也随当前步骤输入改变；文件名与路径保持原始身份。压缩更小才接受、缩放禁止放大、音频超峰限制属于操作语义，继续保留，不能用过滤器绕过安全策略。

来源过滤后固定快照；读取期间/之后发现来源变化时停止或记录失败。完整 plan 之后的续跑/重试只使用原清单及规则版本，不重新选中新增文件，不套用当前桌面条件；未完成扫描则下次重扫。步骤全部不匹配时，覆盖保留原文件且不备份，另存沿用原样复制语义；纯观察任务仍禁止输出/备份。依赖按启用步骤预检，不能依赖过滤条件绕过缺失工具检查。扫描不执行转换，因此启用步骤数量只是潜在处理范围，不预估所有步骤是否匹配。

## 备份、恢复与版本

过滤只决定处理选择，不改变事务、任务锁、哈希、原子提交和按文件边界取消。恢复/备份导出只根据实际备份、显式选择及预览哈希执行，禁止隐式继承来源/步骤过滤；无需加载属性、操作或提供方。恢复列表的文本/状态筛选只改变可见行，不擅自扩展勾选。

当前 settings **/3**、task/report **/2**、application/response **/8**、job **/6**（`data/jobs/v6`）、HTTP **/api/v8**。旧配置、任务及作业不迁移，旧 HTTP 1–7 返回 410；旧备份普通文件保留，可通过独立备份导出显式选择恢复。升级时关闭旧入口，配套更新 EXE、核心和 MCP，避免旧进程访问新数据。策略 policy/2、提供方 API 2 和调度契约不变。

## 入口与验证

桌面在来源与每个步骤显示同一过滤编辑器，支持 AND/OR、清除及忙碌禁用；同类型切换工具保留条件，改变类型清空条件，恢复参数不清空过滤。CLI 快捷命令增加 `--source-filter examples/source-filter.example.json`（仓库根执行）；通用 CLI API、MCP stdio/HTTP 和 HTTP 的 validate/submit 直接接受 sourceFilter 与 step.filter。示例见[根 README](../../README.md)。恢复请求不接受过滤字段。

界面将 resource-kind 显示为“资源类别”，resource-type 显示为“资源格式”；eq/ne 提供图片/音频及分组格式选项，仍保存原始 kind/格式 ID，不改变 filter/1。contains 等操作保持文本输入，已保存的目录外值保留显示。类别筛选 image 可涵盖 JPEG 与 PNG，步骤仍分别指定一个格式。

测试：核心 `filters.test.js`、真实图片 `resize.test.js`、组件 `filters.test.ts`、MCP `http.test.mjs` 五入口行为对照、原生 `filters-native.spec.ts`。覆盖来源排除与不备份、固定清单续跑、版本拒绝、中间产物、失效元数据、插件不可用时恢复，以及真实 JPG 的界面配置与原文件保护。
