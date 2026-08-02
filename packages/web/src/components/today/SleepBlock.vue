<script setup lang="ts">
import { SleepLogResponseSchema, type TodayContextResponseSchema } from "@almanac/core/schemas";
import { computed, nextTick, ref } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { useInlineEdit } from "../../composables/useInlineEdit.js";
import { sleepBarGeometry } from "../../lib/bar-chart.js";
import { sleepColor } from "../../lib/sleep-color.js";
import BlockEditButton from "./BlockEditButton.vue";
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

// "Last night" on today; the night's short date when traversing a past day.
const rowLabel = computed(() =>
  props.isPastDay ? shortDateFmt.format(new Date(`${props.date}T12:00:00Z`)) : "Last night",
);

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
  const sign = debt.debt_hours > 0 ? "debt" : "ahead";
  const abs = Math.abs(debt.debt_hours).toFixed(1);
  return `${sign} ${abs}h / ${debt.window_days}d`;
});

// ── Inline edit ─────────────────────────────────────────────────────────────

const edit = useInlineEdit();
const hoursDraft = ref("");
const qualityDraft = ref<number | null>(null);
const hoursInputRef = ref<HTMLInputElement | null>(null);

function activeNight(): SleepLog | undefined {
  return props.nights.find((n) => n.slept_on === props.date);
}

function beginEdit(): void {
  const night = activeNight();
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
      { slept_on: props.date, hours: n, quality: qualityDraft.value },
      SleepLogResponseSchema,
    );
    emit("saved");
  });
}
</script>

<template>
  <div class="block sleep-block" data-test="sleep-block">
    <BlockEditButton v-if="!edit.isEditing.value" label="Edit sleep" @click="beginEdit" />

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
      <span class="label">{{ rowLabel }}</span>
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
        type="button"
        class="cancel"
        data-test="sleep-cancel"
        aria-label="Cancel"
        :disabled="edit.pending.value"
        @click="edit.cancel()"
      >
        ×
      </button>
    </div>
    <div v-if="edit.error.value" class="edit-error" data-test="sleep-edit-error">
      {{ edit.error.value }}
    </div>

    <p
      v-if="nights.length === 0"
      class="sleep-empty"
      data-test="sleep-empty"
    >
      No sleep logged this week.
    </p>
    <div v-else class="sleep-bars">
      <div
        v-if="geometry.bars.length > 0"
        class="reference"
        data-test="sleep-reference"
        :style="{ bottom: `${geometry.referenceLinePct}%` }"
      >8h</div>
      <template v-for="bar in geometry.bars" :key="bar.slept_on">
        <div
          v-if="bar.logged"
          class="bar"
          :class="{ short: bar.isShort, 'tiny-bar': bar.heightPct < 25 }"
          :style="{ height: `${bar.heightPct}%`, backgroundColor: sleepColor(bar.hours) }"
          data-test="sleep-bar"
        >
          <span class="bar-hours" data-test="sleep-bar-hours">{{ formatHours(bar.hours) }}</span>
          <span class="lbl">{{ dayOfWeekLabel(bar.slept_on) }}</span>
        </div>
        <div
          v-else
          class="bar ghost"
          data-test="sleep-ghost"
        >
          <span class="lbl">{{ dayOfWeekLabel(bar.slept_on) }}</span>
        </div>
      </template>
    </div>
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
.edit-error { font-size: 11px; color: var(--bad, #f08a8a); margin-bottom: 6px; }
.sleep-empty {
  margin: 8px 0 0;
  font-style: italic;
  color: var(--ink-faint, #6b7180);
  font-size: 12px;
}
.sleep-bars {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  height: 60px;
  margin-top: 8px;
  padding-bottom: 14px;
}
.sleep-bars .bar {
  /* Background is set inline per-bar from sleepColor(hours) — red → amber
     → green gradient. This fallback shows only if the inline style is
     unset (defensive; in practice always present). */
  background: var(--line-2, #2a2f3d);
  border-radius: 2px;
  align-self: end;
  position: relative;
}
.sleep-bars .bar.ghost {
  /* Unlogged day: a short, faint dashed placeholder pinned at the baseline.
     Signals "no log here" without competing with real bars. */
  height: 14%;
  background: transparent;
  border: 1px dashed var(--line-2, #2a2f3d);
  opacity: 0.55;
}
.sleep-bars .lbl {
  position: absolute;
  bottom: -14px;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
}
.sleep-bars .bar-hours {
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
  line-height: 1;
  pointer-events: none;
}
.sleep-bars .bar.tiny-bar .bar-hours {
  /* Bars too thin for the label to sit inside — float it above instead. */
  top: -12px;
  color: var(--ink-dim, #9aa0ad);
}
.sleep-bars .reference {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed var(--line-2, #2a2f3d);
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
  padding-left: 2px;
  line-height: 0;
  pointer-events: none;
}
</style>
