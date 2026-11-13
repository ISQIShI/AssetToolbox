<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { call } from '../core/api';
type Policy = { schema: string; sourceRoots: string[]; outputRoots: string[]; backupRoots: string[]; allowOverwrite: boolean; allowRestore: boolean; allowDependencyInstall: boolean; allowServiceManagement: boolean };
type Config = { port: number; mcp: boolean; policy: Policy };
type Snapshot = { configured: boolean; config: Config | null; state: string; owned: boolean; tokenFile: string | null; endpoints: { apiUrl: string; mcpUrl: string | null } | null };
const snapshot = ref<Snapshot>(), busy = ref(false), error = ref(''), connection = ref(''), opened = ref(false);
const port = ref(8787), mcp = ref(true), source = ref(''), output = ref(''), backup = ref('');
const overwrite = ref(false), restore = ref(false), install = ref(false), management = ref(false);
const labels: Record<string, string> = { stopped: '已停止', starting: '正在启动', running: '运行中', stopping: '正在安全停止', interrupted: '上次启动入口已退出' };
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
async function refresh(fill = false) {
    try {
        const value = await call<Snapshot>('service-status'); if (disposed) return;
        snapshot.value = value;
        if (fill && value.config) {
            const cfg = value.config; port.value = cfg.port; mcp.value = cfg.mcp;
            source.value = cfg.policy.sourceRoots.join('\n'); output.value = cfg.policy.outputRoots.join('\n'); backup.value = cfg.policy.backupRoots.join('\n');
            overwrite.value = cfg.policy.allowOverwrite; restore.value = cfg.policy.allowRestore; install.value = cfg.policy.allowDependencyInstall; management.value = cfg.policy.allowServiceManagement;
        }
    } catch (cause) { if (!disposed) { error.value = String(cause); snapshot.value = undefined; } }
}
async function tick() { await refresh(); if (!disposed && opened.value) timer = setTimeout(() => void tick(), 2000); }
async function toggle(event: Event) {
    opened.value = (event.target as HTMLDetailsElement).open; clearTimeout(timer);
    if (opened.value) { error.value = ''; await refresh(true); if (!disposed && opened.value) timer = setTimeout(() => void tick(), 2000); }
}
async function invoke(action: string, payload = {}) {
    if (busy.value) return; busy.value = true; error.value = ''; connection.value = '';
    try { const result = await call(action, payload); if (action === 'service-client-config') connection.value = JSON.stringify(result, null, 2); await refresh(); }
    catch (cause) { error.value = String(cause); }
    finally { busy.value = false; }
}
function save() {
    return invoke('service-configure', { port: port.value, mcp: mcp.value, policy: { schema: 'asset-toolbox.automation-policy/2', sourceRoots: lines(source.value), outputRoots: lines(output.value), backupRoots: lines(backup.value), allowOverwrite: overwrite.value, allowRestore: restore.value, allowDependencyInstall: install.value, allowServiceManagement: management.value } });
}
onUnmounted(() => { disposed = true; clearTimeout(timer); }); // 观察面板卸载不停止服务。
</script>

