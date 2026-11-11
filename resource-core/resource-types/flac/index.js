module.exports = { apiVersion: 1, version: '1.0.0', displayName: 'FLAC', kind: 'audio', extensions: ['.flac'], validate: data => data.length >= 4 && data.toString('ascii', 0, 4) === 'fLaC' };
