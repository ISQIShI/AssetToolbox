const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

function createToken(filename) {
    if (!filename) throw new Error('用法：node resource-core/application/token.js <令牌文件路径>');
    // 文件必须新建，避免误覆盖现有凭据；Windows 沿用所在目录 ACL。
    fs.writeFileSync(path.resolve(filename), randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    return { created: true };
}
if (require.main === module) {
    try {
        if (process.argv.length !== 3) throw new Error('请指定一个令牌文件路径');
        console.log(JSON.stringify(createToken(process.argv[2])));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createToken };
