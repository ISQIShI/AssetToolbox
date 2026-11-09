<script setup lang="ts">
import type { Provider } from './types';
defineProps<{ providers: Provider[]; disabled?: boolean }>();
const emit = defineEmits<{ refresh: []; 'open-source': [id: string] }>();
</script>
<template>
  <section class="panel provider-inventory" aria-label="提供方与获取渠道">
    <div class="section-heading"><div><h2>提供方与获取渠道</h2><p>缺少工具时按说明安装，再刷新检查；未启用的提供方不影响其他功能。</p></div><button :disabled="disabled" @click="emit('refresh')">刷新依赖状态</button></div>
    <details v-for="provider in providers" :key="provider.id" :open="provider.availability?.available === false" :data-provider-id="provider.id">
      <summary>{{ provider.displayName }} <span class="badge" :class="provider.availability?.available === false ? 'conflict' : 'restored'">{{ provider.availability?.available === false ? '缺少依赖' : '可用' }}</span></summary>
      <p v-if="provider.availability?.available === false" class="provider-warning" role="status">{{ provider.availability.reason }}</p>
      <template v-if="provider.acquisition">
        <p>{{ provider.acquisition.instructions }}</p>
        <a :href="provider.acquisition.url" target="_blank" rel="noopener noreferrer" @click.prevent="emit('open-source', provider.id)">打开获取页面</a>
        <p class="provider-url">{{ provider.acquisition.url }}</p>
        <p class="muted">已核验版本：{{ provider.acquisition.version }} · {{ provider.acquisition.checkedAt }}</p>
        <p class="muted">许可：{{ provider.acquisition.license }}</p><p class="muted">{{ provider.acquisition.redistribution }}</p>
      </template>
      <p v-else class="muted">此本地扩展未登记获取渠道，请向扩展维护者获取依赖。</p>
    </details>
  </section>
</template>
