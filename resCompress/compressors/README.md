# 添加压缩器模块

复制 `_template` 为新目录（例如 `webp`），修改目录中的 `config.js` 和 `index.js`，放入需要的 EXE，然后重新打开 `ResourceCompressor.exe`。主程序和界面代码均无需修改。

目录名是模块 ID，需以小写字母开头，后接小写字母、数字、下划线或连字符。只扫描 `compressors` 的直接子目录；`_` / `.` 开头的目录和链接目录被跳过。普通资料目录不加载，但只包含 `index.js` 或 `config.js` 的不完整模块会报错。每次启动重新发现模块，不支持运行期间热更新。

```text
webp/
├─ config.js           名称、格式、开关、参数及校验
├─ index.js            具体压缩实现
├─ your-compressor.exe 按需提供
└─ user-settings.json  启用开关和上次参数（运行后自动生成）
```

## config.js

下面是参数配置示例，不包含实际 WebP 编码器：

```javascript
module.exports = {
    displayName: 'WebP',
    description: '这里填写面向使用者的说明。', // 可省略
    order: 40, // 小的先显示；相同值按目录名排序，省略时为 100
    extensions: ['.webp'],
    enabledKey: 'webpEnabled',
    defaults: {
        webpEnabled: false,
        webpQuality: 75,
        webpLossless: false,
        webpMode: 'balanced',
        webpNote: '',
    },
    limits: {
        webpQuality: { label: '质量', min: 0, max: 100 },
    },
    parameters: {
        webpQuality: { hint: '范围与默认值应以实际编码器为准。' },
        webpLossless: { label: '无损模式' },
        webpMode: {
            label: '处理模式', type: 'enum',
            choices: [
                { label: '均衡', value: 'balanced' },
                { label: '快速', value: 'fast' },
            ],
        },
        webpNote: { label: '备注', type: 'text', maxLength: 200 },
    },
    validate(settings) {
        // 可选：跨参数约束；不合法时 throw new Error('面向用户的说明')。
    },
};
```

`defaults` 中的每个键都会生成一个控件和命令行选项。键使用以小写字母开头的驼峰命名，必须在全部模块中唯一（不区分大小写），建议加模块前缀。`sourceDir`、`outputDir`、`backupDir`、`version` 等主程序保留名不能使用。

`enabledKey` 必须指向一个默认值为布尔值的参数。该字段是模块启用开关；关闭后，其他参数控件变灰，覆盖时跳过该格式，另存时原样复制。框架统一管理此开关，模块无需自行实现。

参数按 `defaults` 中的顺序显示；`parameters` 可省略，用来补充标签、说明和控件类型。标签优先取 `parameters[key].label`，其次取 `limits[key].label`，最后使用参数名。支持以下类型：

| 类型 | 控件 | 配置 |
| --- | --- | --- |
| `integer` | 整数输入框 | 整数默认值会自动推断；需在 `limits` 中设置 `min` / `max`；可设置整数 `step` |
| `number` | 小数输入框 | 可显式设置类型；需 `limits`；`decimalPlaces` 默认 2，支持 0–6；`step` 默认对应精度的最小单位 |
| `boolean` | 复选框 | 布尔默认值自动推断 |
| `enum` | 下拉框 | 显式设置类型及 `choices`；选项为字符串或 `{ label, value }`，值必须是非空字符串，默认值须在选项内 |
| `text` | 单行文本框 | 字符串默认值自动推断；`maxLength` 默认 4096，支持 1–32767 |

例如小数参数：`defaults: { sampleRate: 0.5 }`、`limits: { sampleRate: { label: '比例', min: 0, max: 1 } }`、`parameters: { sampleRate: { type: 'number', decimalPlaces: 2, step: 0.05 } }`。数值范围绝对值不能超过 `1e12`，范围端点和步长应符合声明的小数精度。

扩展名使用 `.webp` 这样的单一后缀，可为一个模块声明多个后缀，例如 `['.jpg', '.jpeg']`。不区分大小写；不同模块不能声明相同扩展名。替换某格式的实现时，先移走或停用原模块，或直接更新原模块目录内的实现。

## index.js

模块导出以下接口：

```javascript
module.exports = {
    executableName: 'your-compressor.exe', // 可选，必须是本目录内的文件名
    validate(data) { /* 检查 Buffer 的格式，返回 true 或 false */ },
    compress({ executable, input, output, workDirectory, settings }) {
        // executable: 框架解析出的 EXE 绝对路径
        // input/output: 系统临时目录中的绝对路径
        // settings: 全部模块已经校验、按声明类型转换的参数
        // 成功：return { output: 实际结果路径 }
        // 不必压缩：return { skipped: true }
        // 失败：throw new Error('说明')
    },
};
```

