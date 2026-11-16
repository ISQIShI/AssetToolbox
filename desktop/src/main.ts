import { createApp } from 'vue';
import './styles/tokens.css';
import './styles/base.css';
import { initTheme } from './core/theme';
import App from './App.vue';

initTheme();

// 这是桌面软件而不是网页：屏蔽浏览器的右键菜单（文本输入除外）、刷新和打印快捷键，
// 避免误触后丢失未保存的编辑或跳出应用界面。开发模式保留，便于调试。
if (import.meta.env.PROD) {
    window.addEventListener('contextmenu', event => {
        if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) event.preventDefault();
    });
    window.addEventListener('keydown', event => {
        const key = event.key.toLowerCase();
        if (key === 'f5' || key === 'f3' || key === 'f7' || (event.ctrlKey && ['r', 'p', 'f', 'g', 'u', 'j'].includes(key))) event.preventDefault();
    }, true);
}

createApp(App).mount('#app');
