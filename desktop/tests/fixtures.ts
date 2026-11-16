import type { Configuration, Definition, Provider, Task } from '../src/core/types';
import { previewProperties } from '../src/core/preview-properties';

export const definition: Definition = {
    apiVersion: 4, properties: previewProperties, filterSchema: 'asset-toolbox.filter/1',
    resourceTypes: [{ id: 'png', displayName: 'PNG', extensions: ['.png'], kind: 'image', version: '1.0.0' }],
    operations: [
        { id: 'compress', displayName: '压缩', description: '仅在结果体积变小时采用新内容。', accepts: ['image'], resultPolicy: 'smaller-only', fields: [], version: '1.0.0' },
        { id: 'image-resize', displayName: '图片缩放', description: '', accepts: ['image'], resultPolicy: 'valid-output', version: '1.0.0', fields: [{ key: 'width', type: 'integer', label: '目标宽度', min: 1, max: 4096, default: 512 }] },
    ],
    providers: [{ id: 'test', displayName: '测试工具', description: '', version: '1.0.0', supports: [{ resourceType: 'png', operation: 'compress' }, { resourceType: 'png', operation: 'image-resize' }], adapters: [{ operation: 'compress', version: '1.0.0', fields: [
        { key: 'level', label: '级别', type: 'integer', default: 4, min: 1, max: 9 },
        { key: 'rate', label: '比例', type: 'number', default: .7, min: 0, max: 1, step: .05, decimalPlaces: 2 },
        { key: 'flag', label: '额外开关', type: 'boolean', default: false },
        { key: 'mode', label: '模式', type: 'enum', default: 'a', choices: [{ label: '快速', value: 'a' }, { label: '最佳', value: 'b' }] },
        { key: 'text', label: '文字', type: 'text', default: '默认', maxLength: 32767 },
    ] }, { operation: 'image-resize', version: '1.0.0', fields: [{ key: 'quality', label: '缩放质量', type: 'integer', default: 90, min: 1, max: 100 }] }], availability: { available: true, reason: '' } }],
};

export const missingProvider = (provider: Provider = definition.providers[0]!): Provider => ({
    ...provider, availability: { available: false, reason: '缺少文件：tool.exe' },
    acquisition: { name: '工具', version: '1.0', license: 'MIT', url: 'https://example.com/download', source: 'https://example.com', instructions: '将 tool.exe 放入 providers/test/', redistribution: '保留许可声明', checkedAt: '2026-11-08' },
});

export const config: Configuration = {
    schema: 'asset-toolbox.settings/3', sourceDir: 'D:\\中文 素材', saveMode: 'overwrite', outputDir: 'D:\\输出', backupDir: 'D:\\备份', backupEnabled: true,
    pipeline: [{ id: 'first', resourceType: 'png', operation: 'compress', provider: 'test', enabled: true, parameters: {}, providerOptions: { level: 3, rate: .5, flag: false, mode: 'a', text: '长文本' } }],
};

export const task: Task = {
    id: 't1', createdAt: '2026-11-08T00:00:00Z', source: 'D:\\中文 素材', total: 10, completed: 6, pending: 3, failed: 1,
    backupCount: 6, restored: 0, restoreFailed: 0, restoreStarted: false, canResume: true, canRetry: true, canRestore: true, canContinueRestore: false, canRetryRestore: false,
};
