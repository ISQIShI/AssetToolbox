module.exports = {
    displayName: 'JPG / JPEG', order: 20, extensions: ['.jpg', '.jpeg'], enabledKey: 'jpgEnabled',
    defaults: { jpgEnabled: true, jpgQuality: 5 },
    limits: { jpgQuality: { label: 'JPG 质量', min: 0, max: 9 } },
    parameters: { jpgQuality: { hint: '0 不压缩；数值越高质量和体积越高。' } },
};
