<script setup lang="ts">
import {
  CardioKcalEstimateSchema,
  CardioSessionEnrichedResponseSchema,
  StepLogResponseSchema,
} from "@almanac/core/schemas";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { useInlineEdit } from "../../composables/useInlineEdit.js";
import { useIsMobile } from "../../composables/useIsMobile.js";
import CardioSessionRow from "./CardioSessionRow.vue";

type CardioSession = {
  id: number;
  modality: string | null;
  duration_min: number | null;
  avg_hr: number | null;
  est_kcal: number;
};
type CardioEdit = {
  modality: string | null;
  duration_min: number | null;
  avg_hr: number | null;
  est_kcal?: number;
};

const props = defineProps<{
  cardio: CardioSession[];
  steps: { id: number; count: number; est_kcal: number | null } | null;
  client: ApiClient;
  date: string;
  /** True when viewing a past day (calendar traversal). When false/omitted the
   *  caption stays "Today's Movement"; when true it becomes "Movement · <date>". */
  isPastDay?: boolean;
}>();

const emit = defineEmits<(e: "changed") => void>();

const { isMobile } = useIsMobile();

const hasCardio = computed(() => props.cardio.length > 0);

// Short date matching PastDayBanner so the UI reads consistently, e.g. "Wed 10 Jun".
const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const caption = computed(() =>
  props.isPastDay
    ? `Movement · ${shortDateFmt.format(new Date(`${props.date}T12:00:00Z`))}`
    : "Today's Movement",
);

const error = ref<string | null>(null);
const pending = ref(false);

const adding = ref(false);
const addModality = ref("");
const addDuration = ref("");
const addHr = ref("");
const addKcal = ref("");

function openAdd(): void {
  addModality.value = "";
  addDuration.value = "";
  addHr.value = "";
  addKcal.value = "";
  error.value = null;
  adding.value = true;
}

function closeAdd(): void {
  adding.value = false;
  error.value = null;
}

/** Positive integer or null, the shape every numeric box in this form parses to. */
function posInt(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const addDurationValue = computed(() => posInt(addDuration.value));
const addHrValue = computed(() => posInt(addHr.value));
const addKcalValue = computed(() => {
  const s = addKcal.value.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
});

/** With both of these the server can work the calories out itself. */
const canDerive = computed(() => addHrValue.value !== null && addDurationValue.value !== null);

const addSaveDisabled = computed(
  () => pending.value || !(addKcalValue.value !== null || canDerive.value),
);

// The server's own figure for what is currently typed, or null while nothing
// has come back for it. Cosmetic: a preview never gates the save.
const previewKcal = ref<number | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
// Bumped per request so a slow response can't overwrite a newer one.
let previewSeq = 0;

watch([addHr, addDuration, adding], () => {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  const hr = addHrValue.value;
  const dur = addDurationValue.value;
  if (!adding.value || hr === null || dur === null) {
    // A stale figure under a cleared heart-rate box would read as current.
    previewKcal.value = null;
    return;
  }
  const seq = ++previewSeq;
  previewTimer = setTimeout(() => {
    void props.client
      .get(
        `/v1/cardio-sessions/kcal-preview?avg_hr=${hr}&duration_min=${dur}&on_date=${props.date}`,
        CardioKcalEstimateSchema,
      )
      .then((r) => {
        if (seq === previewSeq) previewKcal.value = r.est_kcal_hr;
      })
      // A failed preview is cosmetic. Leave the placeholder at "auto" rather
      // than blocking the save or raising the error banner.
      .catch(() => {
        if (seq === previewSeq) previewKcal.value = null;
      });
  }, 300);
});

onBeforeUnmount(() => {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
});

// A grey placeholder is the only thing separating "the server will fill this
// in" from a value the user typed, so it has to name the number it stands for:
// the derived figure once one is in, "auto" until then.
const kcalPlaceholder = computed(() => {
  if (!canDerive.value) return "kcal";
  return previewKcal.value === null ? "auto" : String(previewKcal.value);
});

// The only place the form says the calorie and heart-rate boxes are
// alternatives. It stays rendered for every state of the form so the card
// doesn't change height as you type.
const addHint = computed(() => {
  if (!canDerive.value) return "Enter calories, or heart rate and we'll work them out.";
  const kcal = previewKcal.value === null ? "Calories" : `${previewKcal.value} kcal`;
  return `${kcal} from ${addHrValue.value} bpm over ${addDurationValue.value} min.`;
});

async function run(fn: () => Promise<void>): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  error.value = null;
  try {
    await fn();
    emit("changed");
  } catch (e) {
    error.value =
      e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
  } finally {
    pending.value = false;
  }
}

