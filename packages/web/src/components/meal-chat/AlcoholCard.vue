<script setup lang="ts">
import type { ProposedAlcohol } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import { proposalTime } from "../../lib/proposal-time.js";

const props = withDefaults(
  defineProps<{
    alcohol: ProposedAlcohol;
    viewedDate: string;
    realToday: string;
    pending?: boolean;
    // HH:MM established earlier in the conversation; used when this alcohol
    // session omits its own started_at, so it stays on the same clock.
    fallbackTime?: string;
    // YYYY-MM-DD established earlier — the date companion to fallbackTime.
    fallbackDate?: string;
  }>(),
  { pending: false, fallbackTime: undefined, fallbackDate: undefined },
);

const emit = defineEmits<{
  (
    e: "log-alcohol",
    body: { drinks_count: number; est_kcal: number; started_at: string; notes: string | null },
  ): void;
  (e: "dismiss"): void;
}>();

const alcohol = props.alcohol;

// Shared time-composition logic (seed + source hint + compose-on-log). An alcohol
// session's captured timestamp is `started_at`.
const time = proposalTime({
  capturedAt: alcohol.started_at,
  fallbackTime: props.fallbackTime,
  fallbackDate: props.fallbackDate,
  viewedDate: props.viewedDate,
  realToday: props.realToday,
});
const timeSource = time.timeSource;

const drinksDraft = ref(String(alcohol.drinks_count));
const kcalDraft = ref(String(alcohol.est_kcal));
const timeDraft = ref(time.seedTime);

// A blank/zero kcal or non-positive drinks would silently log a bad session.
// Require a non-negative integer kcal and a positive drinks_count before Log.
const logDisabled = computed(() => {
  if (props.pending) return true;
  const k = Number(kcalDraft.value.trim());
  const d = Number(drinksDraft.value.trim());
  const kcalOk = kcalDraft.value.trim() !== "" && Number.isInteger(k) && k >= 0;
  const drinksOk = drinksDraft.value.trim() !== "" && Number.isFinite(d) && d > 0;
  return !(kcalOk && drinksOk);
});

function composedStartedAt(): string {
  return time.composeAt(timeDraft.value);
}

function onLog(): void {
  if (logDisabled.value) return;
  const k = Number(kcalDraft.value.trim());
  const d = Number(drinksDraft.value.trim());
  if (!(Number.isInteger(k) && k >= 0 && Number.isFinite(d) && d > 0)) return;
  emit("log-alcohol", {
    drinks_count: d,
    est_kcal: k,
    started_at: composedStartedAt(),
    notes: alcohol.note ?? null,
  });
}
</script>

<template>
  <div class="alcohol-card" data-test="alcohol-card">
    <div class="card-head">
      <span class="label"><span aria-hidden="true">🍺</span> Alcohol</span>
    </div>
    <div class="alc-grid">
      <label>Drinks
        <input v-model="drinksDraft" type="text" inputmode="decimal" data-test="alc-drinks" />
      </label>
      <label>kcal
        <input v-model="kcalDraft" type="text" inputmode="numeric" data-test="alc-kcal" />
      </label>
    </div>
    <div class="time-row">
      <label>Time
        <input v-model="timeDraft" type="time" data-test="alc-time" />
      </label>
      <span class="time-hint" data-test="alc-time-hint">
        {{
          timeSource === "message"
            ? "from your message"
            : timeSource === "earlier"
              ? "from earlier"
              : "defaults to now"
        }}
      </span>
    </div>
    <p v-if="alcohol.note" class="alc-note" data-test="alc-note">{{ alcohol.note }}</p>
    <div class="card-actions">
      <button type="button" class="log-btn" :disabled="logDisabled" data-test="alc-log" @click="onLog">Log</button>
      <button type="button" class="dismiss-btn" :disabled="pending" data-test="alc-dismiss" @click="emit('dismiss')">Dismiss</button>
    </div>
  </div>
</template>

<style scoped>
.alcohol-card {
  background: var(--panel, #161922);
  /* Amber left accent marks this as alcohol, not food. */
  border: 1px solid var(--line, #262a36);
  border-left: 3px solid var(--warn, #e0a458);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 6px 0;
}
.card-head { display: flex; align-items: center; justify-content: space-between; }
.label { font-size: 13px; font-weight: 600; color: var(--warn, #e0a458); }
.alc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
.alc-grid label, .time-row label {
  display: flex; flex-direction: column; font-size: 10px;
  color: var(--ink-faint, #6b7180); text-transform: uppercase; letter-spacing: 0.4px; gap: 2px;
}
.alc-grid input, .time-row input {
  font: inherit; font-size: 13px; min-height: 32px;
  background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36);
  border-radius: 5px; color: var(--ink, #e6e8ee); padding: 2px 6px; width: 100%;
}
.time-row { display: flex; align-items: flex-end; gap: 8px; margin-top: 6px; }
.time-hint { font-size: 11px; color: var(--ink-faint, #6b7180); padding-bottom: 6px; }
.alc-note { margin: 6px 0 0; font-size: 11px; color: var(--ink-faint, #6b7180); }
.card-actions { display: flex; gap: 8px; margin-top: 10px; }
.log-btn {
  flex: 1; font: inherit; font-size: 13px; cursor: pointer; padding: 6px;
  border-radius: 6px; border: none; background: var(--accent, #5b7cfa); color: #fff;
}
.log-btn:disabled { opacity: 0.5; cursor: default; }
.dismiss-btn {
  font: inherit; font-size: 13px; cursor: pointer; padding: 6px 12px;
  border-radius: 6px; border: 1px solid var(--line, #262a36);
  background: transparent; color: var(--ink-dim, #9aa0ad);
}
.dismiss-btn:disabled { opacity: 0.5; cursor: default; }
</style>
