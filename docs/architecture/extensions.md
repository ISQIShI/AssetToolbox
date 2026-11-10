# 资源处理扩展契约

状态：已实现。提供方与目录 API 为 2；资源类型和操作 API 保持 1。决策见 [ADR 0007](../decisions/0007-operation-adapters.md)，三层边界沿用 [ADR 0003](../decisions/0003-processing-contract.md)。入口为 `resource-core/framework/registry.js`、`schema.js`、`engine.js`；本契约不依赖 Cordis。

## 三层职责

| 层 | 位置 | 必需成员 | 职责 |
| --- | --- | --- | --- |
| 资源类型 | `resource-types/<id>/index.js` | `kind`、`extensions`、`validate(buffer)` | 扩展名归属及格式验证；不定义编码器 |
| 处理操作 | `operations/<id>/index.js` | `accepts`、`resultPolicy` | 定义语义、操作参数和结果验收策略 |
| 实现提供方 | `providers/<id>/index.js` | `adapters` | 管理工具依赖，按操作组织适配器；同一个组合可有多个提供方 |

所有定义导出 CommonJS 对象，包含 `apiVersion`、语义版本 `version`、`displayName`，可提供 `description`。提供方须声明 `apiVersion: 2`，类型和操作声明 `apiVersion: 1`。ID 来自目录名，必须匹配 `[a-z][a-z0-9-]*`。启动时扫描直接子目录；忽略 `_`/`.` 开头目录、目录链接和无入口目录。格式扩展名必须唯一、小写且带点；只有资源类型占有扩展名。注册失败会阻止新处理，但不阻止现有任务恢复。

操作的 `accepts` 是资源 `kind` 数组。提供方的 `adapters` 是按操作 ID 索引的对象；每项必须有 `version`、非空且不重复的 `resourceTypes` 数组、同步 `execute`，可选专属 `schema`。引用必须存在且匹配操作种类；未知适配器字段拒绝注册。注册器从适配器生成 `{resourceType, operation}` 形式的 `supports`，不再手写两份能力清单。提供方顶层的旧 `supports`、`schema`、`execute` 明确拒绝。

一个操作可以由多个提供方实现，一个提供方可以实现多个操作。操作只定义一次，提供方负责满足其公共参数语义；不能静默忽略不支持的插值或适应方式。目前没有按提供方缩减公共参数范围的能力协商。

重启应用重新加载定义，无插件热插拔；内置提供方的固定依赖可按[依赖管理](dependencies.md)安装，不接受下载扩展代码的请求。

## 步骤及参数

```json
[
  {
    "id": "resize-png", "resourceType": "png", "operation": "image-resize",
    "provider": "sharp", "enabled": true,
    "parameters": { "width": 256, "height": 256, "fit": "inside", "kernel": "nearest", "withoutEnlargement": true },
    "providerOptions": { "jpegQuality": 90 }
  },
  {
    "id": "compress-png", "resourceType": "png", "operation": "compress",
    "provider": "pngquant", "enabled": true,
    "parameters": {}, "providerOptions": { "speed": 3, "qualityMin": 50, "qualityMax": 80 }
  }
]
```

`pipeline` 最多 64 步，ID 唯一；按数组顺序对每个文件执行已启用且类型匹配的步骤。可以多次使用同一操作；各步骤独立持有参数。空流水线合法：覆盖时保留，另存时原样复制已识别文件。未知扩展名不进入清单。

`parameters` 按操作 schema 校验，`providerOptions` 只按 `provider.adapters[step.operation].schema` 校验；不同操作的专属字段、默认值和范围互不混用。缺省填默认值，未知字段、错误类型和禁用步骤的无效参数同样拒绝。`schema` 支持 `defaults`、`limits`、`parameters` 和跨字段 `validate(values)`。字段类型为 integer、number、boolean、enum、text；数字必须声明上下限，number 默认两位小数（可设 0–6），枚举声明 choices，文本限制 maxLength。仅 primitive 值，禁止原型相关键。

规范化后填入 `versions: {resourceType, operation, provider, adapter}`；已有版本必须完整且精确匹配。新增步骤可省略 versions，由核心补齐；旧三字段快照拒绝处理。适配器行为或参数改变升级其 version；共享工具准备、依赖或提供方共同行为改变升级 provider.version。只升级一个适配器不使同提供方其他操作的快照失效。版本是开发者维护的契约标识，并非代码或编码器哈希锁定。

配置升级为 `asset-toolbox.settings/2`，拒绝读取或转换 `/1`；原文件保留，需重新建立配置。任务及报告外层 `/1` 不变，内部保存上述完整步骤快照；旧快照不可续跑/重试。备份恢复仍基于哈希和事件，不加载适配器，也不迁移原任务，见[持久化](persistence.md)。

