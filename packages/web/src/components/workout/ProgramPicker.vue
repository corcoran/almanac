<script setup lang="ts">
import { PROGRAM_PRESETS } from "@almanac/core/signals";
import { computed, ref } from "vue";

const props = defineProps<{
  templateCount: number;
}>();

const emit = defineEmits<(e: "pick", programId: "ppl" | "upper_lower") => void>();

// Prominent when the user has a sparse library; collapsible link otherwise.
const prominent = computed(() => props.templateCount <= 1);
const expanded = ref(false);
const showCards = computed(() => prominent.value || expanded.value);
</script>

<template>
  <div class="program-picker">
    <button v-if="!prominent && !expanded" type="button" class="program-link" @click="expanded = true">
      Start from a program
    </button>
    <template v-if="showCards">
      <div class="program-head">
        <span class="program-title">Start from a program</span>
      </div>
      <p class="program-sub">Seed a full split with exercises and default sets — tweak before saving.</p>
      <div class="program-grid">
        <button
          v-for="preset in PROGRAM_PRESETS"
          :key="preset.id"
          type="button"
          class="program-card"
          @click="emit('pick', preset.id)"
        >
          <span class="program-label">{{ preset.label }}</span>
          <span class="program-count">{{ preset.templates.length }} templates</span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.program-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.program-link {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--accent, #4a7dff);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.program-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.program-title {
  font-weight: 500;
  color: var(--ink, #e6e8ee);
}
.program-sub {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
  margin: 0;
}
.program-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.program-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--line-1, #262a36);
  border-radius: 8px;
  background: var(--surface-1, #161922);
  cursor: pointer;
}
.program-card:hover {
  border-color: var(--line-2, #353a4a);
}
.program-label {
  font-weight: 500;
  color: var(--ink, #e6e8ee);
}
.program-count {
  font-size: 11px;
  color: var(--ink-dim, #9aa0ad);
}
</style>
