<script setup lang="ts">
import type { DayMacrosResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";
import { useIsMobile } from "../../composables/useIsMobile.js";

type DayMacros = z.infer<typeof DayMacrosResponseSchema>;
// `observed.status` enum — the three values reach the kcal-row tint and nowhere
// else.
type ObservedStatus = "on_track" | "at_risk" | "off_track";

const props = defineProps<{ days: DayMacros[] }>();

const { isMobile } = useIsMobile();
const expanded = ref(false);

const weekdayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  timeZone: "UTC",
});

function dayOfWeekLabel(iso: string): string {
  // Parse at noon UTC so the formatter (also UTC) always lands on the
  // intended day regardless of system tz.
  return weekdayFmt.format(new Date(`${iso}T12:00:00Z`)).slice(0, 2);
}

/**
 * Round to 1 decimal and drop a trailing `.0`. Integer-valued rows (kcal,
 * cardio, workout, net — all returned as ints by the server) come through
 * unchanged; macros (P/C/F) from meal totals can carry 2+ decimal places
 * (e.g. 345.75) and get trimmed to one. Per-row averages also flow through
 * here, so a kcal-row average of 1898.857… renders as "1898.9".
 */
function formatNumber(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded.toString();
}

/** Em-dash placeholder for days with no active phase (day_target == null). */
const EM_DASH = "—";

/**
 * Arithmetic mean of `values`, skipping `null`/`undefined`. Returns `null`
 * when every entry was missing — the avg cell renders em-dash in that case,
 * mirroring how individual day cells render `—` for no-data.
 *
 * Why skip nulls instead of treating them as 0: the activity/net rows
 * collapse to em-dash on no-phase days, and a no-phase day isn't an "I rested"
 * data point — it's an "I wasn't tracking" data point. Counting it as 0
 * would systematically pull the weekly average down across the cold-start
 * period. Mirrors the precedent in `get-macros-range.ts`'s
 * `rolling_7d_avg_kcal_in` (filter out null-phase days, then average).
 */
function meanSkipNulls(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((s, n) => s + n, 0) / present.length;
}

const headers = computed(() => props.days.map((d) => dayOfWeekLabel(d.date)));

const visibleDays = computed(() => {
  if (!isMobile.value || expanded.value) return props.days;
  if (props.days.length <= 3) return props.days;
  return props.days.slice(-3);
});

const visibleHeaders = computed(() => {
  if (!isMobile.value || expanded.value) return headers.value;
  if (headers.value.length <= 3) return headers.value;
  return headers.value.slice(-3);
});

type Cell = {
  /** Display string — either a formatted number, or `EM_DASH` for null-phase days. */
  text: string;
  isToday: boolean;
  /**
   * For the kcal row only: the day's observed status, driving the cell tint.
   * `null` → no tint (used for non-kcal rows and for null-phase days where
   * there's no plan to be on/off of).
   */
  status: ObservedStatus | null;
};

type Row = {
  key: string;
  label: string;
  cssVar: string;
  cells: Cell[];
  /**
   * Display string for the trailing "avg" cell — the per-row weekly mean.
   * For the `net` row this is the headline number the user actually steers
   * by; for activity rows it's their typical daily contribution; for intake
   * rows it's the running average against target. Em-dash when no row has
   * data to average (e.g. a window made entirely of no-phase days).
   */
  avgText: string;
};

