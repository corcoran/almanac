<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ApiClient } from "../../api/client.js";
import { type CalendarMode, loadCalendarMode, saveCalendarMode } from "../../lib/calendar-mode.js";
import { summarizeIntakeMonth } from "../../lib/intake-month-summary.js";
import { useCalendarStore } from "../../stores/calendar.js";
import { useIntakeCalendarStore } from "../../stores/intake-calendar.js";
import CalendarGrid from "./CalendarGrid.vue";
import IntakeCalendarGrid from "./IntakeCalendarGrid.vue";
import TallyHeader from "./TallyHeader.vue";
import TimeOffModal from "./TimeOffModal.vue";

const props = defineProps<{ client: ApiClient; today: string; selectedDate: string }>();
const emit = defineEmits<(e: "select", date: string) => void>();

/**
 * Currently-displayed month, "YYYY-MM". Initialises from `selectedDate` so
 * the calendar opens on the right month, falling back to `today` while
 * `selectedDate` is still the empty boot value (the parent sets it to today
 * only after the today-context loads — an empty `"".slice(0,7)` would yield an
 * invalid month string that TallyHeader can't format). Owned here (not the
 * store) because prev/next is a UI affordance — the store caches whichever
 * months have been fetched, but cares nothing about which one is on screen.
 */
const currentMonth = ref((props.selectedDate || props.today).slice(0, 7));

/**
 * When the parent steps `selectedDate` into a different month (e.g. navigating
 * through the day list), scroll the calendar to that month automatically.
 * The user's own prev/next month buttons set `currentMonth` directly and are
 * unaffected — this watch only fires when the prop changes. Empty values are
 * ignored so the boot-time `"" → today` transition doesn't blank the month.
 */
watch(
  () => props.selectedDate,
  (d) => {
    if (d !== "") currentMonth.value = d.slice(0, 7);
  },
);
const store = useCalendarStore();
const intakeStore = useIntakeCalendarStore();

const showTimeOff = ref(false);

/**
 * A time-off period was created or deleted. Reload BOTH calendar stores for
 * the currently-displayed month so the shaded bands refresh immediately —
 * invalidating without re-fetching would leave the visible grid stale until
 * the next navigation (the stale-refresh-after-write failure mode). Workouts
 * mode reads untracked_bands from the calendar store; intake mode reads the
 * per-day untracked flag from the intake-calendar store — refresh both
 * regardless of the active mode so a later toggle shows fresh data too.
 */
async function onTimeOffChanged(): Promise<void> {
  await Promise.all([
    store.reloadForMonth(props.client, currentMonth.value),
    intakeStore.reloadForMonth(props.client, currentMonth.value, props.today),
  ]);
}

/** Workouts | Intake, persisted across visits. */
const mode = ref<CalendarMode>(loadCalendarMode());
watch(mode, (m) => {
  saveCalendarMode(m);
});

/**
 * Re-load whenever the month or mode changes. Both stores short-circuit
 * already-cached months internally, so toggling back and forth (or prev →
 * next → prev) never re-fetches a month either store has seen.
 *
 * `props.today` is deliberately NOT a watch source: it only changes if the
 * user-local day rolls over mid-session, and the intake store's ready-entry
 * cache ignores `today` anyway — a cached month keeps its original window
 * until a reload. Accepted staleness; a real fix would need today-aware
 * invalidation in the store.
 */
watch(
  [currentMonth, mode],
  ([month, m]) => {
    if (m === "workouts") {
      void store.loadForMonth(props.client, month);
    } else {
      void intakeStore.loadForMonth(props.client, month, props.today);
    }
  },
  { immediate: true },
);

const entry = computed(() => store.entryFor(currentMonth.value));
const intakeEntry = computed(() => intakeStore.entryFor(currentMonth.value));
const activeEntry = computed(() => (mode.value === "workouts" ? entry.value : intakeEntry.value));

const tally = computed(() => {
  if (entry.value.status === "ready") return entry.value.data.tally;
  return { total: 0, by_template: {} };
});

const intakeSummary = computed(() => {
  const e = intakeEntry.value;
  if (mode.value !== "intake" || e.status !== "ready") return null;
  return summarizeIntakeMonth(e.data.days, currentMonth.value, props.today);
});

