<script setup lang="ts">
import type { AudioResult } from '../core/types';
defineProps<{ results: AudioResult[]; total: number }>();
const number = (value: number | null | undefined, unit: string) => value == null ? '无法测量 / 不适用' : `${value.toFixed(1)} ${unit}`;
const names: Record<string, string> = { 'audio-analyze': '音频分析', 'audio-gain': '音频增益', 'audio-normalize': '响度归一化' };
</script>

<template>
  <details class="audio-results" open>
    <summary>音频测量与处理结果（{{ total }} 项）</summary>
    <p class="muted small">数值为该步骤的测量结果；文件失败时不会提交中间产物。完整明细见报告中的 audio.csv 与 report.json。</p>
    <p v-if="total > results.length" class="muted small">界面仅显示前 {{ results.length }} 项。</p>
    <article v-for="(row, index) in results" :key="index" class="audio-row">
      <strong class="path">{{ row.path }}</strong>
      <span>{{ names[row.operation] || row.operation }} · {{ row.fileStatus === 'failed' ? '未提交' : row.status === 'analyzed' ? '仅分析' : row.status === 'skipped' ? '未改动' : '已处理' }}</span>
      <p class="muted small">{{ row.before.codec }} · {{ row.before.sampleRate }} Hz · {{ row.before.channels }} 声道 · {{ number(row.before.durationSeconds, '秒') }}</p>
      <dl>
        <div><dt>输入响度</dt><dd>{{ number(row.before.integratedLufs, 'LUFS') }}</dd></div>
        <div><dt>输入真峰值</dt><dd>{{ number(row.before.truePeakDb, 'dBTP') }}</dd></div>
        <div><dt>采样峰值</dt><dd>{{ number(row.before.samplePeakDb, 'dBFS') }}</dd></div>
        <div><dt>响度范围</dt><dd>{{ number(row.before.loudnessRangeLu, 'LU') }}</dd></div>
        <template v-if="row.requestedGainDb !== undefined">
          <div><dt>请求 / 实际增益</dt><dd>{{ number(row.requestedGainDb, 'dB') }} / {{ number(row.appliedGainDb, 'dB') }}</dd></div>
        </template>
        <template v-if="row.after">
          <div><dt>输出响度</dt><dd>{{ number(row.after.integratedLufs, 'LUFS') }}</dd></div>
          <div><dt>输出真峰值</dt><dd>{{ number(row.after.truePeakDb, 'dBTP') }}</dd></div>
        </template>
      </dl>
      <p v-if="row.targetLufs !== undefined">目标 {{ row.targetLufs }} LUFS：{{ row.targetReached ? '已达到（±0.3 LU）' : '未达到' }}</p>
      <p v-if="row.message" class="tone warn selectable">{{ row.message }}</p>
    </article>
  </details>
</template>

<style scoped>
.audio-results { min-width: 0; }
summary { cursor: default; font-weight: 600; padding-block: var(--s-2); }
.audio-row { padding: var(--s-2); margin-top: var(--s-2); border: 1px solid var(--border-soft); border-radius: var(--r-panel); }
.audio-row > strong { display: block; overflow-wrap: anywhere; }
dl { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); margin-block: var(--s-2); }
dt { color: var(--text-2); font-size: var(--t-small); }
dd { margin: 0; font-variant-numeric: tabular-nums; }
</style>
