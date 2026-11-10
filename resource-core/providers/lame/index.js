module.exports = {
    apiVersion: 2, version: '3.0.0', displayName: 'LAME 4.0',
    adapters: { 'compress': require('./adapters/compress') },
    executableName: 'lame.exe',
    requiredFiles: ['libmpg123-0.dll'],
};
