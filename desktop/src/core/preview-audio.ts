// 仅供浏览器界面调试的静态音频目录，不执行文件处理。
import type { ResourceType, Operation, Provider } from './types';

export const audioTypes: ResourceType[] = [
    {
        id: 'flac',
        displayName: 'FLAC',
        description: '',
        version: '1.0.0',
        kind: 'audio',
        extensions: ['.flac'],
    },
    {
        id: 'ogg',
        displayName: 'Ogg（Vorbis / Opus）',
        description: '',
        version: '1.0.0',
        kind: 'audio',
        extensions: ['.ogg', '.opus'],
    },
    {
        id: 'wav',
        displayName: 'WAV',
        description: '',
        version: '1.0.0',
        kind: 'audio',
        extensions: ['.wav'],
    },
];

export const audioOperations: Operation[] = [
    {
        id: 'audio-analyze',
        displayName: '音频分析',
        description: '测量时长、格式、响度、峰值与响度范围；只生成结果，不改写或复制素材。',
        version: '1.0.0',
        accepts: ['audio'],
        resultPolicy: 'observe',
        preserveOriginal: false,
        fields: [],
    },
    {
        id: 'audio-gain',
        displayName: '音频增益',
        description: '整段固定增益；正数放大，负数减小。MP3/Ogg 会重新有损编码。 默认另存；会重新编码并移除标签、封面及循环标记。不会降噪或改变音高、速度。',
        version: '1.0.0',
        accepts: ['audio'],
        resultPolicy: 'valid-output',
        preserveOriginal: true,
        fields: [
            {
                key: 'gainDb',
                type: 'number',
                default: 0,
                label: '增益（dB）',
                hint: '整段固定增益；正数放大，负数减小。MP3/Ogg 会重新有损编码。',
                min: -60,
                max: 30,
                decimalPlaces: 1,
                step: 0.1,
            },
            {
                key: 'truePeakDb',
                type: 'number',
                default: -1,
                label: '真峰值上限（dBTP）',
                hint: '预留峰值空间；输出重测，绝不暗中启用动态压缩。',
                min: -12,
                max: -0.1,
                decimalPlaces: 1,
                step: 0.1,
            },
            {
                key: 'peakPolicy',
                type: 'enum',
                default: 'limit',
                label: '超峰处理',
                hint: '',
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
        ],
    },
    {
        id: 'audio-normalize',
        displayName: '响度归一化',
        description: '按整段 LUFS 计算固定增益；此默认值不是所有游戏音效的统一标准。峰值受限时可能无法达到目标。 默认另存；会重新编码并移除标签、封面及循环标记。不会降噪或改变音高、速度。',
        version: '1.0.0',
        accepts: ['audio'],
        resultPolicy: 'valid-output',
        preserveOriginal: true,
        fields: [
            {
                key: 'targetLufs',
                type: 'number',
                default: -18,
                label: '目标响度（LUFS）',
                hint: '按整段 LUFS 计算固定增益；此默认值不是所有游戏音效的统一标准。峰值受限时可能无法达到目标。',
                min: -40,
                max: -5,
                decimalPlaces: 1,
                step: 0.1,
            },
            {
                key: 'truePeakDb',
                type: 'number',
                default: -1,
                label: '真峰值上限（dBTP）',
                hint: '预留峰值空间；输出重测，绝不暗中启用动态压缩。',
                min: -12,
                max: -0.1,
                decimalPlaces: 1,
                step: 0.1,
            },
            {
                key: 'peakPolicy',
                type: 'enum',
                default: 'limit',
                label: '超峰处理',
                hint: '',
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
        ],
    },
];

export const audioProvider: Provider = {
    id: 'ffmpeg',
    displayName: 'FFmpeg 9.0.2',
    description: '',
    version: '1.0.0',
    supports: [
        {
            resourceType: 'wav',
            operation: 'audio-analyze',
        },
        {
            resourceType: 'flac',
            operation: 'audio-analyze',
        },
        {
            resourceType: 'mp3',
            operation: 'audio-analyze',
        },
        {
            resourceType: 'ogg',
            operation: 'audio-analyze',
        },
        {
            resourceType: 'wav',
            operation: 'audio-gain',
        },
        {
            resourceType: 'flac',
            operation: 'audio-gain',
        },
        {
            resourceType: 'mp3',
            operation: 'audio-gain',
        },
        {
            resourceType: 'ogg',
            operation: 'audio-gain',
        },
        {
            resourceType: 'wav',
            operation: 'audio-normalize',
        },
        {
            resourceType: 'flac',
            operation: 'audio-normalize',
        },
        {
            resourceType: 'mp3',
            operation: 'audio-normalize',
        },
        {
            resourceType: 'ogg',
            operation: 'audio-normalize',
        },
    ],
    adapters: [
        {
            operation: 'audio-analyze',
            version: '1.0.0',
            fields: [],
        },
        {
            operation: 'audio-gain',
            version: '1.0.0',
            fields: [
                {
                    key: 'lossyQuality',
                    type: 'integer',
                    default: 4,
                    label: '有损编码质量',
                    hint: '仅 MP3/Vorbis：越高质量越好；Opus 固定 192 kb/s。无损格式不受影响。',
                    min: 0,
                    max: 10,
                    decimalPlaces: 0,
                    step: 1,
                },
            ],
        },
        {
            operation: 'audio-normalize',
            version: '1.0.0',
            fields: [
                {
                    key: 'lossyQuality',
                    type: 'integer',
                    default: 4,
                    label: '有损编码质量',
                    hint: '仅 MP3/Vorbis：越高质量越好；Opus 固定 192 kb/s。无损格式不受影响。',
                    min: 0,
                    max: 10,
                    decimalPlaces: 0,
                    step: 1,
                },
            ],
        },
    ],
    availability: {
        available: true,
        reason: '',
    },
    acquisition: {
        name: 'FFmpeg / FFprobe',
        version: '9.0.2-essentials_build-www.gyan.dev',
        license: 'GPL-3.0-or-later（此构建启用 GPL 与 version3）',
        url: 'https://www.gyan.dev/ffmpeg/builds/',
        source: 'https://github.com/FFmpeg/FFmpeg/commit/946fcce07b',
        instructions: '从 FFmpeg 官网 Download → Windows → gyan.dev 获取 9.0.2 essentials 构建，按渠道发布的 SHA-256 校验下载包。解压后将 bin/ffmpeg.exe 与 bin/ffprobe.exe 放入 resource-core/providers/ffmpeg/，保留 LICENSE 和来源记录，再刷新工具状态。此版仅接受 9.0.2。',
        redistribution: '源码仓库不包含二进制；便携包分发须提供匹配构建的对应源码、构建配置及所含库的完整许可，不因独立进程调用或 MIT 项目许可而免除义务。尚未放行。',
        checkedAt: '2026-11-10',
    },
    dependency: {
        automatic: false,
        reason: 'FFmpeg 9.0.2 官方推荐 Windows 构建为大体积 ZIP/7z，暂未纳入当前受限自动解包清单；请按获取说明安装，不放宽现有校验限制。',
    },
};
