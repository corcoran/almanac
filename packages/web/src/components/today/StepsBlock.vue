<script setup lang="ts">
import { StepLogResponseSchema, type TodayContextResponseSchema } from "@almanac/core/schemas";
import { computed, nextTick, ref } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { useInlineEdit } from "../../composables/useInlineEdit.js";
import {
  formatStepsShort,
  type StepsDay,
  stepsAverage,
  stepsBarGeometry,
} from "../../lib/steps-chart.js";
import BlockEditButton from "./BlockEditButton.vue";
import DayBarChart, { type ChartBar } from "./DayBarChart.vue";

type StepsTarget = z.infer<typeof TodayContextResponseSchema>["steps_target"];

const props = defineProps<{
  /** The day whose steps are due and its log. Saves go to `stepsTarget.on_date`. */
  stepsTarget: StepsTarget;
  logs: Array<StepsDay & { id: number }>;
  /** Ordered YYYY-MM-DD, oldest-left … steps target day rightmost. */
  windowDates: string[];
  client: ApiClient;
  isPastDay?: boolean;
}>();

const emit = defineEmits<(e: "saved") => void>();

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

function dayOfWeekLabel(iso: string): string {
  return weekdayFmt.format(new Date(`${iso}T12:00:00Z`)).slice(0, 2);
}

const rowLabel = computed(() =>
  props.isPastDay
    ? shortDateFmt.format(new Date(`${props.stepsTarget.on_date}T12:00:00Z`))
    : "Yesterday",
);

const kcalLabel = computed(() => {
  const kcal = props.stepsTarget.log?.est_kcal;
  return kcal != null ? `${kcal.toLocaleString("en-US")} kcal` : "—";
});

const average = computed(() => stepsAverage(props.logs, props.windowDates));

const STEPS_BAR = "hsl(210, 62%, 52%)";
const STEPS_BAR_HIGHLIGHT = "hsl(205, 70%, 70%)";

const chartBars = computed<ChartBar[]>(() =>
  stepsBarGeometry(props.logs, props.windowDates, props.stepsTarget.on_date).map((bar) => {
    const base = {
      key: bar.on_date,
      dayLabel: dayOfWeekLabel(bar.on_date),
      ariaLabel: barAriaLabel(bar.on_date),
      highlighted: bar.isTarget,
    };
    return bar.logged
      ? {
          ...base,
          logged: true,
          heightPct: bar.heightPct,
          color: bar.isTarget ? STEPS_BAR_HIGHLIGHT : STEPS_BAR,
          valueLabel: formatStepsShort(bar.steps),
        }
      : { ...base, logged: false, heightPct: 0 };
  }),
);

// ── Inline edit ─────────────────────────────────────────────────────────────

const edit = useInlineEdit();
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
// The day being edited: the steps target from the ✎ button, or a clicked bar's date.
const editingDate = ref("");
const confirmingDelete = ref(false);

const editingLog = computed<{ id: number; count: number } | null>(() => {
  if (editingDate.value === props.stepsTarget.on_date) return props.stepsTarget.log;
  const row = props.logs.find((l) => l.on_date === editingDate.value);
  return row ? { id: row.id, count: row.steps } : null;
});

const editLabel = computed(() =>
  editingDate.value === props.stepsTarget.on_date
    ? rowLabel.value
    : shortDateFmt.format(new Date(`${editingDate.value}T12:00:00Z`)),
);

function barAriaLabel(onDate: string): string {
  return `Edit steps for ${shortDateFmt.format(new Date(`${onDate}T12:00:00Z`))}`;
}

function beginEdit(onDate: string = props.stepsTarget.on_date): void {
  editingDate.value = onDate;
  confirmingDelete.value = false;
  const log = editingLog.value;
  draft.value = log ? String(log.count) : "";
  edit.startEdit();
  void nextTick(() => inputRef.value?.focus());
}

function onBarClick(onDate: string): void {
  if (edit.isEditing.value) return;
  beginEdit(onDate);
}

