module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '文件属性', common: true,
    fields: {
        'file-size': { type: 'number', label: '文件大小', unit: 'B', min: 0 },
        'file-name': { type: 'string', label: '文件名（含扩展名）' },
        'relative-path': { type: 'string', label: '相对路径（/ 分隔）' },
        extension: { type: 'string', label: '扩展名（小写，含点）' },
        'resource-type': { type: 'string', label: '资源类型 ID' },
        'resource-kind': { type: 'string', label: '资源种类' },
    },
    read({ filename, relativePath, resourceType, stat, buffer }) {
        const path = require('node:path');
        return { 'file-size': buffer ? buffer.length : stat.size, 'file-name': path.basename(filename),
            'relative-path': relativePath.split(path.sep).join('/'), extension: path.extname(filename).toLowerCase(),
            'resource-type': resourceType.id, 'resource-kind': resourceType.kind };
    },
};
