import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
    plugins: [vue()],
    clearScreen: false,
    server: {
        host: '127.0.0.1',
        port: 1420,
        strictPort: true,
        // 原生构建会锁定 EXE；前端热更新无需监听 Rust 源码与构建产物。
        watch: { ignored: ['**/src-tauri/**'] },
    },
    envPrefix: ['VITE_'],
    build: { target: 'es2022' },
});
