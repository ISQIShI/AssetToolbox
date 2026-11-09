import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
mkdirSync(path.join(root, 'runtime'), { recursive: true });
if (!existsSync(path.join(root, 'runtime/node.exe'))) copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
copyFileSync(path.join(root, 'desktop/src-tauri/target/release/asset-toolbox.exe'), path.join(root, 'AssetToolbox.exe'));
console.log('已生成工具根目录中的 AssetToolbox.exe；移动时请带上 resource-core 和 runtime。');
