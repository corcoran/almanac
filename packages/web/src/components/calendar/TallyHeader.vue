<!-- packages/web/src/components/calendar/TallyHeader.vue -->
<script setup lang="ts">
import { computed } from "vue";
import type { CalendarMode } from "../../lib/calendar-mode.js";
import type { IntakeMonthSummary } from "../../lib/intake-month-summary.js";
import { templateColor } from "../../lib/template-color.js";

const props = defineProps<{
  month: string; // YYYY-MM
  tally: { total: number; by_template: Record<string, number> };
  mode: CalendarMode;
  intakeSummary: IntakeMonthSummary | null;
}>();

const emit = defineEmits<{
  (e: "prev"): void;
  (e: "next"): void;
  (e: "update:mode", mode: CalendarMode): void;
}>();

/** Locale-aware "May 2026". Forced to UTC so the same month string always
 *  renders the same label regardless of where the browser is. */
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
});

const monthLabel = computed(() => {
  // Noon-UTC anchor — safe across all browser timezones.
  return monthFormatter.format(new Date(`${props.month}-01T12:00:00Z`));
});

/**
 * Per-template counts sorted by count (desc) then name (asc) — keeps the
 * inline summary "PUSH 4 · PULL 3 · LEGS 2" reading in a sensible order
 * even if the API ever returns the map in iteration order alone.
 */
const orderedTallies = computed(() => {
  return Object.entries(props.tally.by_template).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
});
</script>

<template>
  <div class="cal-head" data-test="cal-head">
    <div class="cal-head-left">
      <span class="title">{{ monthLabel }}</span>
      <span v-if="mode === 'workouts'" class="tally" data-test="workout-tally">
        · Total {{ tally.total }}<template
          v-for="[name, count] in orderedTallies"
          :key="name"
        >{{ " · " }}<span data-test="tally-chip"><span class="chip-dot" :style="{ backgroundColor: templateColor(name) }" />{{ name }} {{ count }}</span></template>
      </span>
      <span v-else-if="intakeSummary" class="tally" data-test="intake-summary">
        · <b>{{ intakeSummary.logged }}</b> logged
        · <b class="c-ok">{{ intakeSummary.on_target }}</b> on target
        · <b class="c-off">{{ intakeSummary.off_track }}</b> off track
      </span>
    </div>
    <div class="cal-right">
      <div class="cal-nav">
        <button
          type="button"
          data-test="cal-prev"
          aria-label="Previous month"
          @click="emit('prev')"
        >‹</button>
        <button
          type="button"
          data-test="cal-next"
          aria-label="Next month"
          @click="emit('next')"
        >›</button>
      </div>
      <div class="cal-mode" data-test="cal-mode">
        <button
          type="button"
          data-test="mode-workouts"
          :class="{ active: mode === 'workouts' }"
          :aria-pressed="mode === 'workouts'"
          @click="emit('update:mode', 'workouts')"
        >Workouts</button>
        <button
          type="button"
          data-test="mode-intake"
          :class="{ active: mode === 'intake' }"
          :aria-pressed="mode === 'intake'"
          @click="emit('update:mode', 'intake')"
        >Intake</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.cal-head-left {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}
.cal-head .title {
  font-weight: 600;
  color: var(--ink, #e6e8ee);
}
.cal-head .tally {
  color: var(--ink-dim, #9aa0ad);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cal-head .tally b {
  color: var(--ink, #e6e8ee);
  font-weight: 700;
}
.cal-head .tally b.c-ok { color: var(--ok, #6ec27c); }
.cal-head .tally b.c-off { color: var(--bad, #e0707a); }
.chip-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
.cal-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.cal-nav {
  display: inline-flex;
  gap: 4px;
}
.cal-nav button {
  background: transparent;
  border: 1px solid var(--line-2, #2a2f3d);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 4px;
  width: 22px;
  height: 22px;
  cursor: pointer;
  font: inherit;
  line-height: 1;
}
.cal-nav button:hover {
  color: var(--ink, #e6e8ee);
}
.cal-mode {
  display: flex;
  border: 1px solid var(--line-2, #2a2f3d);
  border-radius: 6px;
  overflow: hidden;
}
.cal-mode button {
  background: none;
  border: none;
  color: var(--ink-faint, #6b7180);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  letter-spacing: 0.3px;
}
.cal-mode button.active {
  background: #222633;
  color: var(--ink, #e6e8ee);
}
</style>
