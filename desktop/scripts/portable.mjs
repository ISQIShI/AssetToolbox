import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(path.join(root, 'runtime'), { recursive: true });
if (!existsSync(path.join(root, 'runtime/node.exe'))) copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
copyFileSync(path.join(root, 'desktop/src-tauri/target/release/resource-compressor.exe'), path.join(root, 'ResourceCompressor.exe'));
console.log('已生成工具根目录中的 ResourceCompressor.exe；移动时请带上 resCompress 和 runtime。');
