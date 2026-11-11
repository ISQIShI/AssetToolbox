module.exports = {
    apiVersion: 2,
    version: '1.0.0',
    displayName: '响度归一化',
    description: '按整段 LUFS 计算固定增益；此默认值不是所有游戏音效的统一标准。峰值受限时可能无法达到目标。 默认另存；会重新编码并移除标签、封面及循环标记。不会降噪或改变音高、速度。',
    accepts: ['audio'],
    resultPolicy: 'valid-output',
    schema: {
        defaults: {
            targetLufs: -18,
            truePeakDb: -1,
            peakPolicy: 'limit',
        },
        limits: {
            targetLufs: {
                min: -40,
                max: -5,
            },
            truePeakDb: {
                min: -12,
                max: -0.1,
            },
        },
        parameters: {
            targetLufs: {
                label: '目标响度（LUFS）',
                type: 'number',
                decimalPlaces: 1,
                hint: '按整段 LUFS 计算固定增益；此默认值不是所有游戏音效的统一标准。峰值受限时可能无法达到目标。',
            },
            truePeakDb: {
                label: '真峰值上限（dBTP）',
                type: 'number',
                decimalPlaces: 1,
                hint: '预留峰值空间；输出重测，绝不暗中启用动态压缩。',
            },
            peakPolicy: {
                label: '超峰处理',
                type: 'enum',
                choices: [
                    {
                        label: '限制整段增益（保留动态）',
                        value: 'limit',
                    },
                    {
                        label: '报错并保留原文件',
                        value: 'reject',
                    },
                ],
            },
        },
    },
    preserveOriginal: true,
};