<template>
  <details class="services" @toggle="toggle">
    <summary>Agent 接入与服务管理 <span v-if="snapshot" class="muted">{{ labels[snapshot.state] }}</span></summary>
    <div class="body">
      <p>在本机开放 HTTP API，可同时启用 MCP HTTP。stdio 由 Agent 宿主启动。关闭启动服务的窗口或 CLI 会安全停止服务及其作业。</p>
      <p v-if="error" role="alert" class="callout danger selectable">{{ error }}</p>
      <div class="commands">
        <button class="button" :disabled="busy" @click="refresh(true)">刷新服务状态</button>
        <button class="button primary" :disabled="busy || !snapshot?.configured || ['running', 'starting', 'stopping'].includes(snapshot?.state || '')" @click="invoke('service-start')">启动服务</button>
        <button class="button" :disabled="busy || !['running', 'starting'].includes(snapshot?.state || '')" @click="invoke('service-stop')">安全停止服务</button>
      </div>
      <p v-if="snapshot?.endpoints" class="selectable">HTTP：{{ snapshot.endpoints.apiUrl }}<br v-if="snapshot.endpoints.mcpUrl"><span v-if="snapshot.endpoints.mcpUrl">MCP：{{ snapshot.endpoints.mcpUrl }}</span></p>
      <p v-if="snapshot?.state === 'running'" class="muted">{{ snapshot.owned ? '由当前入口持有。' : '由其他入口持有，关闭当前窗口不会停止它。' }}修改配置前请先安全停止。</p>
      <fieldset :disabled="busy || !snapshot || ['running', 'starting', 'stopping'].includes(snapshot.state)">
        <legend>服务配置</legend>
        <div class="commands"><label>端口 <input v-model.number="port" class="input port" type="number" min="0" max="65535" aria-label="服务端口"></label><label><input v-model="mcp" type="checkbox">同时启用 MCP HTTP</label></div>
        <p class="muted">固定监听 127.0.0.1；端口 0 自动分配。MCP 需要 agent-mcp 目录及其依赖。</p>
        <div class="roots">
          <label>可读取的素材目录<textarea v-model="source" class="input" rows="2" aria-label="服务素材目录" placeholder="每行一个绝对路径"></textarea></label>
          <label>可写入的输出目录<textarea v-model="output" class="input" rows="2" aria-label="服务输出目录" placeholder="每行一个绝对路径"></textarea></label>
          <label>可使用的备份目录<textarea v-model="backup" class="input" rows="2" aria-label="服务备份目录" placeholder="每行一个绝对路径"></textarea></label>
        </div>
        <div class="permissions">
          <label><input v-model="overwrite" type="checkbox">允许备份后覆盖</label><label><input v-model="restore" type="checkbox">允许恢复 / 导出备份</label>
          <label><input v-model="install" type="checkbox">允许安装核验依赖</label><label><input v-model="management" type="checkbox">允许 Agent 管理同权限服务</label>
        </div>
        <button class="button" :disabled="!Number.isInteger(port) || port < 0 || port > 65535" @click="save">保存服务配置</button>
      </fieldset>
      <div class="commands export"><button class="button" :disabled="busy || !snapshot?.configured" @click="invoke('service-client-config', { transport: 'stdio' })">生成 stdio 配置</button><button class="button" :disabled="busy || snapshot?.state !== 'running'" @click="invoke('service-client-config', { transport: 'http' })">生成 HTTP 连接配置</button></div>
      <p v-if="snapshot?.tokenFile" class="muted selectable">令牌文件：{{ snapshot.tokenFile }}。HTTP 客户端须读取并填入 Bearer 认证；界面和日志不显示令牌正文。</p>
      <textarea v-if="connection" class="input connection selectable" :value="connection" readonly rows="9" aria-label="Agent 连接配置"></textarea>
    </div>
  </details>
</template>

<style scoped>
.services { border-bottom: 1px solid var(--border); padding-bottom: var(--s-4); margin-bottom: var(--s-4); }
summary { font-weight: 600; padding: var(--s-2) 0; }
summary span { font-weight: normal; margin-left: var(--s-3); }
.body { padding-top: var(--s-2); }
.commands, .permissions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-3); }
.commands label { display: flex; align-items: center; gap: var(--s-2); }
.port { width: 90px; }
fieldset { margin-top: var(--s-3); padding: var(--s-3); border: 1px solid var(--border-soft); border-radius: var(--r-panel); min-width: 0; }
.roots { display: grid; gap: var(--s-3); grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.roots label { display: grid; gap: var(--s-1); }
textarea { height: auto; min-height: 60px; resize: vertical; font-family: var(--font-mono); }
.permissions, .export { margin: var(--s-3) 0; }
p { overflow-wrap: anywhere; }
.connection { width: 100%; height: 180px; }
</style>
