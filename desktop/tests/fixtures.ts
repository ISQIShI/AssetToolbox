import type { Configuration, Definition } from '../src/types';
export const definition: Definition = {
    apiVersion: 1,
    resourceTypes: [{ id: 'png', displayName: 'PNG', extensions: ['.png'], kind: 'image', version: '1.0.0' }],
    operations: [
        { id: 'compress', displayName: '压缩', description: '', accepts: ['image'], resultPolicy: 'smaller-only', fields: [], version: '1.0.0' },
        { id: 'image-resize', displayName: '图片缩放', description: '', accepts: ['image'], resultPolicy: 'valid-output', version: '1.0.0', fields: [{ key: 'width', type: 'integer', label: '目标宽度', min: 1, max: 4096, default: 512 }] },
    ],
    providers: [{ id: 'test', displayName: '测试提供方', description: '', version: '1.0.0', supports: [{ resourceType: 'png', operation: 'compress' }, { resourceType: 'png', operation: 'image-resize' }], fields: [
        { key: 'level', label: '级别', type: 'integer', default: 4, min: 1, max: 9 },
        { key: 'rate', label: '比例', type: 'number', default: .7, min: 0, max: 1, step: .05, decimalPlaces: 2 },
        { key: 'flag', label: '额外开关', type: 'boolean', default: false },
        { key: 'mode', label: '模式', type: 'enum', default: 'a', choices: [{ label: '快速', value: 'a' }, { label: '最佳', value: 'b' }] },
        { key: 'text', label: '文字', type: 'text', default: '默认', maxLength: 32767 },
    ] }],
};
export const config: Configuration = { schema: 'asset-toolbox.settings/1', sourceDir: 'D:\\中文 素材', saveMode: 'overwrite', outputDir: 'D:\\输出', backupDir: 'D:\\备份', backupEnabled: true,
    pipeline: [{ id: 'first', resourceType: 'png', operation: 'compress', provider: 'test', enabled: true, parameters: {}, providerOptions: { level: 3, rate: .5, flag: false, mode: 'a', text: '长文本' } }] };
