<script setup lang="ts">
// 工具页：每个处理工具的可用状态、获取方式与许可；以及当前识别的资源类型。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { isMissing } from '../core/model';
import type { Provider } from '../core/types';
import Icon from '../components/Icon.vue';
import StorageMaintenance from '../components/StorageMaintenance.vue';
import ServicePanel from '../components/ServicePanel.vue';

const bench = useWorkbench();
const { definition, boot, busy } = bench;
const list = computed(() => definition.value?.providers || []);
const ordered = computed(() => [...list.value].sort((a, b) => Number(isMissing(b)) - Number(isMissing(a))));
const missingCount = computed(() => list.value.filter(isMissing).length);
const installLabel = (provider: Provider) => ({ install: '获取并安装', update: '更新到核验版本', repair: '修复安装', reinstall: '重新安装' }[provider.dependency?.action || 'install']);
const dependencyStatus = (provider: Provider) => ({ missing: '尚未安装', unmanaged: '手动安装，未纳入校验', current: '已安装核验版本', update: '有新的核验版本', damaged: '安装文件需要修复' }[provider.dependency?.state || 'missing']);

function supports(provider: Provider) {
    const def = definition.value;
    return provider.supports.map(item => {
        const type = def?.resourceTypes.find(t => t.id === item.resourceType)?.displayName || item.resourceType;
        const operation = def?.operations.find(o => o.id === item.operation)?.displayName || item.operation;
        return `${type} ${operation}`;
    }).join('、');
}
</script>

