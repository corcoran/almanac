<script setup lang="ts">
import { ExerciseResponseSchema } from "@almanac/core/schemas";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { isApiError } from "../../api/errors.js";
import { useIsMobile } from "../../composables/useIsMobile.js";
import { computeDivergences, type Divergence } from "../../lib/divergence-diff.js";
import type { UnitSystem } from "../../lib/units.js";
import { currentUserDate, daysAgoUserDate } from "../../lib/user-day.js";
import { useCalendarStore } from "../../stores/calendar.js";
import { useExerciseGroupsStore } from "../../stores/exercise-groups.js";
import { useExercisesStore } from "../../stores/exercises.js";
import { useMacrosRangeStore } from "../../stores/macros-range.js";
import { useNextBestActionStore } from "../../stores/nextBestAction.js";
import { useRecentWorkoutsStore } from "../../stores/recent-workouts.js";
import { useTemplateLastSessionsStore } from "../../stores/template-last-sessions.js";
import { useTemplatesStore } from "../../stores/templates.js";
import { useTodayStore } from "../../stores/today.js";
import { useWinsStore } from "../../stores/wins.js";
import { useWorkoutStore } from "../../stores/workout.js";
import AddExerciseButton from "./AddExerciseButton.vue";
import EndSessionDialog from "./EndSessionDialog.vue";
import ExerciseCard from "./ExerciseCard.vue";
import SessionFooter from "./SessionFooter.vue";
import SessionHeader from "./SessionHeader.vue";

type Exercise = z.infer<typeof ExerciseResponseSchema>;

const props = defineProps<{
  client: ApiClient;
}>();

const { isMobile } = useIsMobile();

const workoutStore = useWorkoutStore();
const exercisesStore = useExercisesStore();
const exerciseGroupsStore = useExerciseGroupsStore();
const nextBestActionStore = useNextBestActionStore();
const winsStore = useWinsStore();
const todayStore = useTodayStore();
const recentStore = useRecentWorkoutsStore();
const lastSessionsStore = useTemplateLastSessionsStore();
const templatesStore = useTemplatesStore();
const calendarStore = useCalendarStore();
const macrosStore = useMacrosRangeStore();

const { active } = storeToRefs(workoutStore);
const { exercises: exerciseLibrary } = storeToRefs(exercisesStore);
const { groups } = storeToRefs(exerciseGroupsStore);
const { data: todayData } = storeToRefs(todayStore);

// Fall back to metric when the TodayContext hasn't loaded yet (e.g. offline
// resume from localStorage before the API responds). The stored workout
// weights are canonical kg, so the metric fallback renders them unchanged.
const unitSystem = computed<UnitSystem>(
  () => todayData.value?.user.preferred_unit_system ?? "metric",
);

const dialogDivergences = ref<Divergence[] | null>(null);
const errorBanner = ref<string | null>(null);
const submitting = ref(false);

const pendingTemplatePatch = computed(() => active.value?.pending_template_patch ?? null);

const completedCount = computed(() => {
  if (!active.value) return 0;
  return active.value.exercises.filter((ex) => ex.sets.some((s) => s.done)).length;
});

const totalCount = computed(() => active.value?.exercises.length ?? 0);

/**
 * Primary group = the group with the most exercises in the baseline.
 * Ties resolve to the lowest display_order (so the user gets a stable,
 * predictable pre-filter — push beats pull beats legs if all tied).
 */
const primaryGroupId = computed<number | null>(() => {
  const baseline = active.value?.template_baseline;
  if (!baseline || baseline.exercises.length === 0) return null;
  const counts = new Map<number, number>();
  for (const ex of baseline.exercises) {
    counts.set(ex.group_id, (counts.get(ex.group_id) ?? 0) + 1);
  }
  // Resolve ties using display_order from the groups store.
  const ordered = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]; // higher count wins
    const orderA = groups.value.find((g) => g.id === a[0])?.display_order ?? Infinity;
    const orderB = groups.value.find((g) => g.id === b[0])?.display_order ?? Infinity;
    return orderA - orderB;
  });
  return ordered[0]?.[0] ?? null;
});