前端从目录 API 2 的 `providers[].adapters[]` 按 operation 选择字段，条目含 `operation/version/fields`；顶层 provider.fields 已移除。切换工具时若操作 ID 相同，复制保留公共参数，专属参数取新适配器默认值；切换操作则重置两组参数。保留步骤 ID、顺序和启用状态，清除旧 versions，核心再次规范化。不会记忆切走工具的专属参数；“恢复默认参数”显式重置两组。

## 提供方执行接口

```javascript
module.exports = {
    apiVersion: 2, version: '1.0.0', displayName: '示例工具',
    adapters: {
        'image-resize': require('./adapters/image-resize'),
        compress: require('./adapters/compress'),
    },
};
```

例如 `adapters/image-resize.js`：

```javascript
module.exports = {
    version: '1.0.0', resourceTypes: ['png', 'jpg'],
    schema: { defaults: {} },
    execute({ operation, input, output, workDirectory, resourceType, parameters, providerOptions, executable }) {
        // 将 parameters 映射到工具 API，在临时目录生成 output。
        // operation 为 'image-resize'；此处省略实际工具调用。
        return { output, metadata: { width: parameters.width } };
    },
};
```

这是接口示意，未写出输出文件的实现不能通过执行。内置压缩专属 schema 位于 `adapters/compress-schema.js`，缩放 schema 就近放在其适配器中。框架直接调用选中操作的 execute，不靠参数猜测操作，也不要求提供方编写 switch 分派。

提供方层保留可选 `executableName`（仅本目录文件名）、`requiredFiles`、`check()` 和 `prepare({executable, workDirectory})`。依赖按提供方获取、校验和固定路径；每个作业内 prepare 对所需提供方只调用一次，返回工具路径给该提供方全部适配器。check 必须只读，预览也会调用。适配器不单独安装依赖或准备共享工具。execute 同步返回 `{output, metadata?}` 或 `{skipped:true}`，失败抛异常；返回 Promise 被拒绝。异步库如 Sharp 由同步子进程适配，子进程内使用 async。

输出须为工作目录内普通文件且通过资源类型验证。`smaller-only` 仅接受比当前步骤输入小的输出，否则跳过；`valid-output` 允许变大。每步记录操作、提供方、状态和可用的输出元数据。任一步失败丢弃整条流水线产物；另存模式复制原文件并记录失败。所有步骤成功后统一做备份、哈希校验和原子提交，不能由提供方绕开。

扩展是可信本地代码，框架不是权限沙箱。禁止读写额外用户文件、修改参数或在 stdout 输出协议外日志。当前不支持跨格式输出、一对多文件、异步插件生命周期、依赖注入、热重载和任务内并行。

## 内置映射与缩放边界

| 资源 | 操作 | 提供方 | 策略 |
| --- | --- | --- | --- |
| PNG | compress | pngquant | smaller-only |
| JPG / JPEG | compress | jpg-c | smaller-only |
| MP3 | compress | lame | smaller-only |
| PNG、JPG / JPEG | image-resize | sharp / libvips | valid-output |

缩放保持格式，支持等比适应 inside、居中裁剪 cover、拉伸 fill；插值为 Lanczos3 或 nearest。默认 512×512、仅缩小；宽高各 1–16384，输入和目标最多 4000 万像素。按 EXIF 方向处理并移除附加元数据；PNG 保留 alpha，半透明颜色存在 libvips 预乘舍入；JPEG 质量由提供方参数控制。拒绝动画/多页与损坏图片，输出完整解码后再返回。

本轮内置功能范围不变；多操作提供方由核心和原生 E2E 隔离夹具验证，未新增 Sharp 压缩等产品功能。

恢复、备份导出、任务管理属于通用文件安全服务，不伪装为资源转换插件；它们无需加载原提供方即可恢复备份。测试入口：`adapters.test.js`、`contract.test.js`、`resize.test.js`、全部文件安全测试及原生 E2E。

## 依赖可用性与获取信息

提供方可声明 `requiredFiles`（本目录文件名数组），用于可执行文件之外的 DLL 等依赖。可选 `provenance.json` 记录 name/version/license/url/source/instructions/redistribution/checkedAt；url 必须 HTTPS，不能包含凭据。新增外部工具必须登记可操作的官方获取说明。

`describe().providers` 返回 acquisition、availability（available/reason）及 dependency（自动安装能力、当前/目标版本与状态）。检查不写配置、不自动下载；只有用户点击安装才启动下载作业。Sharp 检查在短生命周期进程中进行。桌面通过 providers action 刷新，只替换目录状态，保留正在编辑的步骤；打开渠道按提供方 ID 从核心取得已登记地址，原生层只打开 HTTPS。实际处理前再次检查依赖。

LAME 优先从受管理目录定位可执行文件，Sharp 的 `prepare()` 固定本次作业的模块路径并通过 `executable` 上下文交给子进程。没有受管理记录时仍可手动安装；记录损坏或版本不匹配时拒绝处理并提示修复或更新。依赖升级改变实现行为时必须同步升级 provider.version。
