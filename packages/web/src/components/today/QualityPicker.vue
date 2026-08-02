<script setup lang="ts">
const props = withDefaults(defineProps<{ modelValue: number | null; label?: string }>(), {
  label: "Quality",
});
const emit = defineEmits<(e: "update:modelValue", value: number | null) => void>();

const OPTIONS = [1, 2, 3, 4, 5] as const;

function pick(n: number): void {
  // Tapping the already-selected value clears it (unrated).
  emit("update:modelValue", props.modelValue === n ? null : n);
}
</script>

<template>
  <span class="quality-picker" role="group" :aria-label="label">
    <span class="q-lbl">qual</span>
    <button
      v-for="n in OPTIONS"
      :key="n"
      type="button"
      class="q-opt"
      data-test="quality-option"
      :aria-pressed="modelValue === n ? 'true' : 'false'"
      :aria-label="`Quality ${n} of 5`"
      @click="pick(n)"
    >
      {{ n }}
    </button>
  </span>
</template>

<style scoped>
.quality-picker {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.q-lbl {
  font-size: 10px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-right: 3px;
}
.q-opt {
  width: 24px;
  height: 26px;
  border: 1px solid var(--line-2, #353a4a);
  background: transparent;
  color: var(--ink-dim, #9aa0ad);
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  border-radius: 5px;
  cursor: pointer;
}
.q-opt[aria-pressed="true"] {
  background: var(--accent, #4a7dff);
  border-color: var(--accent, #4a7dff);
  color: #fff;
  font-weight: 600;
}
.q-opt:hover {
  border-color: var(--ink-dim, #9aa0ad);
}
</style>