const visibleRows = computed<Row[]>(() => {
  const allDays = props.days;
  const vDays = visibleDays.value;
  const allLastIdx = allDays.length - 1;

  const numOrDash = (v: number | null | undefined): string =>
    v == null ? EM_DASH : formatNumber(v);

  // Days that count toward trailing averages. Order matters: drop today FIRST
  // (positional — it's the incomplete in-progress day, always the last element),
  // THEN drop untracked (vacation/sick/deload) days. Filtering untracked before
  // the positional drop would, when today itself is untracked, chop the
  // genuinely-last tracked day instead of today. See design spec.
  const avgDays = allDays.slice(0, -1).filter((d) => !d.untracked);

  const avgOrDash = (pick: (d: (typeof allDays)[number]) => number | null | undefined): string =>
    numOrDash(meanSkipNulls(avgDays.map(pick)));

  function makeCells(
    dayMapper: (
      d: (typeof allDays)[number],
      globalIdx: number,
    ) => { text: string; status: ObservedStatus | null },
  ): Cell[] {
    const startIdx = allDays.length - vDays.length;
    return vDays.map((d, vi) => {
      const gi = startIdx + vi;
      const mapped = dayMapper(d, gi);
      return { ...mapped, isToday: gi === allLastIdx };
    });
  }

  return [
    {
      key: "kcal",
      label: "kcal",
      cssVar: "var(--m-kcal)",
      cells: makeCells((d) => ({
        text: formatNumber(d.day_totals.kcal),
        status: d.day_target?.observed.status ?? null,
      })),
      avgText: avgOrDash((d) => d.day_totals.kcal),
    },
    {
      key: "protein",
      label: "P (g)",
      cssVar: "var(--m-protein)",
      cells: makeCells((d) => ({ text: formatNumber(d.day_totals.protein_g), status: null })),
      avgText: avgOrDash((d) => d.day_totals.protein_g),
    },
    {
      key: "carb",
      label: "C (g)",
      cssVar: "var(--m-carb)",
      cells: makeCells((d) => ({ text: formatNumber(d.day_totals.carb_g), status: null })),
      avgText: avgOrDash((d) => d.day_totals.carb_g),
    },
    {
      key: "fat",
      label: "F (g)",
      cssVar: "var(--m-fat)",
      cells: makeCells((d) => ({ text: formatNumber(d.day_totals.fat_g), status: null })),
      avgText: avgOrDash((d) => d.day_totals.fat_g),
    },
    {
      key: "cardio",
      label: "cardio",
      cssVar: "var(--warn, #e6b450)",
      cells: makeCells((d) => ({
        text: numOrDash(d.day_target?.observed.cardio_kcal ?? null),
        status: null,
      })),
      avgText: avgOrDash((d) => d.day_target?.observed.cardio_kcal ?? null),
    },
    {
      key: "workout",
      label: "workout",
      cssVar: "var(--accent, #6ea8ff)",
      cells: makeCells((d) => ({
        text: numOrDash(d.day_target?.observed.workout_kcal ?? null),
        status: null,
      })),
      avgText: avgOrDash((d) => d.day_target?.observed.workout_kcal ?? null),
    },
    {
      key: "steps",
      label: "steps",
      cssVar: "var(--ok, #6ec27c)",
      cells: makeCells((d) => ({
        text: numOrDash(d.day_target?.observed.steps_kcal ?? null),
        status: null,
      })),
      avgText: avgOrDash((d) => d.day_target?.observed.steps_kcal ?? null),
    },
    {
      key: "net",
      label: "net",
      cssVar: "var(--ink-dim, #9aa0b0)",
      cells: makeCells((d) => ({
        text: numOrDash(d.net_kcal ?? null),
        status: null,
      })),
      avgText: avgOrDash((d) => d.net_kcal ?? null),
    },
  ];
});

const gridStyle = computed(() => {
  const colCount = visibleHeaders.value.length;
  return {
    gridTemplateColumns: `64px repeat(${colCount}, 1fr) 1.15fr`,
  };
});
</script>

