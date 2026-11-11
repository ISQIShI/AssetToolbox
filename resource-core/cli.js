const fs = require('node:fs');
function main(args) {
    if (!args.length || args[0] === '--help') {
        console.log('用法：node cli.js <源文件夹> --pipeline <步骤数组.json> [--output <目录> | --backup <目录>] [--preview]');
        console.log('Agent API：node cli.js api <capabilities|validate|submit|status|cancel|jobs|tasks|results> --policy <权限.json> [--input <请求.json|->]');
        return;
    }
    const options = {};
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--preview') { options.preview = true; continue; }
        if (!['--pipeline', '--output', '--backup'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('无效命令行选项：' + flag);
        const key = { '--pipeline': 'pipeline', '--output': 'outputDir', '--backup': 'backupDir' }[flag];
        if (options[key] !== undefined) throw new Error('重复选项：' + flag);
        const value = args[++i];
        options[key] = key === 'pipeline' ? JSON.parse(fs.readFileSync(value, 'utf8').replace(/^\uFEFF/, '')) : value;
    }
    if (!options.pipeline) throw new Error('必须提供 --pipeline');
    const { scanFolder, processFolder } = require('./engine');
    const unlock = require('./application/lock').acquire();
    let result;
    try { result = options.preview ? scanFolder(args[0], options) : processFolder(args[0], { ...options, log() {} }); }
    finally { unlock(); }
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failed || result.issues?.length ? 1 : result.cancelled ? 2 : 0;
}
if (require.main === module) {
    if (process.argv[2] === 'api') void require('./application/cli').main(process.argv.slice(3));
    else { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
}
module.exports = { main };