function templateItemFor(exerciseId: number) {
  return (
    active.value?.template_baseline.exercises.find((e) => e.exercise_id === exerciseId) ?? null
  );
}

function onTick(client_id: string, set_number: number) {
  // Tick toggles: if already done, untick.
  const ex = active.value?.exercises.find((e) => e.client_id === client_id);
  const set = ex?.sets.find((s) => s.set_number === set_number);
  if (set?.done) workoutStore.untickSet(client_id, set_number);
  else workoutStore.tickSet(client_id, set_number);
}

function onEdit(
  client_id: string,
  set_number: number,
  patch: { reps?: number; weight_kg?: number | null },
) {
  workoutStore.editSet(client_id, set_number, patch);
}

function onAddSet(client_id: string) {
  workoutStore.addSet(client_id);
}

function onSkip(client_id: string) {
  const ex = active.value?.exercises.find((e) => e.client_id === client_id);
  if (ex?.skipped) workoutStore.unskipExercise(client_id);
  else workoutStore.skipExercise(client_id);
}

function onAddExercise(payload: { exercise_id: number; name: string; group_id: number }) {
  workoutStore.addExercise(payload);
}

async function createExercise(input: { name: string; group_id: number }): Promise<Exercise> {
  const created = await props.client.post("/v1/exercises", input, ExerciseResponseSchema);
  // Cache locally so the typeahead picks it up immediately on subsequent
  // opens (the user may add a second exercise in the same session).
  exercisesStore.exercises.push(created);
  return created;
}

function onRpeUpdate(value: number | null) {
  workoutStore.setRpe(value);
}

function onCancel() {
  // Store clears active + localStorage; WorkoutPane reactively flips back
  // to IdleView since hasActiveSession is now false.
  workoutStore.cancelSession();
}

function onEndSession() {
  if (!active.value) return;
  errorBanner.value = null;
  // Always open the end-workout confirmation — even with no template
  // divergences — so the user can review/adjust the duration before
  // submitting. The dialog renders the empty-divergence case as a plain
  // "End workout" form; the "save changes to template?" block only appears
  // when there are divergences to propagate.
  dialogDivergences.value = computeDivergences(
    active.value.exercises,
    active.value.template_baseline,
  );
}

async function onDialogConfirm(
  choice:
    | { saveChoice: "all"; duration_min: number }
    | { saveChoice: "selected"; selected_ids: number[]; duration_min: number }
    | { saveChoice: "none"; duration_min: number },
) {
  dialogDivergences.value = null;
  await runEnd(choice);
}

function onDialogCancel() {
  dialogDivergences.value = null;
}

