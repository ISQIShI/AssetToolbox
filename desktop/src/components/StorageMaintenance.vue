<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { bytes, date } from '../core/model';
import Icon from './Icon.vue';

const bench = useWorkbench();
const { busy, maintenanceBusy, storagePreview } = bench;
const retentionDays = ref<number | string>(30);
const selected = ref<string[]>([]);
const offset = ref(0);
const inputId = useId();
const validDays = computed(() => Number.isInteger(retentionDays.value) && Number(retentionDays.value) >= 1 && Number(retentionDays.value) <= 3650);
const selection = computed(() => (storagePreview.value?.items || []).filter(item => item.eligible && item.fingerprint && selected.value.includes(item.jobId)).map(item => ({ jobId: item.jobId, fingerprint: item.fingerprint! })));
const selectedBytes = computed(() => (storagePreview.value?.items || []).filter(item => selected.value.includes(item.jobId)).reduce((total, item) => total + item.bytes, 0));
watch(retentionDays, () => { selected.value = []; storagePreview.value = undefined; offset.value = 0; });
watch(storagePreview, () => { selected.value = []; });
async function preview(next = 0) { offset.value = next; await bench.previewStorage(Number(retentionDays.value), next); }
async function clean() { await bench.cleanStorage(selection.value); offset.value = 0; }
const modes: Record<string, string> = { process: '处理', preview: '扫描预览', resume: '续跑', retry: '重试', restore: '恢复', 'restore-retry': '重试恢复', 'restore-preview': '检查备份', 'restore-export': '导出备份', 'restore-export-preview': '检查独立备份', 'dependency-install': '依赖安装' };
</script>

<template>
  <details class="storage">
    <summary class="tool-panel-heading"><Icon name="chevron" :size="14" /><strong>存储维护</strong><span class="panel-description">手动清理旧报告与执行明细</span></summary>
    <div class="storage-body">
      <p class="muted">先预览，再选择要清理的作业。任务日志、原素材、输出文件、备份和幂等记录始终保留；清理后无法打开这些作业的报告或查询明细。</p>
      <div class="storage-commands">
        <label :for="inputId">保留最近</label><input :id="inputId" v-model.number="retentionDays" class="input days" type="number" min="1" max="3650" step="1" :disabled="busy" /><span>天</span>
        <button type="button" class="button" :disabled="busy || !validDays" @click="preview()"><Icon name="scan" />预览清理范围</button>
      </div>
      <p v-if="!validDays" class="tone warn">保留天数必须为 1–3650 的整数。</p>
      <p v-if="maintenanceBusy" role="status">正在核对文件与记录，请稍候。</p>
      <template v-if="storagePreview">
        <p class="small muted">{{ storagePreview.eligibleCount }} 个作业可清理，明细 {{ bytes(storagePreview.eligibleBytes) }}；{{ storagePreview.protectedCount }} 个作业保留。释放空间需扣除保留的清理记录。</p>
        <div v-if="storagePreview.items.length" class="grid-frame storage-table">
          <table class="table">
            <thead><tr><th>选择 / 作业</th><th>可删除明细</th><th>核对结果</th></tr></thead>
            <tbody>
              <tr v-for="item in storagePreview.items" :key="item.jobId">
                <td><label class="storage-choice"><input v-model="selected" type="checkbox" :value="item.jobId" :disabled="busy || !item.eligible" :aria-label="`清理作业 ${item.jobId}`" /><span>{{ modes[item.mode] || item.mode || '未知作业' }}<small>{{ item.createdAt ? date(item.createdAt) : '记录无法读取' }}</small><code :title="item.jobId">{{ item.jobId.slice(0, 12) }}</code></span></label></td>
                <td>{{ bytes(item.bytes) }}</td><td>{{ item.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="muted">还没有作业记录。</p>
        <div class="storage-commands">
          <button type="button" class="button small" :disabled="busy || !storagePreview.items.some(item => item.eligible)" @click="selected = storagePreview.items.filter(item => item.eligible).map(item => item.jobId)">选择本页可清理项</button>
          <button type="button" class="button quiet small" :disabled="busy || !selected.length" @click="selected = []">取消选择</button>
          <span class="small muted">已选 {{ selection.length }} 项，明细 {{ bytes(selectedBytes) }}</span>
          <button type="button" class="button danger" :disabled="busy || !selection.length" @click="clean()"><Icon name="trash" />清理所选 {{ selection.length }} 项</button>
        </div>
        <div v-if="storagePreview.total > 100" class="storage-commands small">
          <span>{{ offset + 1 }}–{{ offset + storagePreview.items.length }} / {{ storagePreview.total }} 项</span>
          <button type="button" class="button small" :disabled="busy || offset === 0" @click="preview(Math.max(0, offset - 100))">上一页</button>
          <button type="button" class="button small" :disabled="busy || storagePreview.nextOffset === null" @click="preview(storagePreview.nextOffset!)">下一页</button>
        </div>
      </template>
    </div>
  </details>
</template>

<style scoped>
.storage { border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); }
.storage-body { display: grid; gap: var(--s-3); padding: 0 var(--s-3) var(--s-3); }
.storage-commands { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.days { width: 90px; }
.storage-table { max-height: 360px; overflow: auto; }
.storage-table table { table-layout: fixed; width: 100%; }
.storage-table th:nth-child(1) { width: 40%; }
.storage-table th:nth-child(2) { width: 20%; }
.storage-table td { overflow-wrap: anywhere; white-space: normal; }
.storage-choice { display: flex; gap: var(--s-2); align-items: start; }
.storage-choice > span { display: grid; min-width: 0; }
.storage-choice small, .storage-choice code { color: var(--text-2); font-size: var(--t-small); }
</style>
