module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '图片缩放',
    description: '保持格式；结果体积可以增大。按视觉方向处理，移除 EXIF 等附加元数据。', accepts: ['image'], resultPolicy: 'valid-output',
    schema: {
        defaults: { width: 512, height: 512, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true },
        limits: { width: { label: '目标宽度', min: 1, max: 16384 }, height: { label: '目标高度', min: 1, max: 16384 } },
        parameters: {
            fit: { label: '适应方式', type: 'enum', choices: [{ label: '等比适应', value: 'inside' }, { label: '裁剪填充', value: 'cover' }, { label: '拉伸', value: 'fill' }] },
            kernel: { label: '插值算法', type: 'enum', choices: [{ label: '高质量 Lanczos3', value: 'lanczos3' }, { label: '最近邻（像素画）', value: 'nearest' }] },
            withoutEnlargement: { label: '仅缩小', hint: '关闭后允许放大；结果可能比源文件更大。' },
        },
        validate: settings => { if (settings.width * settings.height > 40_000_000) throw new Error('目标尺寸不能超过 4000 万像素'); },
    },
};