<template>
  <div class="tools-page">
    <header class="commandbar">
      <p v-if="missingCount" class="tone missing health"><span class="missing-swatch" aria-hidden="true"></span>{{ missingCount }} 个工具缺少依赖。支持自动安装的工具可直接获取；手动安装后请刷新依赖状态。</p>
      <p v-else-if="list.length" class="tone ok health"><Icon name="ok" />全部 {{ list.length }} 个处理工具可用。</p>
      <span v-else></span>
      <button type="button" class="button" :disabled="busy" @click="bench.refreshProviders()"><Icon name="refresh" />刷新依赖状态</button>
    </header>

    <div class="scroll">
      <div class="sheet">
        <ServicePanel />
        <StorageMaintenance />
        <section class="block">
          <header class="block-head">
            <h2>处理工具</h2>
            <p class="muted">每个步骤由一个处理工具执行。缺少依赖的工具只影响用到它的步骤，其他功能照常可用。</p>
          </header>
          <ul class="providers">
            <li v-for="provider in ordered" :key="provider.id" :data-provider-id="provider.id">
              <details :open="isMissing(provider)">
                <summary>
                  <Icon name="chevron" :size="14" class="disclosure" />
                  <span class="name">{{ provider.displayName }}</span>
                  <span class="what muted">{{ supports(provider) }}</span>
                  <span v-if="isMissing(provider)" class="badge missing state"><span class="missing-swatch" aria-hidden="true"></span> 缺少依赖</span>
                  <span v-else-if="provider.dependency?.state === 'update'" class="badge warn state">有核验更新</span>
                  <span v-else class="badge ok state">可用</span>
                </summary>
                <div class="body">
                  <p v-if="isMissing(provider)" class="tone missing selectable" role="status">{{ provider.availability?.reason }}</p>
                  <section v-if="provider.dependency" class="installation" :aria-label="`${provider.displayName} 依赖管理`">
                    <template v-if="provider.dependency.automatic">
                      <div class="install-head">
                        <div>
                          <strong>{{ dependencyStatus(provider) }}</strong>
                          <p class="small muted">当前：{{ provider.dependency.installedVersion || '未核验' }}；可安装：{{ provider.dependency.targetVersion }}</p>
                        </div>
                        <button type="button" class="button" :class="{ primary: provider.dependency.state !== 'current' }" :disabled="busy" @click="bench.installDependency(provider)"><Icon v-if="provider.dependency.state !== 'current'" name="download" />{{ installLabel(provider) }}</button>
                      </div>
                      <p class="small muted">下载来源：{{ provider.dependency.sources?.join('、') }}。校验摘要和加载能力后启用，原安装保留。</p>
                      <p class="small muted">{{ provider.dependency.reason }}</p>
                    </template>
                    <p v-else class="small muted">手动安装：{{ provider.dependency.reason }}</p>
                  </section>
                  <template v-if="provider.acquisition">
                    <p class="selectable">{{ provider.acquisition.instructions }}</p>
                    <p class="source-line"><a class="button small" :href="provider.acquisition.url" target="_blank" rel="noopener noreferrer" @click.prevent="bench.openSource(provider.id)">打开获取页面<Icon name="external" :size="14" /></a><span class="path muted">{{ provider.acquisition.url }}</span></p>
                    <dl class="facts small">
                      <dt>核验版本</dt><dd>{{ provider.acquisition.version }}</dd>
                      <dt>核验日期</dt><dd>{{ provider.acquisition.checkedAt }}</dd>
                      <dt>许可</dt><dd>{{ provider.acquisition.license }}</dd>
                      <dt>分发</dt><dd>{{ provider.acquisition.redistribution }}</dd>
                      <dt>源码</dt><dd class="path">{{ provider.acquisition.source }}</dd>
                      <dt>扩展版本</dt><dd>{{ provider.version }}</dd>
                    </dl>
                  </template>
                  <p v-else class="muted">这个本地扩展没有登记获取渠道，请向扩展的维护者获取依赖。</p>
                </div>
              </details>
            </li>
          </ul>
        </section>

        <section v-if="definition" class="block">
          <header class="block-head"><h2>识别的资源类型</h2></header>
          <div class="grid-frame">
            <table class="table">
              <thead><tr><th>资源类型</th><th>扩展名</th><th>可用操作</th></tr></thead>
              <tbody>
                <tr v-for="type in definition.resourceTypes" :key="type.id">
                  <td>{{ type.displayName }}</td>
                  <td class="path">{{ type.extensions.join(' ') }}</td>
                  <td>{{ definition.operations.filter(o => definition!.providers.some(p => p.supports.some(s => s.resourceType === type.id && s.operation === o.id))).map(o => o.displayName).join('、') || '无' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <p v-if="boot?.root" class="small muted">核心目录 <span class="path">{{ boot.root }}</span>，Node {{ boot.nodeVersion }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tools-page { display: flex; flex-direction: column; min-height: 0; }
.commandbar { flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); min-height: var(--command-height); padding: var(--s-1) var(--s-3) var(--s-1) var(--s-4); border-bottom: 1px solid var(--border-soft); background: var(--pane); }
.health { display: flex; align-items: center; gap: 6px; min-width: 0; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; }
.sheet { display: grid; gap: var(--s-6); max-width: 880px; padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.block { display: grid; gap: var(--s-2); }
.block-head { display: grid; gap: 2px; }

/* 工具列表：一个面板内的可展开行 */
.providers { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); overflow: hidden; }
.providers > li + li { border-top: 1px solid var(--border-soft); }
summary {
  display: grid;
  grid-template-columns: 14px minmax(120px, 1fr) minmax(0, 1.4fr) max-content;
  gap: var(--s-3);
  align-items: center;
  min-height: 40px;
  padding: var(--s-1) var(--s-3);
  list-style: none;
}
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--hover); }
summary:focus-visible { outline-offset: -2px; }
.disclosure { color: var(--text-2); transition: transform 0.12s ease; }
details[open] .disclosure { transform: rotate(90deg); }
.name { font-weight: 600; }
.what { font-size: var(--t-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { display: grid; gap: var(--s-2); padding: var(--s-1) var(--s-4) var(--s-4) 38px; overflow-wrap: anywhere; }
.installation { display: grid; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-control); background: var(--pressed); }
.install-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s-3); }
.source-line { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
a.button { text-decoration: none; }
.grid-frame { border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); overflow: hidden; }
.grid-frame .table tr:last-child td { border-bottom: 0; }
</style>
