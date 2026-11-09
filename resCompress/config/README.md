# 公共配置

`user-settings.json` 在点击“开始压缩”后自动生成，只保存源文件夹、另存和备份路径、保存方式及备份开关。

PNG、JPG、MP3 的启用开关和参数分别保存在 `../compressors/<格式>/user-settings.json`。对应目录的 `config.js` 定义该工具的默认值、范围和校验规则。

旧的 `resCompress/user-settings.json` 仍可读取。首次保存新配置后，以新的分模块配置为准，旧文件保留原样。
