const { dimensions } = require('./metadata');
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '图片属性', common: false,
    fields: {
        'image-width': { type: 'number', label: '图片宽度（JPEG 按 EXIF 方向）', unit: 'px', min: 1 },
        'image-height': { type: 'number', label: '图片高度（JPEG 按 EXIF 方向）', unit: 'px', min: 1 },
        'image-pixels': { type: 'number', label: '图片总像素数', unit: 'px²', min: 1 },
        'image-aspect-ratio': { type: 'number', label: '图片宽高比', min: 0 },
    },
    read({ readPrefix, resourceType }) {
        const { width, height } = dimensions(readPrefix(1024 * 1024), resourceType.id);
        return { 'image-width': width, 'image-height': height, 'image-pixels': width * height, 'image-aspect-ratio': width / height };
    },
};
