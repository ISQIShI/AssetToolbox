// 实现前保持 exampleEnabled=false。需要外部 EXE 时，将 EXE 放在本目录。
// const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    executableName: 'your-compressor.exe', // 纯 JavaScript 实现可删除此项。
    validate(data) {
        // TODO：检查该格式的输入/输出标识。请参考 png、jpg、mp3 模块。
        throw new Error('请先实现新压缩器的格式校验');
    },
    compress({ executable, input, output, workDirectory, settings }) {
        // TODO：调用实际工具。不要直接操作用户文件，只处理 input/output 临时路径。
        // const result = runTool(executable, ['实际参数', input, output], workDirectory);
        // checkExit(result);
        // return { output }; // 无需处理时返回 { skipped: true }。
        throw new Error('请先实现新压缩器的调用');
    },
};
