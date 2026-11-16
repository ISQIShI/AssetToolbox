<script setup lang="ts">
// 数值输入：输入框右侧带一对步进按钮；范围有限且档位不多时，左侧再配一个滑块。
// 值的含义、范围与步长全部来自调用方（核心返回的字段描述），这里不内置任何参数知识。
// 数字框是唯一带标签、可聚焦的控件（方向键即可步进）；滑块和步进按钮是鼠标用的辅助，不进入 Tab 顺序和无障碍树。
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps<{ id: string; modelValue: number | string | boolean | null | undefined; min?: number; max?: number; step?: number; decimalPlaces?: number; disabled?: boolean; invalid?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: number | ''] }>();

const SLIDER_STOPS = 200;
const step = computed(() => props.step || 1);
/** 两端都有界、且档位不超过 200 个时才值得用滑块；像素宽度这类大范围只用输入框。 */
const slidable = computed(() => props.min !== undefined && props.max !== undefined && props.max > props.min && (props.max - props.min) / step.value <= SLIDER_STOPS);
const numeric = computed(() => props.modelValue === '' || props.modelValue == null ? NaN : Number(props.modelValue));
const sliderValue = computed(() => Number.isFinite(numeric.value) ? Math.min(props.max!, Math.max(props.min!, numeric.value)) : props.min!);
const fill = computed(() => slidable.value ? `${(sliderValue.value - props.min!) / (props.max! - props.min!) * 100}%` : '0%');
const title = computed(() => props.min !== undefined && props.max !== undefined ? `${props.min}–${props.max}` : undefined);

/** 消除浮点累加误差：按声明的小数位（或步长的小数位）取整。 */
function tidy(value: number) {
    const places = props.decimalPlaces ?? (String(step.value).split('.')[1]?.length || 0);
    return Number(value.toFixed(places));
}
function clamp(value: number) { return Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, value)); }
function nudge(direction: 1 | -1) {
    const base = Number.isFinite(numeric.value) ? numeric.value : (props.min ?? 0);
    emit('update:modelValue', tidy(clamp(base + direction * step.value)));
}
function typed(event: Event) { const raw = (event.target as HTMLInputElement).value; emit('update:modelValue', raw === '' ? '' : Number(raw)); }
const atMin = computed(() => props.min !== undefined && Number.isFinite(numeric.value) && numeric.value <= props.min);
const atMax = computed(() => props.max !== undefined && Number.isFinite(numeric.value) && numeric.value >= props.max);
</script>

<template>
  <div class="number-field" :class="{ slidable }">
    <span class="box" :class="{ invalid, disabled }">
      <input :id="id" class="input number" type="number" inputmode="decimal" :value="modelValue" :min="min" :max="max" :step="step" :disabled="disabled" :aria-invalid="invalid ? 'true' : undefined" :title="title" @input="typed">
      <span class="steppers" aria-hidden="true">
        <button type="button" tabindex="-1" :disabled="disabled || atMax" @click="nudge(1)"><Icon name="chevron" :size="10" /></button>
        <button type="button" tabindex="-1" :disabled="disabled || atMin" @click="nudge(-1)"><Icon name="chevron" :size="10" /></button>
      </span>
    </span>
    <input v-if="slidable" class="slider" type="range" tabindex="-1" aria-hidden="true" :min="min" :max="max" :step="step" :value="sliderValue" :disabled="disabled" :style="{ '--fill': fill }" @input="emit('update:modelValue', tidy(Number(($event.target as HTMLInputElement).value)))">
  </div>
</template>

<style scoped>
.number-field { display: flex; align-items: center; gap: var(--s-3); min-width: 0; }
.box { position: relative; flex: none; display: flex; width: 104px; }
.number { width: 100%; padding-right: 22px; appearance: textfield; }
.number::-webkit-inner-spin-button, .number::-webkit-outer-spin-button { appearance: none; margin: 0; }
.invalid .number { border-color: var(--danger); }
/* 步进按钮：贴在输入框右侧内缘的一对小箭头 */
.steppers { position: absolute; top: 1px; right: 1px; bottom: 1px; display: grid; grid-template-rows: 1fr 1fr; width: 20px; border-left: 1px solid var(--border-soft); }
.steppers button { display: grid; place-items: center; padding: 0; border: 0; background: none; color: var(--text-2); }
.steppers button:first-child { border-top-right-radius: calc(var(--r-control) - 1px); }
.steppers button:last-child { border-bottom-right-radius: calc(var(--r-control) - 1px); }
.steppers button:first-child .icon { transform: rotate(-90deg); }
.steppers button:last-child .icon { transform: rotate(90deg); }
.steppers button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.steppers button:active:not(:disabled) { background: var(--pressed); }
.steppers button:disabled { color: var(--border); }

/* 滑块：细轨道，已选部分为强调色；排在输入框左侧 */
.slider { order: -1; flex: 1 1 120px; min-width: 80px; max-width: 204px; height: var(--control-height); margin: 0; appearance: none; background: none; }
.slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--accent) var(--fill), var(--pressed) var(--fill)); }
.slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; margin-top: -5px; border: 2px solid var(--accent); border-radius: 50%; background: var(--control); }
.slider:hover:not(:disabled)::-webkit-slider-thumb { background: var(--accent-wash); }
.slider:active:not(:disabled)::-webkit-slider-thumb { background: var(--accent); }
.slider:focus-visible { outline: none; }
.slider:focus-visible::-webkit-slider-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
.slider:disabled::-webkit-slider-runnable-track { background: var(--pressed); }
.slider:disabled::-webkit-slider-thumb { border-color: var(--border); }
</style>
