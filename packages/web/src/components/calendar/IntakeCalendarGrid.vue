<script setup lang="ts">
import type { DayMacrosResponseSchema } from "@almanac/core/schemas";
import { computed } from "vue";
import type { z } from "zod";
import { useCalendarCells } from "../../composables/useCalendarCells.js";

type DayMacros = z.infer<typeof DayMacrosResponseSchema>;

const props = defineProps<{
  month: string; // YYYY-MM
  today: string; // YYYY-MM-DD
  days: DayMacros[];
  selectedDate?: string; // YYYY-MM-DD — optional selected day highlight
}>();

const emit = defineEmits<(e: "select", date: string) => void>();

function onCellClick(date: string): void {
  if (date <= props.today) emit("select", date);
}

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/**
 * Cell visual states, mutually exclusive. "empty" covers future days,
 * out-of-month spill and missing data — day number only.
 */
type CellState =
  | "ok"
  | "risk"
  | "off"
  | "untracked"
  | "unlogged"
  | "notarget"
  | "progress"
  | "empty";

type IntakeCell = {
  date: string;
  dayNumber: number;
  isInMonth: boolean;
  isToday: boolean;
  state: CellState;
  kcal: string | null;
  delta: string | null;
  beer: string | null;
};

const kcalFormat = new Intl.NumberFormat("en-US");

const STATUS_TO_STATE = {
  on_track: "ok",
  at_risk: "risk",
  off_track: "off",
} as const satisfies Record<string, CellState>;

/** Signed delta with the typographic minus; dead-on renders ±0. */
function formatDelta(vsTarget: number): string {
  const r = Math.round(vsTarget);
  if (r === 0) return "±0";
  return r < 0 ? `−${Math.abs(r)}` : `+${r}`;
}

/**
 * Resolve one day to its visual bundle. Priority (spec): untracked beats
 * today (a deliberately-skipped today reads as skipped, not in-progress);
 * today beats unlogged (zero intake mid-day is stripes, not "forgot").
 */
function resolveDay(
  day: DayMacros | undefined,
  isToday: boolean,
): Pick<IntakeCell, "state" | "kcal" | "delta" | "beer"> {
  if (day === undefined) return { state: "empty", kcal: null, delta: null, beer: null };
  if (day.untracked) return { state: "untracked", kcal: null, delta: null, beer: null };

  const kcal = day.day_totals.kcal;
  const beer =
    day.day_totals.kcal_from_alcohol > 0
      ? kcalFormat.format(Math.round(day.day_totals.kcal_from_alcohol))
      : null;

  if (isToday) {
    if (kcal <= 0) return { state: "progress", kcal: null, delta: null, beer: null };
    return {
      state: "progress",
      kcal: kcalFormat.format(Math.round(kcal)),
      delta: day.day_target !== null ? formatDelta(day.day_target.observed.vs_target) : null,
      beer,
    };
  }
  if (kcal <= 0) return { state: "unlogged", kcal: null, delta: null, beer: null };
  if (day.day_target === null) {
    return { state: "notarget", kcal: kcalFormat.format(Math.round(kcal)), delta: null, beer };
  }
  const status = day.day_target.observed.status;
  return {
    state: STATUS_TO_STATE[status],
    kcal: kcalFormat.format(Math.round(kcal)),
    delta: formatDelta(day.day_target.observed.vs_target),
    beer,
  };
}

const cells = computed<IntakeCell[]>(() => {
  const byDate = new Map(props.days.map((d) => [d.date, d]));
  return useCalendarCells(props.month, props.today).map((c) => {
    const day = c.isInMonth ? byDate.get(c.date) : undefined;
    const resolved = resolveDay(day, c.isToday);
    return {
      date: c.date,
      dayNumber: c.dayNumber,
      isInMonth: c.isInMonth,
      isToday: c.isToday,
      ...resolved,
    };
  });
});

const LEGEND = [
  { cls: "ok", label: "on target" },
  { cls: "risk", label: "at risk" },
  { cls: "off", label: "off track" },
  { cls: "untracked", label: "untracked" },
  { cls: "unlogged", label: "unlogged" },
  { cls: "progress", label: "in progress" },
] as const;
</script>

