<script setup lang="ts">
// 工具页：每个处理工具的可用状态、获取方式与许可；以及当前识别的资源类型。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { isMissing } from '../core/model';
import type { Provider } from '../core/types';

const bench = useWorkbench();
const { definition, boot, busy } = bench;
const list = computed(() => definition.value?.providers || []);
const ordered = computed(() => [...list.value].sort((a, b) => Number(isMissing(b)) - Number(isMissing(a))));
const missingCount = computed(() => list.value.filter(isMissing).length);

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
    <div class="sheet">
      <header class="head">
        <div>
          <h2>处理工具</h2>
          <p class="muted">每个步骤由一个处理工具执行。缺少依赖的工具只影响用到它的步骤，其他功能照常可用。</p>
        </div>
        <button type="button" class="button" :disabled="busy" @click="bench.refreshProviders()">刷新依赖状态</button>
      </header>

      <p v-if="missingCount" class="callout missing"><span class="missing-swatch" aria-hidden="true"></span><span>{{ missingCount }} 个工具缺少依赖。按下方说明安装后点击“刷新依赖状态”。</span></p>
      <p v-else-if="list.length" class="callout ok">全部 {{ list.length }} 个处理工具可用。</p>

      <ul class="providers">
        <li v-for="provider in ordered" :key="provider.id" :data-provider-id="provider.id">
          <details :open="isMissing(provider)">
            <summary>
              <span class="disclosure" aria-hidden="true"></span>
              <span class="name">{{ provider.displayName }}</span>
              <span class="what muted">{{ supports(provider) }}</span>
              <span v-if="isMissing(provider)" class="tone missing state"><span class="missing-swatch" aria-hidden="true"></span> 缺少依赖</span>
              <span v-else class="tone ok state">可用</span>
            </summary>
            <div class="body">
              <p v-if="isMissing(provider)" class="tone missing" role="status">{{ provider.availability?.reason }}</p>
              <template v-if="provider.acquisition">
                <p>{{ provider.acquisition.instructions }}</p>
                <p><a :href="provider.acquisition.url" target="_blank" rel="noopener noreferrer" @click.prevent="bench.openSource(provider.id)">打开获取页面</a> <span class="path muted small">{{ provider.acquisition.url }}</span></p>
                <dl class="facts">
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

      <section v-if="definition" class="types">
        <h3>识别的资源类型</h3>
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
      </section>

      <p v-if="boot?.root" class="small muted">核心目录 <span class="path">{{ boot.root }}</span>，Node {{ boot.nodeVersion }}</p>
    </div>
  </div>
</template>

<style scoped>
.tools-page { overflow-y: auto; background: var(--paper); }
.sheet { display: grid; gap: var(--s-5); max-width: 860px; padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s-4); flex-wrap: wrap; }
.head > .button { flex: none; }
.head > div { display: grid; gap: var(--s-2); max-width: 60ch; }
h2 { font-size: var(--t-heading); }
h3 { font-size: var(--t-body); margin-bottom: var(--s-2); }
.callout { align-items: center; }
.providers { list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--ink); }
.providers > li { border-bottom: 1px solid var(--rule-soft); }
summary {
  display: grid;
  grid-template-columns: 12px minmax(140px, 1fr) minmax(0, 1.4fr) max-content;
  gap: var(--s-4);
  align-items: baseline;
  padding: var(--s-4) var(--s-3);
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--paper-sunk); }
.disclosure { width: 8px; height: 8px; border-right: 2px solid var(--ink-2); border-bottom: 2px solid var(--ink-2); transform: rotate(-45deg); align-self: center; }
details[open] .disclosure { transform: rotate(45deg); }
details[open] summary { background: var(--paper-sunk); }
summary:hover .name { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--ink-3); }
.name { font-weight: 600; }
.what { font-size: var(--t-small); }
.state { display: inline-flex; align-items: center; gap: var(--s-1); font-size: var(--t-small); }
.body { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-3) var(--s-5); max-width: 76ch; overflow-wrap: anywhere; }
a { color: var(--focus); font-weight: 500; }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-4); margin: 0; font-size: var(--t-small); }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; }
@media (max-width: 760px) {
  summary { grid-template-columns: 12px minmax(0, 1fr) max-content; gap: var(--s-2) var(--s-3); }
  .what { grid-column: 2 / -1; grid-row: 2; }
}
</style>