function parseSteps(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

const saveDisabled = computed(() => edit.pending.value || parseSteps(draft.value) === null);

async function onSave(): Promise<void> {
  const n = parseSteps(draft.value);
  if (n === null) return;
  await edit.save(async () => {
    await props.client.post(
      "/v1/step-logs",
      { on_date: editingDate.value, steps: n },
      StepLogResponseSchema,
    );
    emit("saved");
  });
}

async function onDeleteConfirmed(): Promise<void> {
  const log = editingLog.value;
  if (!log) return;
  await edit.save(async () => {
    await props.client.delete(`/v1/step-logs/${log.id}`, z.undefined());
    emit("saved");
  });
}
</script>

<template>
  <div class="block steps-block" data-test="steps-block">
    <BlockEditButton v-if="!edit.isEditing.value" label="Edit steps" @click="beginEdit()" />
    <div class="caption" data-test="steps-caption">Steps</div>

    <div v-if="!edit.isEditing.value" class="stat-row" data-test="steps-row">
      <span class="label">{{ rowLabel }}</span>
      <template v-if="stepsTarget.log">
        <span class="val">{{ stepsTarget.log.count.toLocaleString("en-US") }}</span>
        <span class="unit">steps → {{ kcalLabel }}</span>
      </template>
      <span v-else class="val placeholder">— not logged</span>
      <span v-if="average !== null" class="avg" data-test="steps-avg"
        >avg {{ average.toLocaleString("en-US") }} / {{ windowDates.length }}d</span
      >
    </div>

    <div v-else class="stat-row edit-row" data-test="steps-row">
      <span class="label">{{ editLabel }}</span>
      <input
        ref="inputRef"
        v-model="draft"
        type="text"
        inputmode="numeric"
        class="steps-input"
        data-test="steps-edit-input"
        @keydown.esc="edit.cancel()"
        @keydown.enter.prevent="!saveDisabled && onSave()"
      />
      <span class="unit">steps</span>
      <span v-if="confirmingDelete" class="confirm" data-test="steps-delete-confirm">
        <span class="q">Delete?</span>
        <button
          type="button"
          class="yes"
          data-test="steps-delete-yes"
          :disabled="edit.pending.value"
          @click="onDeleteConfirmed"
        >
          Yes
        </button>
        <button type="button" class="no" data-test="steps-delete-no" @click="confirmingDelete = false">
          No
        </button>
      </span>
      <template v-else>
        <button
          type="button"
          class="save"
          data-test="steps-edit-save"
          :disabled="saveDisabled"
          @click="onSave"
        >
          Save
        </button>
        <button
          v-if="editingLog"
          type="button"
          class="delete"
          data-test="steps-edit-delete"
          :disabled="edit.pending.value"
          @click="confirmingDelete = true"
        >
          Delete
        </button>
        <button
          type="button"
          class="cancel"
          data-test="steps-edit-cancel"
          aria-label="Cancel"
          :disabled="edit.pending.value"
          @click="edit.cancel()"
        >
          ×
        </button>
      </template>
    </div>
    <div v-if="edit.error.value" class="edit-error" data-test="steps-edit-error">
      {{ edit.error.value }}
    </div>

    <DayBarChart
      test-id="steps"
      :bars="chartBars"
      :editing-key="edit.isEditing.value ? editingDate : null"
      @select="onBarClick"
    />
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
.steps-block { position: relative; }
.caption {
  font-size: 11px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
}
.stat-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.stat-row .label {
  color: var(--ink-faint, #6b7180);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stat-row .val {
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
}
.stat-row .val.placeholder {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-faint, #6b7180);
}
.stat-row .unit {
  color: var(--ink-dim, #9aa0ad);
  font-size: 12px;
}
.stat-row .avg {
  margin-left: auto;
  color: hsl(205, 70%, 70%);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.edit-row {
  align-items: center;
  flex-wrap: wrap;
}
.steps-input {
  width: 88px;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--ink, #e6e8ee);
}
.steps-input:focus { outline: none; border-color: var(--accent, #4a7dff); }
.edit-row .save {
  margin-left: auto;
  background: var(--accent, #4a7dff);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.edit-row .save:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.edit-row .cancel {
  background: transparent;
  border: none;
  color: var(--ink-dim, #9aa0ad);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.edit-row .delete {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--bad, #f08a8a);
  cursor: pointer;
}
.edit-row .confirm {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.edit-row .confirm .q { color: var(--ink-dim, #9aa0ad); }
.edit-row .confirm .yes,
.edit-row .confirm .no {
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--line-2, #353a4a);
  background: transparent;
  color: var(--ink, #e6e8ee);
}
.edit-row .confirm .yes { background: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); color: #1a0d0d; }
.edit-error { font-size: 11px; color: var(--bad, #f08a8a); margin-bottom: 6px; }
</style>
