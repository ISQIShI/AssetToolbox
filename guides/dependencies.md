# 安装与更新处理工具

[返回用户文档](README.md) · 源码 Release 不附带处理工具，按所需功能安装即可。

## 按功能选择

| 提供方 | 用途 | 获取方式与位置 |
| --- | --- | --- |
| Sharp | PNG/JPEG 缩放 | 核心 `npm ci`，或“工具”页一键安装核验版本；[上游](https://github.com/lovell/sharp) |
| pngquant | PNG 压缩 | [作者项目](https://github.com/kornelski/pngquant)，执行 `cargo install pngquant --version 3.0.3 --locked`，将生成的 pngquant.exe 复制到 `resource-core/providers/pngquant/`；保留 COPYRIGHT |
| JPG-C | JPEG 压缩 | 从[作者页面](https://zzy.my/blog/post/Jpg-C)获取，按工具页指示放到 `resource-core/providers/jpg-c/`；渠道不可用时停用 JPEG 压缩，不影响 Sharp 缩放 |
| LAME | MP3 压缩 | “工具”页一键安装固定核验版本；手动获取见[官方推荐的 RareWares](https://www.rarewares.org/mp3-lame-bundle.php)，需保留配套解码 DLL，不能只复制 EXE |
| FFmpeg / FFprobe | WAV/FLAC/MP3/Ogg 分析、增益、响度归一化 | 从 [FFmpeg Windows 渠道](https://ffmpeg.org/download.html)指向的 [Gyan 构建页](https://www.gyan.dev/ffmpeg/builds/)获取 9.0.2 essentials；核验上游摘要后，将 bin 内两个 EXE 放到 `resource-core/providers/ffmpeg/`，保留许可材料 |

这里记录的是项目已核验版本，不承诺上游页面始终保留对应下载。工具页会显示实际安装要求；不要用随意下载的新版本替换固定依赖。完整版本/许可记录见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)；手动文件名以各提供方的 provenance.json 和界面说明为准。

## 安装、修复与更新

“工具”页展示当前版本、可安装的核验版本与来源。LAME、Sharp 支持一键安装、修复和重新安装；应用的核验清单变化时提供“更新到核验版本”。更新不会自动追随上游最新版，手动安装的文件会保留。

下载仅使用固定 HTTPS 渠道并匹配文件摘要，完成加载检查后才启用。进度、错误与取消显示在底部；安装过程中不能同时处理素材。网络失败或摘要不符时保留旧安装，可重试或使用手动指引。pngquant 3.0.3 仍需 Cargo 编译，JPG-C 仍按作者渠道获取；FFmpeg/FFprobe 9.0.2 按工具页的 Gyan 官方推荐渠道手动安装。

受管理文件位于 `resource-core/data/dependencies/`；本地移动应用时连同该目录携带。旧安装目录暂不自动清理，不要删除当前启用目录。详情与分发限制见[依赖管理](../docs/architecture/dependencies.md)。
