# 资源处理扩展契约

状态：已实现，API 版本 1。决策见 [ADR 0003](../decisions/0003-processing-contract.md)。入口为 `resource-core/framework/registry.js`、`schema.js`、`engine.js`；本契约不依赖 Cordis。

## 三层职责

| 层 | 位置 | 必需成员 | 职责 |
| --- | --- | --- | --- |
| 资源类型 | `resource-types/<id>/index.js` | `kind`、`extensions`、`validate(buffer)` | 扩展名归属及格式验证；不定义编码器 |
| 处理操作 | `operations/<id>/index.js` | `accepts`、`resultPolicy` | 定义语义、操作参数和结果验收策略 |
| 实现提供方 | `providers/<id>/index.js` | `supports`、`execute(context)` | 将操作适配为具体工具；同一个组合可有多个提供方 |

所有定义导出 CommonJS 对象，包含 `apiVersion: 1`、`version: '1.0.0'`、`displayName`，可提供 `description`。ID 来自目录名，必须匹配 `[a-z][a-z0-9-]*`。启动时扫描直接子目录；忽略 `_`/`.` 开头目录、目录链接和无入口目录。格式扩展名必须唯一、小写且带点；只有资源类型占有扩展名。注册失败会阻止新处理，但不阻止现有任务恢复。

操作的 `accepts` 是资源 `kind` 数组；提供方 `supports` 是 `{resourceType, operation}` 数组，引用必须存在且匹配种类。重启应用重新加载定义，无热插拔或下载执行机制。

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

`parameters` 按操作 schema 校验，`providerOptions` 按提供方 schema 校验；缺省填默认值，未知字段、错误类型和禁用步骤的无效参数同样拒绝。`schema` 支持 `defaults`、`limits`、`parameters` 和跨字段 `validate(values)`。字段类型为 integer、number、boolean、enum、text；数字必须声明上下限，number 默认两位小数（可设 0–6），枚举声明 choices，文本限制 maxLength。仅 primitive 值，禁止原型相关键。

规范化后填入 `versions: {resourceType, operation, provider}`；已有版本必须精确匹配。任务保存完整快照；续跑/重试不采用当前界面参数，缺失实现或版本变化时拒绝执行。版本是开发者维护的契约标识，并非代码或编码器哈希锁定。

## 提供方执行接口

```javascript
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '示例实现',
    supports: [{ resourceType: 'png', operation: 'image-resize' }],
    schema: { defaults: {} },
    execute({ input, output, workDirectory, resourceType, parameters, providerOptions, executable }) {
        // 使用临时 input，生成临时 output；不得修改用户路径。
        return { output, metadata: { width: parameters.width } };
    },
};
```

这是接口示意，未写出输出文件的实现不能通过执行。可选 `executableName` 只能是提供方目录内文件名；可选 `prepare({executable, workDirectory})` 负责临时工具准备并返回本次使用的工具路径；`check()` 必须只读，只检查依赖，预览也会调用。`execute` 同步返回 `{output, metadata?}` 或 `{skipped:true}`，失败抛异常；返回 Promise 被拒绝。异步库如 Sharp 由同步子进程适配，子进程内使用 async。

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

恢复、备份导出、任务管理属于通用文件安全服务，不伪装为资源转换插件；它们无需加载原提供方即可恢复备份。测试入口：`contract.test.js`、`resize.test.js`、全部文件安全测试及原生 E2E。

## 依赖可用性与获取信息

提供方可声明 `requiredFiles`（本目录文件名数组），用于可执行文件之外的 DLL 等依赖。可选 `provenance.json` 记录 name/version/license/url/source/instructions/redistribution/checkedAt；url 必须 HTTPS，不能包含凭据。新增外部工具必须登记可操作的官方获取说明。

`describe().providers` 返回 acquisition 和 availability（available/reason）。检查不写配置、不自动下载；Sharp 检查在短生命周期进程中进行。桌面通过 providers action 刷新，只替换目录状态，保留正在编辑的步骤；打开渠道按提供方 ID 从核心取得已登记地址，原生层只打开 HTTPS。实际处理前再次检查依赖。