`validate(buffer)` 与 `compress(context)` 必须实现。框架会在调用前校验输入，压缩后再次校验输出，只有体积缩小时才替换或另存。模块只处理临时文件；源文件、另存、备份和子目录结构统一由主流程管理。临时文件扩展名使用模块声明的第一个扩展名。

可选接口：

- `prepare({ executable, workDirectory })`：每次运行准备一次，返回后续调用使用的可执行文件路径。例如 JPG 模块将 EXE 复制到临时目录以隔离日志。
- `shouldCompress(settings)`：启用模块后额外判断是否需要处理；返回 `false` 则原样保留。例如 JPG 质量 0。不能代替模块启用开关。

可以复用 `require('../process')` 的 `runTool(executable, args, cwd)` 和 `checkExit(result)`；它们使用参数数组启动进程，不经过 shell。纯 JavaScript 压缩器可不提供 `executableName`。框架只在遇到已启用格式时检查其 EXE 是否存在。

框架从目录和配置自动生成 `id`、`directory`、`extensions`、`config`、`isEnabled`，无需在实现中声明这些字段。`_template/index.js` 含待实现占位代码，须替换为真实格式校验与调用逻辑后才能使用。

## 命令行与记住配置

例如 `webpQuality` 自动生成：

```powershell
node .\resCompress\compress.js "D:\素材" --output "D:\输出" --webp-enabled true --webp-quality 80
```

布尔值使用 `true` / `false`，枚举使用选项的 `value`。界面会将数值、布尔值、文本等按类型传递；含中文、空格和引号的文本也会保留。`node resCompress/compress.js --help` 自动显示当前全部选项。

`config.js` 的校验同时作用于界面、命令行和历史配置。新增参数在尚未保存时使用其默认值；点击“开始压缩”后自动写入当前模块的 `user-settings.json`。关闭模块仍记住参数。移走模块、将目录加 `_` 或恢复目录名，均不会删除其已保存配置。

模块定义不完整、默认值或类型错误、扩展名冲突、参数名冲突会在处理文件前报错。没有任何模块时，界面显示提示，不会误用原有格式列表。

## 批量任务接口

新增模块自动参与扫描预览、进度、取消和报告，无需另加接口。预览只读取文件元数据、检查 `executableName` 是否存在，调用 `isEnabled`（包含可选的 `shouldCompress`），不调用 `validate`、`prepare` 或 `compress`。因此配置校验和 `shouldCompress` 应保持只读。

运行期间的取消由框架在扫描阶段和文件之间检查。编码器对当前文件的调用、验证、备份和写入会完成，随后才停止。`compress` 不应直接写入原目录，也不应自行启动脱离本次任务的后台进程。

如需从 JavaScript 集成，`require('./compress')` 提供 `scanFolder(folder, options)` 和 `compressFolder(folder, options)`。通用选项包含 `onProgress(event)`、`onFile(record)`、`shouldCancel()`，回调同步执行，不要在回调内抛出异常。`onProgress` 阶段为 `scanning`、`checking`（预览）、`compressing`；扫描中的总数尚不完整。`onFile` 在文件的写入或错误处理结束后执行，记录包含相对路径、模块、状态、大小和失败原因。取消返回的汇总带 `cancelled: true`，已完成结果保留。这些回调名与 `preview` 均为保留参数名，不能用于模块参数。

断点续压和失败重试也由通用框架处理，模块接口不变。完整清单保存每个文件所属模块和扫描时的大小、时间戳；恢复时使用原任务参数。移除任务仍需要的模块、改名或不兼容地修改其参数会阻止恢复，应先恢复该模块或建立新任务。失败重试可以使用修复后的压缩器实现。

`tasks.js` 管理断点及任务锁，`batch.js` 负责建立清单、选择待处理/失败队列、生成每次运行报告。内部调度使用 `fileList`、`beforeFile`、`beforeCommit`、`backupSession`、`reuseBackup`、`replaceOutputs`，这些名称也属于保留参数。`beforeCommit` 在源文件和结果校验后、实际写入前持久化写入意图，`onFile` 持久化最终结果。模块不得绕过框架自行写入源文件，否则无法保证断点和备份的一致性。
