<script setup lang="ts">
import { SleepLogResponseSchema, type TodayContextResponseSchema } from "@almanac/core/schemas";
import { addDaysIso } from "@almanac/core/types";
import { computed, nextTick, ref } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { useInlineEdit } from "../../composables/useInlineEdit.js";
import { sleepBarGeometry } from "../../lib/bar-chart.js";
import { sleepColor } from "../../lib/sleep-color.js";
import BlockEditButton from "./BlockEditButton.vue";
import DayBarChart, { type ChartBar } from "./DayBarChart.vue";
import QualityPicker from "./QualityPicker.vue";

type SleepDebt = z.infer<typeof TodayContextResponseSchema>["week_to_date"]["sleep_debt"];
type SleepLog = z.infer<typeof SleepLogResponseSchema>;

const props = defineProps<{
  sleepDebt: SleepDebt;
  nights: SleepLog[];
  /** Ordered YYYY-MM-DD, oldest-left … newest-right (today rightmost).
   *  One column is rendered per entry; days without a logged night render
   *  as a ghost slot. */
  windowDates: string[];
  client: ApiClient;
  date: string;
  /** True when viewing a past day (calendar traversal). When false/omitted the
   *  label stays "Last night"; when true it becomes the night's short date. */
  isPastDay?: boolean;
}>();

const emit = defineEmits<(e: "saved") => void>();

const BAR_DIMS = { width: 280, height: 60, gap: 4 };

const weekdayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
});

function dayOfWeekLabel(iso: string): string {
  return weekdayFmt.format(new Date(`${iso}T12:00:00Z`)).slice(0, 2);
}

// Short date matching PastDayBanner so the UI reads consistently, e.g. "Wed 10 Jun".
const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// Nights are stored on the wake date (`slept_on`) but shown by the evening they
// started, so a bar or label for slept_on D reads as the night of D − 1.
function nightOf(sleptOn: string): string {
  return addDaysIso(sleptOn, -1);
}

function nightLabel(sleptOn: string): string {
  return `Night of ${shortDateFmt.format(new Date(`${nightOf(sleptOn)}T12:00:00Z`))}`;
}

// "Last night" on today; the night's date when traversing a past day.
const rowLabel = computed(() => (props.isPastDay ? nightLabel(props.date) : "Last night"));