async function onAdd(): Promise<void> {
  const est_kcal = addKcalValue.value;
  const duration_min = addDurationValue.value;
  const avg_hr = addHrValue.value;
  // Either a typed figure or both derivation inputs. The API enforces this
  // too; checking here keeps the button honest.
  if (est_kcal === null && !canDerive.value) return;
  const modality = addModality.value.trim();
  await run(async () => {
    await props.client.post(
      "/v1/cardio-sessions",
      {
        // Stamp at NOON of the selected day, not the wall-clock time. The API
        // buckets `started_at` to a user-local day with a 4am DAY_START_HOUR
        // rollover, so a pre-4am wall-clock time (e.g. logging at 1am) would
        // roll the session back onto the *previous* day. Noon is always safely
        // inside the selected day's window for any date and timezone.
        started_at: `${props.date}T12:00:00`,
        modality: modality.length > 0 ? modality : null,
        duration_min,
        avg_hr,
        // Sending nothing is what asks the server to derive the figure.
        ...(est_kcal === null ? {} : { est_kcal }),
      },
      CardioSessionEnrichedResponseSchema,
    );
    adding.value = false;
  });
}

async function onEditSave(id: number, edit: CardioEdit): Promise<void> {
  await run(async () => {
    await props.client.patch(
      `/v1/cardio-sessions/${id}`,
      {
        modality: edit.modality,
        duration_min: edit.duration_min,
        avg_hr: edit.avg_hr,
        // An omitted est_kcal leaves a server-derived figure free to follow
        // the edited heart rate; a user's own figure is left untouched.
        ...(edit.est_kcal === undefined ? {} : { est_kcal: edit.est_kcal }),
      },
      CardioSessionEnrichedResponseSchema,
    );
  });
}

async function onDelete(id: number): Promise<void> {
  await run(async () => {
    await props.client.delete(`/v1/cardio-sessions/${id}`, z.undefined());
  });
}

// --- Steps inline edit ---

const stepsEdit = useInlineEdit();
const stepsDraft = ref("");
const stepsInputRef = ref<HTMLInputElement | null>(null);

function beginStepsEdit(): void {
  stepsDraft.value = props.steps ? String(props.steps.count) : "";
  stepsEdit.startEdit();
  void nextTick(() => stepsInputRef.value?.focus());
}

const stepsInputValid = computed(() => {
  const s = stepsDraft.value.trim();
  if (s === "") return false;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1;
});
const stepsSaveDisabled = computed(() => stepsEdit.pending.value || !stepsInputValid.value);
const stepsKcalLabel = computed(() =>
  props.steps?.est_kcal != null ? `${props.steps.est_kcal.toLocaleString("en-US")} kcal` : "—",
);

async function onStepsSave(): Promise<void> {
  const n = Number(stepsDraft.value.trim());
  if (!(Number.isInteger(n) && n >= 1)) return;
  await stepsEdit.save(async () => {
    await props.client.post(
      "/v1/step-logs",
      { on_date: props.date, steps: n },
      StepLogResponseSchema,
    );
    emit("changed");
  });
}

async function onStepsDelete(): Promise<void> {
  const row = props.steps;
  if (!row) return;
  await stepsEdit.save(async () => {
    await props.client.delete(`/v1/step-logs/${row.id}`, z.undefined());
    emit("changed");
  });
}
</script>