<template>
  <div class="block" data-test="macros-week-grid">
    <div class="caption">
      <span v-if="isMobile && !expanded && days.length > 3">Last 3 days · today rightmost</span>
      <span v-else>Last 7 days · today rightmost</span>
      <button
        v-if="isMobile && days.length > 3"
        type="button"
        class="expand-toggle"
        @click="expanded = !expanded"
      >{{ expanded ? 'Show 3 days' : 'Show all 7 days' }}</button>
    </div>
    <p v-if="days.length === 0" class="loading" data-test="macros-loading">
      Loading 7-day macros…
    </p>
    <div v-else class="macros-grid" :style="gridStyle">
      <span class="corner"></span>
      <span
        v-for="(h, i) in visibleHeaders"
        :key="`h-${i}`"
        class="head"
        data-test="macros-head"
      >{{ h }}</span>
      <!-- Trailing "6d avg" column header. The "6d" makes the today-exclusion
           rule visible in the UI: today's mid-day data isn't averaged in (it
           would drag the number toward a partial reading). Same `head`
           styling as weekdays but visually separated by a vertical rule on
           the cell below — see CSS. -->
      <span class="head head-avg" data-test="macros-head-avg">6d avg</span>

      <template v-for="row in visibleRows" :key="row.key">
        <span
          class="rowlbl"
          data-test="macros-rowlbl"
          :style="{ color: row.cssVar }"
        >{{ row.label }}</span>
        <span
          v-for="(cell, i) in row.cells"
          :key="`${row.key}-${i}`"
          class="cell"
          :class="[
            cell.status ? `status-${cell.status}` : null,
            { today: cell.isToday },
          ]"
          :data-status="cell.status ?? undefined"
          data-test="macros-cell"
        >{{ cell.text }}</span>
        <!-- Avg cell — sits in its own column with a left border separating
             it from the day cells. Intentionally carries NO status tint and
             NO today highlight: those are per-day concepts that don't map
             onto a 7-day summary. The `net` row's avg gets extra emphasis
             since it's the headline cut-progress number. -->
        <span
          class="cell cell-avg"
          :class="{ 'cell-avg-net': row.key === 'net' }"
          data-test="macros-cell-avg"
          :data-row="row.key"
        >{{ row.avgText }}</span>
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
.caption {
  font-size: 11px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.loading {
  margin: 0;
  font-style: italic;
  color: var(--ink-faint, #6b7180);
  font-size: 12px;
}
.macros-grid {
  display: grid;
  gap: 2px 6px;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.head {
  color: var(--ink-faint, #6b7180);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: center;
}
/* The avg-column header gets the same left-rule treatment as its cells so
   the separation between day-data and summary is consistent vertically. */
.head-avg {
  border-left: 1px solid var(--line, #262a36);
}
.rowlbl {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.cell {
  text-align: center;
  padding: 2px 0;
  border-radius: 3px;
  color: var(--ink, #e6e8ee);
}
/* Avg column cells — left rule to separate from day cells, no border-radius
   on the left side so the rule reads as a continuous column divider rather
   than a series of disconnected stubs. */
.cell-avg {
  border-left: 1px solid var(--line, #262a36);
  padding-left: 4px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
/* Net-row avg — the headline number. Slightly bolder + subtle background so
   the eye lands on it. No color swap (keeps neutral so positive vs negative
   reads in normal ink). */
.cell-avg-net {
  font-weight: 600;
  background: rgba(154, 160, 176, 0.08);
}

/* Status tints on the kcal row — a green/amber/red palette. Subtle background
 * tint + tinted text (not a full-saturation fill) so the cells don't scream
 * across the grid. Only applied to the kcal row (per spec); other rows pass
 * `status: null`. `today` wins (defined last) so the current day stays
 * visually anchored even when its kcal is off-plan. */
.cell.status-on_track {
  background: rgba(110, 194, 124, 0.13);
  color: var(--ok, #6ec27c);
}
.cell.status-at_risk {
  background: rgba(230, 180, 80, 0.13);
  color: var(--warn, #e6b450);
}
.cell.status-off_track {
  background: rgba(220, 38, 38, 0.16);
  color: #ff6b6b;
}
.cell.today {
  background: rgba(110, 168, 255, 0.13);
  color: var(--accent, #6ea8ff);
  font-weight: 600;
}
.expand-toggle {
  background: transparent;
  border: none;
  color: var(--accent, #6ea8ff);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  text-transform: none;
  letter-spacing: normal;
}
</style>