/** "6h 40m" from a decimal hours value. */
function formatHoursMinutes(hoursDecimal: number): string {
  const totalMinutes = Math.round(hoursDecimal * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Compact bar label: one decimal place, but drop trailing zero when the
 * decimal is exactly .0 — so 5.5 stays "5.5" but 8.0 renders as "8".
 */
function formatHours(hoursDecimal: number): string {
  const rounded = Math.round(hoursDecimal * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

const geometry = computed(() =>
  sleepBarGeometry(
    props.nights.map((n) => ({ slept_on: n.slept_on, hours: n.hours })),
    props.windowDates,
    BAR_DIMS,
  ),
);

const chartBars = computed<ChartBar[]>(() =>
  geometry.value.bars.map((bar) => {
    const highlighted = bar.slept_on === props.date;
    const base = {
      key: bar.slept_on,
      dayLabel: dayOfWeekLabel(nightOf(bar.slept_on)),
      ariaLabel: barAriaLabel(bar.slept_on),
      highlighted,
    };
    return bar.logged
      ? {
          ...base,
          logged: true,
          heightPct: bar.heightPct,
          color: sleepColor(bar.hours, { highlight: highlighted }),
          valueLabel: formatHours(bar.hours),
          classes: bar.isShort ? ["short"] : [],
        }
      : { ...base, logged: false, heightPct: 0 };
  }),
);

// "Last night" is the night dated *today* — keyed on props.date, which is
// the canonical single source of truth for the active night (shared with
// beginEdit / activeNight so they always agree).
// Strictly today: if it wasn't logged we show "no log" rather than borrowing
// an older night, which would mislead the same way stale histogram adjacency
// did.
const lastNightLabel = computed(() => {
  const night = activeNight();
  return night ? formatHoursMinutes(night.hours) : null;
});

const lastNightQuality = computed<number | null>(() => {
  return activeNight()?.quality ?? null;
});

const debtLabel = computed(() => {
  const debt = props.sleepDebt;
  if (debt.debt_hours <= 0) return `no debt / ${debt.window_days}d`;
  return `debt ${debt.debt_hours.toFixed(1)}h / ${debt.window_days}d`;
});

// ── Inline edit ─────────────────────────────────────────────────────────────

const edit = useInlineEdit();
const hoursDraft = ref("");
const qualityDraft = ref<number | null>(null);
const hoursInputRef = ref<HTMLInputElement | null>(null);

function activeNight(): SleepLog | undefined {
  return props.nights.find((n) => n.slept_on === props.date);
}

// The night being edited: props.date from the ✎ button, or a clicked bar's date.
const editingDate = ref("");
const confirmingDelete = ref(false);

const editingNight = computed(() => props.nights.find((n) => n.slept_on === editingDate.value));

const editLabel = computed(() =>
  editingDate.value === props.date ? rowLabel.value : nightLabel(editingDate.value),
);

function barAriaLabel(sleptOn: string): string {
  return `Edit sleep for night of ${shortDateFmt.format(new Date(`${nightOf(sleptOn)}T12:00:00Z`))}`;
}

function onBarClick(sleptOn: string): void {
  if (edit.isEditing.value) return;
  beginEdit(sleptOn);
}

function beginEdit(sleptOn: string = props.date): void {
  editingDate.value = sleptOn;
  confirmingDelete.value = false;
  const night = editingNight.value;
  hoursDraft.value = night ? String(night.hours) : "";
  qualityDraft.value = night?.quality ?? null;
  edit.startEdit();
  void nextTick(() => hoursInputRef.value?.focus());
}

const isHoursValid = computed(() => {
  const n = Number.parseFloat(hoursDraft.value);
  return hoursDraft.value.trim() !== "" && Number.isFinite(n) && n > 0;
});

const saveDisabled = computed(() => edit.pending.value || !isHoursValid.value);

async function onSave(): Promise<void> {
  if (!isHoursValid.value) return;
  const n = Number.parseFloat(hoursDraft.value);
  await edit.save(async () => {
    await props.client.post(
      "/v1/sleep-logs",
      { slept_on: editingDate.value, hours: n, quality: qualityDraft.value },
      SleepLogResponseSchema,
    );
    emit("saved");
  });
}

async function onDeleteConfirmed(): Promise<void> {
  const night = editingNight.value;
  if (!night) return;
  await edit.save(async () => {
    await props.client.delete(`/v1/sleep-logs/${night.id}`, z.undefined());
    emit("saved");
  });
}
</script>

<template>
  <div class="block sleep-block" data-test="sleep-block">
    <BlockEditButton v-if="!edit.isEditing.value" label="Edit sleep" @click="beginEdit()" />
    <div class="caption" data-test="sleep-caption">Sleep</div>

    <div v-if="!edit.isEditing.value" class="stat-row">
      <span class="label">{{ rowLabel }}</span>
      <span v-if="lastNightLabel !== null" class="val">{{ lastNightLabel }}</span>
      <span v-else class="val placeholder">— no log</span>
      <span
        v-if="lastNightQuality !== null"
        class="quality"
        data-test="sleep-quality"
      >· {{ lastNightQuality }}/5</span>
      <span :class="['delta', sleepDebt.debt_hours > 0 ? 'up' : 'dn']">{{ debtLabel }}</span>
    </div>

    <div v-else class="stat-row edit-row">
      <span class="label">{{ editLabel }}</span>
      <input
        ref="hoursInputRef"
        v-model="hoursDraft"
        type="text"
        inputmode="decimal"
        class="hours-input"
        data-test="sleep-hours-input"
        @keydown.esc="edit.cancel()"
        @keydown.enter.prevent="!saveDisabled && onSave()"
      />
      <span class="unit-label">h</span>
      <QualityPicker v-model="qualityDraft" label="Sleep quality" />
      <span v-if="confirmingDelete" class="confirm" data-test="sleep-delete-confirm">
        <span class="q">Delete?</span>
        <button
          type="button"
          class="yes"
          data-test="sleep-delete-yes"
          :disabled="edit.pending.value"
          @click="onDeleteConfirmed"
        >
          Yes
        </button>
        <button type="button" class="no" data-test="sleep-delete-no" @click="confirmingDelete = false">
          No
        </button>
      </span>
      <template v-else>
        <button
          type="button"
          class="save"
          data-test="sleep-save"
          :disabled="saveDisabled"
          @click="onSave"
        >
          Save
        </button>
        <button
          v-if="editingNight"
          type="button"
          class="delete"
          data-test="sleep-delete"
          :disabled="edit.pending.value"
          @click="confirmingDelete = true"
        >
          Delete
        </button>
        <button
          type="button"
          class="cancel"
          data-test="sleep-cancel"
          aria-label="Cancel"
          :disabled="edit.pending.value"
          @click="edit.cancel()"
        >
          ×
        </button>
      </template>
    </div>
    <div v-if="edit.error.value" class="edit-error" data-test="sleep-edit-error">
      {{ edit.error.value }}
    </div>

    <p
      v-if="nights.length === 0"
      class="sleep-empty"
      data-test="sleep-empty"
    >
      No sleep logged in the last {{ windowDates.length }} nights.
    </p>
    <DayBarChart
      v-else
      test-id="sleep"
      :bars="chartBars"
      :editing-key="edit.isEditing.value ? editingDate : null"
      :reference="{ pct: geometry.referenceLinePct, label: '8h' }"
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
.sleep-block { position: relative; }
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
.stat-row .quality {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: var(--ink-dim, #9aa0ad);
}
.stat-row .delta {
  margin-left: auto;
  color: var(--ink-dim, #9aa0ad);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.stat-row .delta.up { color: var(--bad, #f08a8a); }
.stat-row .delta.dn { color: var(--good, #4cc38a); }
.edit-row {
  align-items: center;
  /* hours + unit + QualityPicker + Save/Cancel can exceed one row on narrow
     screens — allow wrapping. */
  flex-wrap: wrap;
}
.hours-input {
  width: 72px;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--ink, #e6e8ee);
}
.hours-input:focus { outline: none; border-color: var(--accent, #4a7dff); }
.unit-label { color: var(--ink-dim, #9aa0ad); font-size: 12px; }
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
.sleep-empty {
  margin: 8px 0 0;
  font-style: italic;
  color: var(--ink-faint, #6b7180);
  font-size: 12px;
}
</style>