<template>
  <div class="block" data-test="movement-block">
    <div class="caption">{{ caption }}</div>
    <!-- One list for every activity box on the block, including the ones each
         CardioSessionRow renders: a datalist id has to be unique in the
         document, so a row cannot own a copy. -->
    <datalist id="cardio-activities">
      <option value="bike" />
      <option value="run" />
      <option value="walk" />
      <option value="row" />
      <option value="swim" />
      <option value="hike" />
      <option value="elliptical" />
    </datalist>
    <p v-if="!hasCardio && !adding" class="empty" data-test="cardio-empty">
      {{ isPastDay ? "No cardio logged." : "No cardio logged today." }}
    </p>
    <ul v-if="hasCardio || adding" class="cardio">
      <CardioSessionRow
        v-for="c in cardio"
        :key="c.id"
        :session="c"
        :pending="pending"
        @save="(edit) => onEditSave(c.id, edit)"
        @delete="onDelete"
      />
      <li
        v-if="adding"
        class="form-row"
        :class="{ stacked: isMobile }"
        data-test="cardio-add-form"
      >
        <input
          v-model="addModality"
          type="text"
          class="modality-input"
          data-test="cardio-add-modality"
          list="cardio-activities"
          placeholder="activity"
          @keydown.esc="closeAdd"
        />
        <div class="numbers">
          <input
            v-model="addDuration"
            type="text"
            inputmode="numeric"
            class="dur-input"
            data-test="cardio-add-duration"
            placeholder="min"
            @keydown.esc="closeAdd"
          /><span class="u">min</span>
          <input
            v-model="addHr"
            type="text"
            inputmode="numeric"
            class="hr-input"
            data-test="cardio-add-hr"
            placeholder="HR"
            @keydown.esc="closeAdd"
          /><span class="u">bpm</span>
          <input
            v-model="addKcal"
            type="text"
            inputmode="numeric"
            class="kcal-input"
            data-test="cardio-add-kcal"
            :placeholder="kcalPlaceholder"
            @keydown.enter.prevent="!addSaveDisabled && onAdd()"
            @keydown.esc="closeAdd"
          /><span class="u">kcal</span>
          <button
            type="button"
            class="save"
            data-test="cardio-add-save"
            :disabled="addSaveDisabled"
            @click="onAdd"
          >Save</button>
          <button
            type="button"
            class="cancel"
            data-test="cardio-add-cancel"
            aria-label="Cancel"
            @click="closeAdd"
          >×</button>
        </div>
      </li>
    </ul>
    <p v-if="adding" class="add-hint" data-test="cardio-add-hint">{{ addHint }}</p>
    <button
      v-if="!adding"
      type="button"
      class="add-btn"
      data-test="cardio-add-button"
      @click="openAdd"
    >+ Add cardio</button>
    <div v-if="error" class="cardio-error" data-test="cardio-error">{{ error }}</div>
    <div class="steps-row" data-test="steps-row">
      <template v-if="!stepsEdit.isEditing.value">
        <span class="label">Steps:</span>
        <template v-if="steps">
          <span class="value">{{ steps.count.toLocaleString("en-US") }}</span>
          <span class="kcal">→ {{ stepsKcalLabel }}</span>
        </template>
        <template v-else>
          <span class="value missing">— not logged</span>
        </template>
        <button
          type="button"
          class="steps-edit-btn"
          data-test="steps-edit"
          aria-label="Edit steps"
          @click="beginStepsEdit"
        >✎</button>
      </template>
      <template v-else>
        <span class="label">Steps:</span>
        <input
          ref="stepsInputRef"
          v-model="stepsDraft"
          type="text"
          inputmode="numeric"
          class="steps-input"
          data-test="steps-edit-input"
          @keydown.esc="stepsEdit.cancel()"
          @keydown.enter.prevent="!stepsSaveDisabled && onStepsSave()"
        />
        <button
          type="button"
          class="save"
          data-test="steps-edit-save"
          :disabled="stepsSaveDisabled"
          @click="onStepsSave"
        >Save</button>
        <button
          v-if="steps"
          type="button"
          class="cancel delete"
          data-test="steps-edit-delete"
          aria-label="Delete steps"
          :disabled="stepsEdit.pending.value"
          @click="onStepsDelete"
        >🗑</button>
        <button
          type="button"
          class="cancel"
          data-test="steps-edit-cancel"
          aria-label="Cancel"
          :disabled="stepsEdit.pending.value"
          @click="stepsEdit.cancel()"
        >×</button>
      </template>
    </div>
    <div
      v-if="stepsEdit.error.value"
      class="cardio-error"
      data-test="steps-edit-error"
    >{{ stepsEdit.error.value }}</div>
  </div>