function prev() {
  currentMonth.value = monthOffset(currentMonth.value, -1);
}

function next() {
  currentMonth.value = monthOffset(currentMonth.value, +1);
}

/** Add `delta` months to a "YYYY-MM" string, normalising wraparound at
 *  Jan/Dec boundaries. Pure math — no Date construction needed. */
function monthOffset(month: string, delta: number): string {
  // month is "YYYY-MM" by construction (today.slice(0,7)); parse the parts
  // explicitly so the values are typed `number` without a non-null assertion.
  let yy = Number(month.slice(0, 4));
  let mm = Number(month.slice(5, 7)) + delta;
  while (mm < 1) {
    mm += 12;
    yy -= 1;
  }
  while (mm > 12) {
    mm -= 12;
    yy += 1;
  }
  return `${yy}-${String(mm).padStart(2, "0")}`;
}
</script>

<template>
  <section class="month-calendar block" data-test="month-calendar">
    <TallyHeader
      v-model:mode="mode"
      :month="currentMonth"
      :tally="tally"
      :intake-summary="intakeSummary"
      @prev="prev"
      @next="next"
    />
    <CalendarGrid
      v-if="mode === 'workouts' && entry.status === 'ready'"
      :month="currentMonth"
      :past-sessions="entry.data.past_sessions"
      :pill-segments="entry.data.pill_segments"
      :untracked-bands="entry.data.untracked_bands"
      :today="today"
      :selected-date="selectedDate"
      @select="(d) => emit('select', d)"
    />
    <IntakeCalendarGrid
      v-else-if="mode === 'intake' && intakeEntry.status === 'ready'"
      :month="currentMonth"
      :today="today"
      :days="intakeEntry.data.days"
      :selected-date="selectedDate"
      @select="(d) => emit('select', d)"
    >
      <template #actions>
        <button
          type="button"
          class="mark-time-off"
          data-test="open-time-off"
          @click="showTimeOff = true"
        >
          Mark vacation
        </button>
      </template>
    </IntakeCalendarGrid>
    <p v-else-if="activeEntry.status === 'loading'" class="cal-loading" data-test="cal-loading">
      Loading calendar…
    </p>
    <p v-else-if="activeEntry.status === 'error'" class="cal-error" data-test="cal-error">
      Couldn't load calendar.
    </p>
    <!-- Workouts mode (and the intake loading/error states) have no legend row
         to host the button inline, so it gets its own right-aligned row where
         the legend would be. The intake-ready branch above renders the button
         inside the grid's legend instead, so exactly one instance shows. -->
    <div v-if="!(mode === 'intake' && intakeEntry.status === 'ready')" class="mark-time-off-row">
      <button
        type="button"
        class="mark-time-off"
        data-test="open-time-off"
        @click="showTimeOff = true"
      >
        Mark vacation
      </button>
    </div>
    <TimeOffModal
      v-if="showTimeOff"
      :client="client"
      :month="currentMonth"
      :today="today"
      @changed="onTimeOffChanged"
      @close="showTimeOff = false"
    />
  </section>
</template>

<style scoped>
.month-calendar.block {
  /* Matches the other right-pane blocks (SleepBlock, RemainingToday, etc.).
     Repeating the values here rather than importing a shared mixin keeps the
     scoped style self-contained and avoids a new global utility class. */
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.cal-loading {
  margin: 4px 0 0;
  color: var(--ink-faint, #6b7180);
  font-style: italic;
  font-size: 12px;
}
.cal-error {
  margin: 4px 0 0;
  color: #e6b450;
  font-style: italic;
  font-size: 12px;
}
.mark-time-off {
  background: transparent;
  border: 1px solid var(--line, #262a36);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.mark-time-off:hover {
  color: var(--ink, #e6e8ee);
  border-color: var(--line-2, #353a4a);
}
/* Mirror IntakeCalendarGrid's .legend-row so the button sits on the same
   divider line in both modes — Workouts has no swatches, so it's an empty
   legend line with just the right-aligned button. Keep the border/spacing
   values in sync with .legend-row there. */
.mark-time-off-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px solid var(--line, #262a36);
  margin-top: 10px;
  padding-top: 8px;
}
</style>
