<script setup lang="ts">
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItemIndicator } from 'reka-ui';
import { flattenOptions, isSelectGroup, type SelectEntry } from '../core/select-options';
import Icon from './Icon.vue';
defineProps<{ options: SelectEntry[]; modelValue: string }>();
const emit = defineEmits<{ choose: [value: string] }>();
</script>

<template>
  <DropdownMenuRadioGroup :model-value="modelValue" @update:model-value="emit('choose', String($event))">
    <template v-for="entry in options" :key="isSelectGroup(entry) ? 'group:' + entry.label : entry.value">
      <DropdownMenuSub v-if="isSelectGroup(entry)">
        <DropdownMenuSubTrigger class="select-item cascade-branch" :disabled="!flattenOptions(entry.items).some(item => item.value && !item.disabled)" :data-values="JSON.stringify(flattenOptions(entry.items).map(item => item.value))">
          <span>{{ entry.label }}</span><Icon name="chevron" :size="12" />
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent class="cascade-popup" :side-offset="2" :collision-padding="8" loop>
            <SelectMenuItems :options="entry.items" :model-value="modelValue" @choose="emit('choose', $event)" />
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuRadioItem v-else-if="entry.value !== ''" class="select-item" :value="entry.value" :disabled="entry.disabled" :data-value="entry.value">
        <DropdownMenuItemIndicator class="select-check"><Icon name="check" :size="14" /></DropdownMenuItemIndicator>{{ entry.label }}
      </DropdownMenuRadioItem>
    </template>
  </DropdownMenuRadioGroup>
</template>