</template>

<style scoped>
.block {
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.caption {
  font-size: 11px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
}
.empty {
  margin: 0;
  font-style: italic;
  color: var(--ink-faint, #6b7180);
  font-size: 12px;
}
.cardio {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.steps-row {
  margin-top: 12px;
  border-top: 1px solid var(--line, #262a36);
  padding-top: 8px;
  font-size: 11px;
  color: var(--ink-faint, #6b7180);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.steps-row .label { color: var(--ink-dim, #9aa0ad); }
.steps-row .value { color: var(--ink, #e6e8ee); font-weight: 600; }
.steps-row .value.missing { color: var(--ink-faint, #6b7180); font-weight: 400; font-style: italic; }
.steps-row .kcal { color: var(--ink-dim, #9aa0ad); }
.steps-row .steps-edit-btn {
  margin-left: auto;
  background: transparent;
  border: none;
  color: var(--ink-faint, #6b7180);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}
.steps-row .steps-edit-btn:hover { color: var(--ink, #e6e8ee); }
.steps-row .steps-input {
  width: 72px;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 4px 7px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
}
.steps-row .steps-input:focus { outline: none; border-color: var(--accent, #4a7dff); }
.steps-row .save {
  margin-left: auto;
  background: var(--accent, #4a7dff);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.steps-row .save:disabled { background: var(--line-2, #353a4a); color: var(--ink-faint, #6b7180); cursor: not-allowed; }
.steps-row .cancel {
  background: transparent;
  border: none;
  color: var(--ink-dim, #9aa0ad);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.add-btn {
  margin-top: 8px; width: 100%;
  background: transparent;
  border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 6px; padding: 6px;
  font: inherit; font-size: 12px; cursor: pointer;
}
.add-btn:hover { border-color: var(--ink-dim, #9aa0ad); color: var(--ink, #e6e8ee); }
.form-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; padding: 2px 0; list-style: none; }
.form-row input {
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px; padding: 5px 7px;
  font: inherit; font-size: 13px; color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
}
.form-row input:focus { outline: none; border-color: var(--accent, #4a7dff); }
.form-row .modality-input { width: 92px; }
.form-row .dur-input { width: 48px; }
.form-row .hr-input { width: 48px; }
.form-row .kcal-input { width: 60px; }
.form-row .u { color: var(--ink-faint, #6b7180); font-size: 10px; }
.form-row .save {
  margin-left: auto; background: var(--accent, #4a7dff); color: #fff;
  border: none; border-radius: 6px; padding: 5px 10px;
  font-size: 12px; font-weight: 500; cursor: pointer;
}
.form-row .save:disabled { background: var(--line-2, #353a4a); color: var(--ink-faint, #6b7180); cursor: not-allowed; }
.form-row .cancel { background: transparent; border: none; color: var(--ink-dim, #9aa0ad); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
/* The wrapper exists only so the stacked layout has something to group; on a
   wide row its children are flex items of .form-row exactly as before. */
.form-row .numbers { display: contents; }
.form-row.stacked { flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
.form-row.stacked .modality-input { width: 100%; }
.form-row.stacked .numbers { display: flex; align-items: center; gap: 4px; }
.form-row.stacked .dur-input { width: 42px; }
.form-row.stacked .hr-input { width: 42px; }
.form-row.stacked .kcal-input { width: 52px; }
.add-hint { margin: 8px 0 0; font-size: 11px; color: var(--ink-faint, #6b7180); line-height: 1.45; }
.cardio-error { font-size: 11px; color: var(--bad, #f08a8a); margin-top: 6px; }
</style>