async function runEnd(
  choice:
    | { saveChoice: "all"; duration_min: number }
    | { saveChoice: "selected"; selected_ids: number[]; duration_min: number }
    | { saveChoice: "none"; duration_min: number },
) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    // Capture the template_id BEFORE endSession — on a "submitted" result the
    // store clears `active`, so we wouldn't be able to invalidate the cached
    // last-session for the right template afterwards.
    const templateId = active.value?.template_id ?? null;
    const result = await workoutStore.endSession(props.client, choice);
    if (result.status === "submitted") {
      errorBanner.value = null;
      if (templateId !== null) {
        // Fire-and-forget refreshes — the user is being navigated back to
        // IdleView, and the "Last session" card + per-template chevron dates
        // update in place when these resolve. We also refresh the templates
        // store so `recommended_template_id` reflects the just-completed
        // session (otherwise IdleView shows yesterday's recommendation).
        // todayStore refreshes too: completing a workout updates
        // activity-adjusted kcal targets and week_to_date.workouts_count, so
        // without this the right pane shows stale data until manual reload.
        // calendarStore refreshes the current month so the freshly-completed
        // session shows up as a past-session chip without a hard reload.
        void recentStore.reload(props.client);
        void lastSessionsStore.reloadForTemplate(
          props.client,
          templateId,
          (id) => exercisesStore.exercises.find((e) => e.id === id)?.name ?? "(unknown)",
        );
        void templatesStore.reload(props.client);
        void todayStore.reload(props.client);
        void nextBestActionStore.reload(props.client);
        void winsStore.reload(props.client);
        const tz = todayData.value?.user.timezone ?? "UTC";
        const now = new Date();
        const currentMonth = currentUserDate(now, tz).slice(0, 7);
        void calendarStore.reloadForMonth(props.client, currentMonth);
        // The 6-day summary / week grid's workout-kcal + NET rows come from the
        // macros-range store, not the today payload — a completed workout adds
        // workout_kcal to today's NET, so refresh the range (7-day window) or
        // those rows stay stale until a manual reload. Mirrors the other
        // write-path handlers in App.vue (weight/meals/cardio).
        const today = currentUserDate(now, tz);
        const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
        void macrosStore.reload(props.client, sevenDaysAgo, today);
      }
      return;
    }
    if (result.status === "workout_failed") {
      errorBanner.value = formatError("Could not submit workout — try again", result.error);
      return;
    }
    if (result.status === "template_failed") {
      errorBanner.value = formatError(
        "Workout saved, but template update failed — retry on next End Session",
        result.error,
      );
      return;
    }
  } finally {
    submitting.value = false;
  }
}

function formatError(prefix: string, error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === "network") return `${prefix} (network error)`;
    if (error.kind === "http") return `${prefix} (HTTP ${error.status})`;
    return `${prefix} (parse error)`;
  }
  return prefix;
}
</script>

<template>
  <div v-if="active" class="active-view">
    <div
      v-if="pendingTemplatePatch"
      class="pending-banner"
      role="status"
      data-test="pending-template-banner"
    >
      Workout saved. Update the template below, or skip to discard the changes.
    </div>

    <SessionHeader
      :template-name="active.template_baseline.template_name"
      :started-at="active.started_at"
      :completed-count="completedCount"
      :total-count="totalCount"
      @cancel="onCancel"
    />

    <div class="exercises">
      <ExerciseCard
        v-for="(ex, i) in active.exercises"
        :key="ex.client_id"
        :exercise="ex"
        :template-item="templateItemFor(ex.exercise_id)"
        :unit-system="unitSystem"
        :index="i"
        :is-mobile="isMobile"
        @tick="onTick"
        @edit="onEdit"
        @add-set="onAddSet"
        @skip="onSkip"
      />
    </div>

    <AddExerciseButton
      :exercises="exerciseLibrary"
      :groups="groups"
      :primary-group-id="primaryGroupId"
      :create-exercise="createExercise"
      @select="onAddExercise"
    />

    <div v-if="errorBanner" class="error-banner" data-test="error-banner">
      {{ errorBanner }}
    </div>

    <SessionFooter
      :rpe="active.rpe"
      :submitting="submitting"
      @update:rpe="onRpeUpdate"
      @end-session="onEndSession"
    />

    <EndSessionDialog
      v-if="dialogDivergences !== null"
      :divergences="dialogDivergences"
      :started-at="active.started_at"
      :unit-system="unitSystem"
      :submitting="submitting"
      @confirm="onDialogConfirm"
      @cancel="onDialogCancel"
    />
  </div>
</template>

<style scoped>
.active-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.exercises {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.error-banner {
  background: var(--bad-soft, #4a1f2a);
  color: var(--bad, #e6738a);
  border: 1px solid var(--bad, #e6738a);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
}
.pending-banner {
  background: #1c3a2e;
  color: #6ee7a8;
  padding: 8px 14px;
  font-size: 12px;
  border-bottom: 1px solid #2a4a3a;
  margin-bottom: 12px;
}
</style>
