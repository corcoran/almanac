<script setup lang="ts">
import { computed } from "vue";
import { kgToDisplayWeight, type UnitSystem, weightUnitLabel } from "../../lib/units.js";
import { weightColor } from "../../lib/weight-color.js";
import type { TemplateLastSessionEntry } from "../../stores/template-last-sessions.js";

const props = defineProps<{
  entry: TemplateLastSessionEntry;
  unitSystem: UnitSystem;
}>();

// The header line shows date + RPE + unit. We use Intl.DateTimeFormat with a
// month/day format ("May 18") matching the chevron pill's label. Year is
// omitted intentionally — past sessions in this picker are always recent
// enough that a year is noise. Tests assert the month/day substring rather
// than the exact locale string so this stays portable across jsdom locales.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const formattedDate = computed(() => {
  if (props.entry.status !== "ready" || !props.entry.data) return "";
  return dateFormatter.format(new Date(props.entry.data.started_at));
});

const unitLabel = computed(() => weightUnitLabel(props.unitSystem));

// Drops skipped exercises (per spec: skipped is session noise). The
// outer template carries through the ready+data guard so this only runs
// when there's a session to show.
const visibleExercises = computed(() => {
  if (props.entry.status !== "ready" || !props.entry.data) return [];
  return props.entry.data.exercises.filter((ex) => !ex.skipped);
});

// Max set count across all visible exercises. Drives the grid column count
// and the header row ("Set 1 / Set 2 / ..."). Zero when there are no
// exercises or every visible exercise has an empty sets[] — in that case
// the grid still renders just the name column.
const maxSetCount = computed(() => {
  let max = 0;
  for (const ex of visibleExercises.value) {
    if (ex.sets.length > max) max = ex.sets.length;
  }
  return max;
});

// Pre-built column headers: ["Set 1", "Set 2", ...]. Empty array when
// maxSetCount === 0 (no sets across the session) — the header row is
// skipped entirely in that case to avoid a lonely empty row.
const setColumnLabels = computed(() => {
  const labels: string[] = [];
  for (let i = 0; i < maxSetCount.value; i += 1) {
    labels.push(`Set ${i + 1}`);
  }
  return labels;
});

type SessionSet = (typeof visibleExercises.value)[number]["sets"][number];

// Resolve each visible exercise into a fixed-width row of `maxSetCount` cells,
// padding short exercises with `null`. Resolving here (rather than indexing
// `ex.sets[i - 1]` in the template) means the template iterates over concrete
// `SessionSet | null` cells and never indexes by a number TS can't prove is in
// range — so no non-null assertion is needed.
const gridRows = computed<
  Array<{ exerciseId: number; name: string; cells: Array<SessionSet | null> }>
>(() => {
  const count = maxSetCount.value;
  return visibleExercises.value.map((ex) => ({
    exerciseId: ex.exercise_id,
    name: ex.exercise_name,
    cells: Array.from({ length: count }, (_, i) => ex.sets[i] ?? null),
  }));
});

// CSS grid template: name column + N equal-width set columns. We embed the
// count directly in the style binding rather than via a CSS custom property
// because `repeat(var(--n), ...)` requires the var to be defined on the
// same element AND some older browsers stumble on dynamic repeat counts.
const gridStyle = computed(() => ({
  gridTemplateColumns: `minmax(120px, 1fr) repeat(${maxSetCount.value}, minmax(56px, auto))`,
}));

// Weight-only formatter. Returns "bw" for bodyweight (weight_kg === null)
// and the display weight (no unit suffix — that's in the header) otherwise.
// Split out from the reps so the weight value can carry its own per-weight
// hue while the reps and × stay in the ambient ink-dim color.
function formatWeightForCell(set: { weight_kg: number | null }): string {
  if (set.weight_kg === null) return "bw";
  const display = kgToDisplayWeight(set.weight_kg, props.unitSystem);
  return `${display}`;
}
</script>

<template>
  <div class="last-session-panel" data-test="last-session-panel">
    <p v-if="entry.status === 'loading'" class="status status--loading">
      Loading last session…
    </p>
    <p v-else-if="entry.status === 'error'" class="status status--error">
      Couldn't load last session.
    </p>
    <!-- ready + data === null shouldn't happen in practice (the chevron is
         hidden retroactively when the store learns there's no history), but
         we render nothing rather than blowing up if it does. -->
    <template v-else-if="entry.status === 'ready' && entry.data !== null">
      <div class="header" data-test="last-session-header">
        <span class="started-at">{{ formattedDate }}</span>
        <span v-if="entry.data.rpe !== null" class="rpe"
          >· RPE {{ entry.data.rpe }}</span
        >
        <span class="unit">· weights in {{ unitLabel }}</span>
      </div>
      <div
        class="exercise-grid"
        :style="gridStyle"
        data-test="last-session-grid"
      >
        <!-- Header row: empty cell over the name column, then "Set N" labels.
             Skipped entirely when there are no sets to label. -->
        <template v-if="setColumnLabels.length > 0">
          <div class="col-header col-header-name" aria-hidden="true"></div>
          <div
            v-for="label in setColumnLabels"
            :key="label"
            class="col-header"
            data-test="set-column-header"
          >
            {{ label }}
          </div>
        </template>
        <!-- One row per visible exercise. Each row contributes
             1 + maxSetCount cells so columns stay aligned even when this
             exercise has fewer sets than the session max — trailing cells
             render as empty placeholders. -->
        <template v-for="row in gridRows" :key="row.exerciseId">
          <div class="exercise-name" data-test="last-session-exercise-name">
            {{ row.name }}
          </div>
          <div
            v-for="(set, i) in row.cells"
            :key="i"
            class="set-cell"
            :class="{ 'set-cell-empty': !set }"
            data-test="set-cell"
          >
            <template v-if="set"
              ><span class="set-reps">{{ set.reps }}</span
              ><span class="set-x">×</span
              ><span
                class="set-weight"
                :style="{ color: weightColor(set.weight_kg) }"
                data-test="set-weight"
                >{{ formatWeightForCell(set) }}</span
              ></template
            >
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.last-session-panel {
  margin-top: 4px;
  padding: 10px 12px;
  border: 1px solid #262a36;
  border-radius: 6px;
  background: #12141c;
  font-size: 12px;
  color: #9aa0ad;
}
.status {
  margin: 0;
  font-style: italic;
}
.status--error {
  color: #e6b450;
}
.header {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 6px;
  color: #6b7180;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.rpe,
.unit {
  color: #6b7180;
}
.exercise-grid {
  display: grid;
  column-gap: 12px;
  row-gap: 4px;
  align-items: baseline;
}
.exercise-grid .col-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7180;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.exercise-grid .col-header-name {
  /* Empty cell above the name column — no styling needed. */
}
.exercise-grid .exercise-name {
  color: #c8ccd6;
  font-weight: 500;
  line-height: 1.5;
}
.exercise-grid .set-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #9aa0ad;
  font-size: 12px;
  line-height: 1.5;
}
.exercise-grid .set-cell-empty {
  /* nothing — empty space keeps the column slot reserved */
}
</style>
