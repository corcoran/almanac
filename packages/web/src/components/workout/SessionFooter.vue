<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  rpe: number | null;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:rpe", value: number | null): void;
  (e: "endSession"): void;
}>();

const canEnd = computed(
  () => props.rpe !== null && Number.isInteger(props.rpe) && props.rpe >= 1 && props.rpe <= 10,
);

function onRpeInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === "") {
    emit("update:rpe", null);
    return;
  }
  const n = Number(raw);
  emit("update:rpe", Number.isFinite(n) ? n : null);
}

function onEndClick() {
  if (!canEnd.value) return;
  emit("endSession");
}
</script>

<template>
  <footer class="session-footer">
    <label class="rpe-row">
      <span class="rpe-label">Session RPE</span>
      <input
        data-test="rpe-input"
        class="rpe-input"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        :value="rpe ?? ''"
        @input="onRpeInput"
      />
      <span class="rpe-hint">1–10</span>
    </label>
    <button
      type="button"
      data-test="end-session"
      class="end-btn"
      :disabled="!canEnd || submitting"
      @click="onEndClick"
    >
      {{ submitting ? "Saving…" : "End Session" }}
    </button>
  </footer>
</template>

<style scoped>
.session-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--line-1, #262a36);
}
.rpe-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-faint, #9aa0ad);
}
.rpe-label {
  font-size: 13px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink, #e6e8ee);
}
.rpe-input {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: var(--ink, #e6e8ee);
  border-radius: 5px;
  padding: 6px 10px;
  width: 64px;
  text-align: right;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
}
.rpe-hint {
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
  font-variant-numeric: tabular-nums;
}
.end-btn {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.end-btn:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  cursor: not-allowed;
}
</style>