<template>
  <div>
    <div class="cal" data-test="intake-grid">
      <div v-for="(lbl, i) in DOW_LABELS" :key="`dow-${i}`" class="dow">{{ lbl }}</div>
      <div
        v-for="c in cells"
        :key="c.date"
        class="cell"
        :class="[c.state, { dim: !c.isInMonth, today: c.isToday, selected: c.date === selectedDate, clickable: c.date <= today }]"
        :data-date="c.date"
        @click="onCellClick(c.date)"
      >
        <span class="dnum">{{ c.dayNumber }}</span>
        <span v-if="c.kcal !== null" class="kcal" data-test="cell-kcal">{{ c.kcal }}</span>
        <span v-if="c.delta !== null" class="delta" data-test="cell-delta">{{ c.delta }}</span>
        <span v-if="c.beer !== null" class="beer" data-test="cell-beer">🍺 {{ c.beer }}</span>
        <span v-if="c.state === 'untracked'" class="skiplbl">skipped</span>
      </div>
    </div>
    <div class="legend-row">
      <div class="legend" data-test="intake-legend">
        <span v-for="item in LEGEND" :key="item.cls">
          <i class="sw" :class="`sw-${item.cls}`" />{{ item.label }}
        </span>
      </div>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
/* Grid frame mirrors CalendarGrid.vue (kept separate by spec: the workout
   grid is untouched, so its scoped styles can't be shared). */
.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--cal-gap, 2px);
  font-variant-numeric: tabular-nums;
}
.cal .dow {
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  text-align: center;
  padding-bottom: 4px;
}
.cal .cell {
  position: relative;
  /* Same 60px as the workout grid so the toggle doesn't shift the layout.
     The tighter 2px vertical padding is what buys room for the 4-line
     worst case (day number + kcal + delta + 🍺) inside the same height. */
  height: var(--cal-cell-h, 60px);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 5px;
  background: rgba(255, 255, 255, 0.015);
  color: var(--ink-dim, #9aa0ad);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 10px;
}
.cal .cell.dim {
  color: var(--ink-faint, #6b7180);
  background: transparent;
}
.cal .cell.today {
  border-color: var(--accent, #f1c453);
  color: var(--ink, #e6e8ee);
}
.cal .cell .dnum { font-size: 11px; line-height: 1.2; }

/* state fills */
.cal .cell.ok { background: rgba(110, 194, 124, 0.16); }
.cal .cell.risk { background: rgba(230, 180, 80, 0.18); }
.cal .cell.off { background: rgba(224, 112, 122, 0.18); }
.cal .cell.untracked { background: rgba(154, 160, 173, 0.14); }
.cal .cell.unlogged { background: transparent; }
.cal .cell.unlogged .dnum { color: var(--ink-faint, #6b7180); opacity: 0.6; }
.cal .cell.notarget { background: rgba(255, 255, 255, 0.04); }
.cal .cell.progress {
  background: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.05) 0 6px,
    rgba(255, 255, 255, 0.012) 6px 12px
  );
}

.cal .cell.clickable { cursor: pointer; }
.cal .cell.selected {
  outline: 2px solid var(--accent, #4a7dff);
  outline-offset: -2px;
  border-radius: 4px;
}

/* cell text lines */
.cal .cell .kcal {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink, #e6e8ee);
  line-height: 1.25;
}
.cal .cell .delta { font-size: 9.5px; font-weight: 600; line-height: 1.25; }
.cal .cell.ok .delta { color: var(--ok, #6ec27c); }
.cal .cell.risk .delta { color: var(--warn, #e6b450); }
.cal .cell.off .delta { color: var(--bad, #e0707a); }
.cal .cell.progress .delta { color: var(--ink-dim, #9aa0ad); }
.cal .cell .beer {
  font-size: 9px;
  color: var(--ink-dim, #9aa0ad);
  line-height: 1.3;
  white-space: nowrap;
}
.cal .cell .skiplbl {
  font-size: 8.5px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: auto;
  padding-bottom: 1px;
}

/* legend footer — the swatches sit on the left, the optional #actions slot
   (the Mark vacation button) on the right of the same divider row. */
.legend-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-top: 1px solid var(--line, #262a36);
  margin-top: 10px;
  padding-top: 8px;
}
/* The #actions button (Mark vacation, passed in by MonthCalendar) stays
   right-aligned whether it sits inline with the legend or wraps onto its own
   line on a narrow screen — margin-left:auto pushes it right in both cases,
   which justify-content:space-between alone can't do once it wraps. */
.legend-row > :slotted(*) {
  margin-left: auto;
}
.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 9.5px;
  color: var(--ink-faint, #6b7180);
}
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.legend .sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.legend .sw-ok { background: rgba(110, 194, 124, 0.4); }
.legend .sw-risk { background: rgba(230, 180, 80, 0.45); }
.legend .sw-off { background: rgba(224, 112, 122, 0.45); }
.legend .sw-untracked { background: rgba(154, 160, 173, 0.35); }
.legend .sw-unlogged { background: transparent; border: 1px solid var(--line, #262a36); }
.legend .sw-progress {
  background: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.25) 0 2px,
    transparent 2px 4px
  );
}
</style>
