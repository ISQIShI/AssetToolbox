<script setup lang="ts">
import { computed, onUnmounted, ref, useId } from 'vue';
import { call } from '../core/api';
import Icon from './Icon.vue';
type Policy = { schema: string; sourceRoots: string[]; outputRoots: string[]; backupRoots: string[]; allowOverwrite: boolean; allowRestore: boolean; allowDependencyInstall: boolean; allowServiceManagement: boolean };
type Config = { port: number; mcp: boolean; policy: Policy };
type Snapshot = { configured: boolean; config: Config | null; state: string; owned: boolean; tokenFile: string | null; endpoints: { apiUrl: string; mcpUrl: string | null } | null };
const snapshot = ref<Snapshot>(), busy = ref(false), error = ref(''), connection = ref(''), opened = ref(false);
const port = ref(8787), mcp = ref(true), source = ref(''), output = ref(''), backup = ref('');
const overwrite = ref(false), restore = ref(false), install = ref(false), management = ref(false);
const labels: Record<string, string> = { stopped: '已停止', starting: '正在启动', running: '运行中', stopping: '正在安全停止', interrupted: '上次启动入口已退出' };
const id = useId();
const locked = computed(() => busy.value || !snapshot.value || ['running', 'starting', 'stopping'].includes(snapshot.value.state));
const statusLabel = computed(() => !snapshot.value ? '未读取状态' : !snapshot.value.configured ? '待配置' : labels[snapshot.value.state] || snapshot.value.state);
const statusTone = computed(() => snapshot.value?.state === 'running' ? 'ok' : ['starting', 'stopping', 'interrupted'].includes(snapshot.value?.state || '') ? 'warn' : '');
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
    <summary class="tool-panel-heading"><Icon name="chevron" :size="14" /><strong>Agent 接入与服务管理</strong><span class="panel-description">HTTP API · MCP</span><span v-if="snapshot" class="badge" :class="statusTone">{{ statusLabel }}</span></summary>
    <div class="body">
      <p v-if="error" role="alert" class="callout danger selectable">{{ error }}</p>
      <section class="service-section status-section" aria-label="服务运行状态">
        <div class="section-head"><h3>本机服务</h3><div class="commands">
          <button type="button" class="button quiet small" :disabled="busy" @click="refresh()"><Icon name="refresh" :size="14" />刷新服务状态</button>
          <button type="button" class="button primary small" :disabled="busy || !snapshot?.configured || ['running', 'starting', 'stopping'].includes(snapshot?.state || '')" @click="invoke('service-start')"><Icon name="play" :size="14" />启动服务</button>
          <button type="button" class="button small" :disabled="busy || !['running', 'starting'].includes(snapshot?.state || '')" @click="invoke('service-stop')">安全停止服务</button>
        </div></div>
        <p v-if="!snapshot?.configured" class="muted small">先配置访问目录并保存，再启动 HTTP 服务。stdio 由 Agent 宿主启动。</p>
        <p v-else class="muted small">关闭启动服务的窗口或 CLI 时安全停止服务及其作业；收起面板不停止服务。</p>
        <dl v-if="snapshot?.endpoints" class="facts small endpoints"><dt>HTTP API</dt><dd class="path">{{ snapshot.endpoints.apiUrl }}</dd><template v-if="snapshot.endpoints.mcpUrl"><dt>MCP HTTP</dt><dd class="path">{{ snapshot.endpoints.mcpUrl }}</dd></template></dl>
        <p v-if="snapshot?.state === 'running'" class="muted small">{{ snapshot.owned ? '由当前入口持有。' : '由其他入口持有，关闭当前窗口不会停止它。' }}修改配置前请先安全停止。</p>
      </section>
      <fieldset class="service-section configuration" :disabled="locked">
        <legend class="visually-hidden">服务配置</legend>
        <div class="section-head"><h3>访问配置</h3><button type="button" class="button small" :disabled="!Number.isInteger(port) || port < 0 || port > 65535" @click="save"><Icon name="save" :size="14" />保存服务配置</button></div>
        <div class="field"><label :for="`${id}-port`" class="label">服务端口</label><div class="commands"><input :id="`${id}-port`" v-model.number="port" class="input port" type="number" min="0" max="65535" aria-label="服务端口"><label class="check"><input v-model="mcp" type="checkbox">同时启用 MCP HTTP</label></div><p class="hint">仅监听 127.0.0.1；端口 0 自动分配。MCP 需要配套依赖。</p></div>
        <div class="roots">
          <div class="field"><label class="label" :for="`${id}-source`">素材目录 · 读取</label><textarea :id="`${id}-source`" v-model="source" class="input" rows="2" aria-label="服务素材目录" placeholder="每行一个绝对路径"></textarea></div>
          <div class="field"><label class="label" :for="`${id}-output`">输出目录 · 写入</label><textarea :id="`${id}-output`" v-model="output" class="input" rows="2" aria-label="服务输出目录" placeholder="每行一个绝对路径"></textarea></div>
          <div class="field"><label class="label" :for="`${id}-backup`">备份目录</label><textarea :id="`${id}-backup`" v-model="backup" class="input" rows="2" aria-label="服务备份目录" placeholder="每行一个绝对路径"></textarea></div>
        </div>
        <div class="field"><span class="label" :id="`${id}-permissions`">额外权限</span><div class="permissions" role="group" :aria-labelledby="`${id}-permissions`">
          <label><input v-model="overwrite" type="checkbox">允许备份后覆盖</label><label><input v-model="restore" type="checkbox">允许恢复 / 导出备份</label>
          <label><input v-model="install" type="checkbox">允许安装核验依赖</label><label><input v-model="management" type="checkbox">允许 Agent 管理同权限服务</label>
        </div><p class="hint">仅授权所需能力；未勾选的权限保持关闭。</p></div>
      </fieldset>
      <section class="service-section" aria-label="Agent 连接">
        <div class="section-head"><h3>Agent 连接</h3><div class="commands"><button type="button" class="button small" :disabled="busy || !snapshot?.configured" @click="invoke('service-client-config', { transport: 'stdio' })">生成 stdio 配置</button><button type="button" class="button small" :disabled="busy || snapshot?.state !== 'running'" @click="invoke('service-client-config', { transport: 'http' })">生成 HTTP 连接配置</button></div></div>
        <p class="muted small">stdio 可在保存配置后生成；HTTP 连接配置需先启动服务。</p>
        <dl v-if="snapshot?.tokenFile" class="facts small"><dt>令牌文件</dt><dd class="path">{{ snapshot.tokenFile }}</dd></dl>
        <p v-if="snapshot?.tokenFile" class="muted small">HTTP 客户端读取令牌并填入 Bearer 认证；界面不显示令牌正文。</p>
        <textarea v-if="connection" class="input connection selectable" :value="connection" readonly rows="9" aria-label="Agent 连接配置"></textarea>
      </section>
    </div>
  </details>
</template>

<style scoped>
.services { border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); min-width: 0; }
.body { display: grid; gap: var(--s-4); padding: 0 var(--s-3) var(--s-3); }
.service-section { display: grid; gap: var(--s-3); border: 0; border-top: 1px solid var(--border-soft); padding: var(--s-3) 0 0; margin: 0; min-width: 0; }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s-2); }
.commands { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
.commands label { display: flex; align-items: center; gap: var(--s-2); }
.port { width: 90px; }
.roots { display: grid; gap: var(--s-2); }
textarea { width: 100%; height: auto; min-height: 52px; resize: vertical; font-family: var(--font-mono); }
.permissions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2) var(--s-3); }
.permissions label { display: flex; align-items: start; gap: var(--s-2); }
p, dd { overflow-wrap: anywhere; }
.connection { width: 100%; height: 180px; }
</style>
