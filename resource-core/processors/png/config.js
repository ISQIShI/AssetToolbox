// PNG 专属默认值与参数范围；界面、命令行和历史配置共用。
module.exports = {
    displayName: 'PNG', order: 10, extensions: ['.png'], enabledKey: 'pngEnabled',
    defaults: { pngEnabled: true, pngSpeed: 3, pngQualityMin: 50, pngQualityMax: 80 },
    limits: {
        pngSpeed: { label: 'PNG 速度', min: 1, max: 11 },
        pngQualityMin: { label: 'PNG 最低质量', min: 0, max: 100 },
        pngQualityMax: { label: 'PNG 最高质量', min: 0, max: 100 },
    },
    parameters: {
        pngSpeed: { hint: '数值越高速度越快。' },
        pngQualityMin: { hint: '最低质量不得高于最高质量；未达到时保留原图。' },
        pngQualityMax: { hint: '数值越高质量和体积通常越高。' },
    },
    validate(settings) {
        if (settings.pngQualityMin > settings.pngQualityMax) throw new Error('PNG 最低质量不能大于最高质量');
    },
};
