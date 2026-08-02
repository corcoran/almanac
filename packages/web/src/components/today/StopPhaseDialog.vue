<script setup lang="ts">
import { NutritionPhaseResponseSchema } from "@almanac/core/schemas";
import { onMounted, ref, useId } from "vue";
import type { ApiClient } from "../../api/client.js";

const props = defineProps<{
  client: ApiClient;
  phase: { id: number; started_on: string };
  today: string; // YYYY-MM-DD, the default end date
}>();

const emit = defineEmits<{
  (e: "stopped"): void;
  (e: "close"): void;
}>();

// A11y: title id wired to aria-labelledby; focus the dialog root on mount so the
// Escape handler is reachable without a click first.
const titleId = useId();
const dialogRef = ref<HTMLDivElement | null>(null);
onMounted(() => dialogRef.value?.focus());

const endDate = ref<string>(props.today);
const error = ref<string | null>(null);
const pending = ref(false);

async function onConfirm(): Promise<void> {
  if (pending.value) return;
  error.value = null;

  // Plain string comparison is correct for fixed-width YYYY-MM-DD.
  if (endDate.value < props.phase.started_on) {
    error.value = `End date can't be before the phase started (${props.phase.started_on}).`;
    return;
  }

  pending.value = true;
  try {
    await props.client.patch(
      `/v1/nutrition-phases/${props.phase.id}`,
      { ended_on: endDate.value },
      NutritionPhaseResponseSchema,
    );
    emit("stopped");
    emit("close");
  } catch (e) {
    error.value =
      e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
    pending.value = false;
  }
}

function onCancel(): void {
  emit("close");
}
</script>

<template>
  <div
    ref="dialogRef"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    tabindex="-1"
    data-test="stop-phase-dialog"
    @keydown.esc="onCancel"
  >
    <div class="modal">
      <h3 :id="titleId" class="title">End this phase?</h3>
      <p class="blurb">
        Your phase stays in your history. You can start a new one anytime.
      </p>

      <div class="end-row">
        <label for="spd-end">End date</label>
        <input
          id="spd-end"
          v-model="endDate"
          type="date"
          data-test="end-date"
          @keydown.esc="onCancel"
        />
      </div>

      <p v-if="error" class="form-error" data-test="error">{{ error }}</p>

      <div class="actions">
        <button
          type="button"
          class="primary"
          data-test="confirm"
          :disabled="pending"
          @click="onConfirm"
        >
          {{ pending ? "Ending…" : "End phase" }}
        </button>
        <button type="button" class="ghost" data-test="cancel" :disabled="pending" @click="onCancel">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-1, #262a36);
  border-radius: 10px;
  padding: 20px 22px;
  min-width: 380px;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.blurb {
  margin: 0;
  font-size: 13px;
  color: var(--ink-faint, #9aa0ad);
}
.end-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-faint, #9aa0ad);
}
.end-row input {
  padding: 5px 8px;
  font-size: 13px;
  background: var(--surface-2, #1f2330);
  color: inherit;
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 5px;
  color-scheme: dark;
}
.form-error {
  margin: 0;
  font-size: 12px;
  color: var(--bad, #f08a8a);
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
.primary:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.ghost {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .modal {
    min-width: 0;
    max-width: none;
    width: calc(100vw - 32px);
    margin: 16px;
  }
}
</style>
