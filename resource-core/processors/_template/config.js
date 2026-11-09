// 将整个 _template 目录复制并改名（如 webp）后，再修改名称、扩展名、参数前缀和实现。
// _ 开头的目录不会被自动加载。
module.exports = {
    displayName: '新压缩器', order: 100,
    extensions: ['.example'], enabledKey: 'exampleEnabled',
    description: '请实现对应压缩器后再启用。',
    defaults: { exampleEnabled: false, exampleQuality: 75, exampleMode: 'balanced' },
    limits: { exampleQuality: { label: '质量', min: 0, max: 100 } },
    parameters: {
        exampleQuality: { hint: '请根据外部工具的实际参数定义范围与说明。' },
        exampleMode: { label: '模式', type: 'enum', choices: [
            { label: '均衡', value: 'balanced' }, { label: '快速', value: 'fast' },
        ] },
    },
    // 可选：跨字段约束。抛出 Error 会同时阻止界面和命令行提交。
    validate(settings) {},
};
