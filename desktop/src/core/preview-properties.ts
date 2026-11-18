// 仅供无核心的浏览器视觉预览；真实目录与数值始终由核心属性模块提供。
import type { ResourceProperty } from './types';
export const previewProperties: ResourceProperty[] = [
    { id: 'audio-duration', label: '音频时长', unit: 's', min: 0, type: 'number', version: '1.0.0', group: 'audio', resourceTypes: ['flac', 'wav'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
    { id: 'audio-sample-rate', label: '采样率', unit: 'Hz', min: 1, type: 'number', version: '1.0.0', group: 'audio', resourceTypes: ['flac', 'wav'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
    { id: 'audio-channels', label: '声道数', min: 1, type: 'number', version: '1.0.0', group: 'audio', resourceTypes: ['flac', 'wav'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
    { id: 'resource-kind', label: '资源种类', type: 'string', version: '1.0.0', group: 'file', resourceTypes: ['png', 'jpg', 'mp3', 'wav', 'flac', 'ogg'], operators: ['eq', 'ne', 'contains'] },
    { id: 'file-size', label: '文件大小', unit: 'B', type: 'number', version: '1.0.0', group: 'file', resourceTypes: ['png', 'jpg', 'mp3', 'wav', 'flac', 'ogg'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
    { id: 'resource-type', label: '资源类型 ID', type: 'string', version: '1.0.0', group: 'file', resourceTypes: ['png', 'jpg', 'mp3', 'wav', 'flac', 'ogg'], operators: ['eq', 'ne'] },
    { id: 'image-width', label: '图片宽度', unit: 'px', type: 'number', version: '1.0.0', group: 'image', resourceTypes: ['png', 'jpg'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
    { id: 'image-height', label: '图片高度', unit: 'px', type: 'number', version: '1.0.0', group: 'image', resourceTypes: ['png', 'jpg'], operators: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] },
];
