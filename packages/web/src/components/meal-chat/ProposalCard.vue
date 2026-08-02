<script setup lang="ts">
import type { ProposedMeal } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import { proposalTime } from "../../lib/proposal-time.js";

const props = withDefaults(
  defineProps<{
    meal: ProposedMeal;
    viewedDate: string;
    realToday: string;
    pending?: boolean;
    // HH:MM established earlier in the conversation (e.g. the user said "for
    // lunch" on a prior turn). Used as the time default when THIS meal omits its
    // own eaten_at, so a follow-up re-estimate stays on the same clock instead of
    // jumping to "now". Absent → the card falls back to now/noon.
    fallbackTime?: string;
    // YYYY-MM-DD established earlier in the conversation — the date companion to
    // fallbackTime. Used so an inherited time also keeps the original DAY (a
    // late-evening re-estimate doesn't switch to the next day).
    fallbackDate?: string;
  }>(),
  { pending: false, fallbackTime: undefined, fallbackDate: undefined },
);

const emit = defineEmits<{
  (
    e: "log-estimated",
    body: {
      name: string | null;
      kcal: number;
      protein_g: number;
      carb_g: number;
      fat_g: number;
      eaten_at: string;
    },
    save: boolean,
  ): void;
  (e: "log-stored", storedMealId: number, eatenAt: string): void;
  (e: "dismiss"): void;
}>();

// Narrow the discriminated union once into a non-null local for estimated mode.
const meal = props.meal;
const est = meal.source === "estimated" ? meal : null;

// Shared time-composition logic (seed + source hint + compose-on-log). eaten_at
// is the meal's captured timestamp — valid on both union variants, so a stored
// match like "big mac for lunch" carries its own time too.
const time = proposalTime({
  capturedAt: meal.eaten_at,
  fallbackTime: props.fallbackTime,
  fallbackDate: props.fallbackDate,
  viewedDate: props.viewedDate,
  realToday: props.realToday,
});
const timeSource = time.timeSource;

const nameDraft = ref(meal.name);
const kcalDraft = ref(est ? String(est.kcal) : "");
const proteinDraft = ref(est ? String(est.protein_g) : "");
const carbDraft = ref(est ? String(est.carb_g) : "");
const fatDraft = ref(est ? String(est.fat_g) : "");
const timeDraft = ref(time.seedTime);
const saveDraft = ref(est ? est.suggest_store : false);

function parseMacro(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// A blank kcal field would coerce to 0 (Number("") === 0), silently logging a
// zero-kcal meal. Require a non-negative integer kcal before Log is enabled —
// mirrors MealRow.vue's saveDisabled guard. Stored cards have no kcal to edit.
const logDisabled = computed(() => {
  if (props.pending) return true;
  if (est === null) return false;
  const t = kcalDraft.value.trim();
  const k = Number(t);
  return !(t !== "" && Number.isInteger(k) && k >= 0);
});

// Compose the naive-local eaten_at to log from the (possibly-edited) time. The
// captured-date-vs-fallback-vs-viewedDate priority + 4am rollover lives in the
// shared proposalTime helper.
function composedEatenAt(): string {
  return time.composeAt(timeDraft.value);
}

function onLog(): void {
  if (logDisabled.value) return;
  if (meal.source === "stored") {
    emit("log-stored", meal.stored_meal_id, composedEatenAt());
    return;
  }
  const k = Number(kcalDraft.value.trim());
  if (!(Number.isInteger(k) && k >= 0)) return;
  const name = (nameDraft.value ?? "").trim();
  emit(
    "log-estimated",
    {
      name: name.length > 0 ? name : null,
      kcal: k,
      protein_g: parseMacro(proteinDraft.value),
      carb_g: parseMacro(carbDraft.value),
      fat_g: parseMacro(fatDraft.value),
      eaten_at: composedEatenAt(),
    },
    saveDraft.value,
  );
}
</script>

<template>
  <div class="proposal-card" data-test="proposal-card">
    <template v-if="meal.source === 'stored'">
      <div class="card-head">
        <span class="matched">Matched your <strong>{{ meal.name }}</strong></span>
      </div>
      <p class="stored-note">Logs the saved macros from your library.</p>
      <div class="time-row">
        <label>Time
          <input v-model="timeDraft" type="time" data-test="card-time" />
        </label>
        <span class="time-hint" data-test="card-time-hint">
          {{
            timeSource === "message"
              ? "from your message"
              : timeSource === "earlier"
                ? "from earlier"
                : "defaults to now"
          }}
        </span>
      </div>
    </template>

    <template v-else>
      <input
        v-model="nameDraft"
        class="name-input"
        type="text"
        placeholder="Meal name"
        data-test="card-name"
      />
      <div class="macro-grid">
        <label>kcal
          <input v-model="kcalDraft" type="text" inputmode="numeric" data-test="card-kcal" />
        </label>
        <label>P
          <input v-model="proteinDraft" type="text" inputmode="decimal" data-test="card-protein" />
        </label>
        <label>C
          <input v-model="carbDraft" type="text" inputmode="decimal" data-test="card-carb" />
        </label>
        <label>F
          <input v-model="fatDraft" type="text" inputmode="decimal" data-test="card-fat" />
        </label>
      </div>
      <div class="time-row">
        <label>Time
          <input v-model="timeDraft" type="time" data-test="card-time" />
        </label>
        <span class="time-hint" data-test="card-time-hint">
          {{
            timeSource === "message"
              ? "from your message"
              : timeSource === "earlier"
                ? "from earlier"
                : "defaults to now"
          }}
        </span>
      </div>
      <label class="save-row">
        <input v-model="saveDraft" type="checkbox" data-test="card-save" />
        Save to my meals
      </label>
    </template>

    <div class="card-actions">
      <button type="button" class="log-btn" :disabled="logDisabled" data-test="card-log" @click="onLog">Log</button>
      <button type="button" class="dismiss-btn" :disabled="pending" data-test="card-dismiss" @click="emit('dismiss')">Dismiss</button>
    </div>
  </div>
</template>

<style scoped>
.proposal-card {
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 6px 0;
}
.card-head { display: flex; align-items: center; justify-content: space-between; }
.matched { font-size: 13px; color: var(--ink, #e6e8ee); }
.stored-note { margin: 4px 0 0; font-size: 11px; color: var(--ink-faint, #6b7180); }
.name-input {
  width: 100%; font: inherit; font-size: 13px; margin-bottom: 6px;
  background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36);
  border-radius: 5px; color: var(--ink, #e6e8ee); padding: 4px 6px;
}
.macro-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 6px; }
.macro-grid label, .time-row label {
  display: flex; flex-direction: column; font-size: 10px;
  color: var(--ink-faint, #6b7180); text-transform: uppercase; letter-spacing: 0.4px; gap: 2px;
}
.macro-grid input, .time-row input {
  font: inherit; font-size: 13px; min-height: 32px;
  background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36);
  border-radius: 5px; color: var(--ink, #e6e8ee); padding: 2px 6px; width: 100%;
}
.time-row { display: flex; align-items: flex-end; gap: 8px; margin-top: 6px; }
.time-hint { font-size: 11px; color: var(--ink-faint, #6b7180); padding-bottom: 6px; }
.save-row {
  display: flex; align-items: center; gap: 6px; margin-top: 8px;
  font-size: 12px; color: var(--ink-dim, #9aa0ad);
}
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
