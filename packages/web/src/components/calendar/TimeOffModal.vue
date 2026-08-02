<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import type { ApiClient } from "../../api/client.js";
import { useUntrackedPeriodsStore } from "../../stores/untracked-periods.js";

const props = defineProps<{ client: ApiClient; month: string; today: string }>();
const emit = defineEmits<{ (e: "changed"): void; (e: "close"): void }>();

const titleId = useId();
const dialogRef = ref<HTMLDivElement | null>(null);
const store = useUntrackedPeriodsStore();

const startOn = ref("");
const endOn = ref("");
const reason = ref<"vacation" | "sick" | "deload">("vacation");
const createError = ref<string | null>(null);
const pending = ref(false);

onMounted(() => {
  dialogRef.value?.focus();
  void store.load(props.client);
});

// End defaults to start when the user hasn't picked one yet, but a typed end
// is preserved. Submit is blocked while either date is blank or end < start.
const effectiveEnd = computed(() => (endOn.value === "" ? startOn.value : endOn.value));
const datesInvalid = computed(
  () => startOn.value === "" || effectiveEnd.value === "" || effectiveEnd.value < startOn.value,
);
const submitDisabled = computed(() => pending.value || datesInvalid.value);

const reasonOptions: { value: "vacation" | "sick" | "deload"; label: string }[] = [
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick" },
  { value: "deload", label: "Deload" },
];

async function onCreate(): Promise<void> {
  if (submitDisabled.value) return;
  pending.value = true;
  createError.value = null;
  const result = await store.create(props.client, {
    started_on: startOn.value,
    ended_on: effectiveEnd.value,
    reason: reason.value,
  });
  pending.value = false;
  if (result.ok) {
    startOn.value = "";
    endOn.value = "";
    reason.value = "vacation";
    emit("changed");
  } else {
    createError.value = result.message;
  }
}

async function onDelete(id: number): Promise<void> {
  if (!window.confirm("Delete this time-off period?")) return;
  const result = await store.remove(props.client, id);
  if (result.ok) emit("changed");
}

function onClose(): void {
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
    data-test="time-off-modal"
    @keydown.esc="onClose"
  >
    <div class="modal">
      <h3 :id="titleId" class="title">Time off</h3>

      <div v-if="store.status === 'loading'" class="muted" data-test="to-loading">Loading…</div>
      <div v-else-if="store.status === 'error'" class="err" data-test="to-error">
        Couldn't load time-off periods.
      </div>
      <template v-else>
        <ul v-if="store.list.length > 0" class="period-list">
          <li v-for="p in store.list" :key="p.id" class="period-row" data-test="period-row">
            <span class="dates">{{ p.started_on }} – {{ p.ended_on }}</span>
            <span class="reason">· {{ p.reason }}</span>
            <button
              type="button"
              class="del"
              data-test="period-delete"
              aria-label="Delete period"
              @click="onDelete(p.id)"
            >
              ✕
            </button>
          </li>
        </ul>
        <p v-else class="muted" data-test="empty-state">No time off logged.</p>
      </template>

      <div class="create">
        <div class="grid">
          <label for="to-start">Start</label>
          <input id="to-start" v-model="startOn" type="date" data-test="start-on" @keydown.esc="onClose" />
          <label for="to-end">End</label>
          <input id="to-end" v-model="endOn" type="date" data-test="end-on" @keydown.esc="onClose" />
          <label for="to-reason">Reason</label>
          <select id="to-reason" v-model="reason" data-test="reason">
            <option v-for="opt in reasonOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <p v-if="createError" class="err" data-test="create-error">{{ createError }}</p>
        <div class="actions">
          <button
            type="button"
            class="primary"
            data-test="create-submit"
            :disabled="submitDisabled"
            @click="onCreate"
          >
            {{ pending ? "Saving…" : "Mark time off" }}
          </button>
          <button type="button" class="ghost" data-test="to-close" @click="onClose">Close</button>
        </div>
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
  min-width: 340px;
  max-width: 460px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.muted {
  font-size: 13px;
  color: var(--ink-faint, #6b7180);
}
.err {
  margin: 0;
  font-size: 12px;
  color: var(--bad, #f08a8a);
}
.period-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.period-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
}
.period-row .reason {
  color: var(--ink-dim, #9aa0ad);
  text-transform: capitalize;
}
.period-row .del {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--bad, #f08a8a);
  cursor: pointer;
  font-size: 13px;
}
.create {
  border-top: 1px solid var(--line-1, #262a36);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  row-gap: 10px;
  column-gap: 12px;
  align-items: center;
}
.grid > label {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
}
.grid input,
.grid select {
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 5px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  color-scheme: dark;
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
    height: 100%;
    max-height: 100vh;
    border-radius: 0;
  }
  .modal-backdrop {
    align-items: stretch;
  }
}
</style>
