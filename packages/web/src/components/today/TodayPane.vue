<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import type { ApiError } from "../../api/errors.js";
import { useWelcomeDismissed } from "../../composables/useWelcomeDismissed.js";
import { currentUserDate } from "../../lib/user-day.js";
import { useAuthStore } from "../../stores/auth.js";
import { useBodyWeightsRangeStore } from "../../stores/body-weights-range.js";
import { useMacrosRangeStore } from "../../stores/macros-range.js";
import { useMealsStore } from "../../stores/meals.js";
import { useSleepLogsRangeStore } from "../../stores/sleep-logs-range.js";
import { useTodayStore } from "../../stores/today.js";
import MonthCalendar from "../calendar/MonthCalendar.vue";
import MacrosWeekGrid from "./MacrosWeekGrid.vue";
import MealsList from "./MealsList.vue";
import MovementBlock from "./MovementBlock.vue";
import NoUserPlaceholder from "./NoUserPlaceholder.vue";
import OnboardingCard from "./OnboardingCard.vue";
import PhaseFormModal from "./PhaseFormModal.vue";
import PhaseHeader from "./PhaseHeader.vue";
import RemainingToday from "./RemainingToday.vue";
import SleepBlock from "./SleepBlock.vue";
import StopPhaseDialog from "./StopPhaseDialog.vue";
import WeightBlock from "./WeightBlock.vue";

const props = defineProps<{
  client: ApiClient;
  windowDates: string[];
  selectedDate: string;
  mealChatEnabled?: boolean;
}>();
const emit = defineEmits<{
  (e: "open-settings"): void;
  (e: "weight-saved"): void;
  (e: "sleep-saved"): void;
  (e: "cardio-changed"): void;
  (e: "meals-changed"): void;
  (e: "phase-changed"): void;
  (e: "select-date", date: string): void;
  (e: "log-with-ai"): void;
}>();

const todayStore = useTodayStore();
const authStore = useAuthStore();
const { data: todayData, status: todayStatus, error: todayError } = storeToRefs(todayStore);
const { data: macrosData } = storeToRefs(useMacrosRangeStore());
const { data: weightsData } = storeToRefs(useBodyWeightsRangeStore());
const { data: sleepData } = storeToRefs(useSleepLogsRangeStore());
const { data: mealsData } = storeToRefs(useMealsStore());

// The phase-card element, exposed for App.vue's useElementVisibility: the
// mobile sticky header appears once this card scrolls off the top. A template
// ref on the wrapper div binds on mount — no querySelector race.
const phaseCardEl = ref<HTMLElement | null>(null);
defineExpose({ phaseCardEl });

const isNoUser = computed(() => {
  const err = todayError.value as ApiError | null;
  return err?.kind === "http" && err.status === 404;
});

// The full-page welcome splash (connect your MCP server) shows only for an
// un-set-up account that hasn't dismissed it. Once dismissed (localStorage),
// the user lands on the dashboard — where the phase-onboarding card guides
// them to start a phase manually — and can connect MCP later from Settings.
const { dismissed: welcomeDismissed, dismiss: dismissWelcome } = useWelcomeDismissed();
const needsOnboarding = computed(() => {
  if (!todayData.value) return false;
  if (welcomeDismissed.value) return false;
  return authStore.tokens.length === 0 && !todayData.value.profile_complete;
});

// The REAL today, for the calendar's "which cells are clickable" / today
// highlight. Must derive from the live clock, NOT todayData.now: once a past
// day loads via ?date=, `now` is that selected day's mid-day timestamp, so
// deriving from it would mark every day after the selected one un-clickable
// (you could step back but never forward). Mirrors App.vue's `realToday`.
const todayDate = computed(() => {
  if (!todayData.value) return null;
  return currentUserDate(new Date(), todayData.value.user.timezone);
});

// True when the dashboard is showing a PAST day via calendar traversal — drives
// the date-aware block labels (sleep/movement/meals). Defaults to false until
// `todayDate` is known, so labels read as "today" rather than lying.
const isPastDay = computed(
  () => !!todayDate.value && props.selectedDate !== "" && props.selectedDate !== todayDate.value,
);

// --- Phase create / edit / stop ---------------------------------------------
const showPhaseForm = ref(false);
const phaseFormMode = ref<"create" | "edit">("create");
const showStopDialog = ref(false);

function openPhaseCreate(): void {
  phaseFormMode.value = "create";
  showPhaseForm.value = true;
}
function openPhaseEdit(): void {
  phaseFormMode.value = "edit";
  showPhaseForm.value = true;
}
function onPhaseSaved(): void {
  showPhaseForm.value = false;
  emit("phase-changed");
}
function onPhaseStopped(): void {
  showStopDialog.value = false;
  emit("phase-changed");
}
function onRequestCreateFromCurrent(): void {
  // edit-mode "start a new phase instead" → reopen in create mode.
  phaseFormMode.value = "create";
  showPhaseForm.value = true;
}
</script>

<template>
  <NoUserPlaceholder v-if="isNoUser" />
  <OnboardingCard
    v-else-if="todayStatus === 'ready' && needsOnboarding"
    @open-settings="emit('open-settings')"
    @dismiss="dismissWelcome"
  />
  <div
    v-else-if="todayStatus === 'ready' && todayData"
    class="today-pane"
    data-test="today-pane"
  >
    <div ref="phaseCardEl">
      <PhaseHeader
        :phase="todayData.phase"
        :today="todayData.today"
        :tdee="todayData.tdee"
        :phase-adherence="todayData.phase_adherence"
        :profile-complete="todayData.profile_complete"
        @create="openPhaseCreate"
        @edit="openPhaseEdit"
        @stop="showStopDialog = true"
      />
    </div>
    <RemainingToday :today="todayData.today" />
    <MealsList
      :meals="mealsData ?? []"
      :client="client"
      :real-today="todayDate ?? selectedDate"
      :date="selectedDate"
      :is-past-day="isPastDay"
      :meal-chat-enabled="mealChatEnabled"
      @changed="emit('meals-changed')"
      @log-with-ai="emit('log-with-ai')"
    />
    <MovementBlock
      :cardio="todayData.today.cardio"
      :steps="todayData.today.steps"
      :client="client"
      :date="selectedDate"
      :is-past-day="isPastDay"
      @changed="emit('cardio-changed')"
    />
    <MacrosWeekGrid :days="macrosData?.days ?? []" />
    <WeightBlock
      :today-body="todayData.today"
      :trend="todayData.trend_weight"
      :series="weightsData ?? []"
      :unit-system="todayData.user.preferred_unit_system"
      :client="client"
      :timezone="todayData.user.timezone"
      :date="selectedDate"
      @saved="emit('weight-saved')"
    />
    <SleepBlock
      :sleep-debt="todayData.week_to_date.sleep_debt"
      :nights="sleepData ?? []"
      :window-dates="windowDates"
      :client="client"
      :date="selectedDate"
      :is-past-day="isPastDay"
      @saved="emit('sleep-saved')"
    />
    <MonthCalendar
      v-if="todayDate"
      :client="client"
      :today="todayDate"
      :selected-date="selectedDate"
      @select="(d) => emit('select-date', d)"
    />
    <PhaseFormModal
      v-if="showPhaseForm && todayData"
      :client="client"
      :mode="phaseFormMode"
      :phase="todayData.phase"
      :has-weight="todayData.profile_complete"
      :tdee-basis="todayData.tdee?.basis ?? 'profile_baseline'"
      :logged-days="todayData.phase_adherence?.logged_days ?? 0"
      :weight-unit="todayData.user.preferred_unit_system"
      @saved="onPhaseSaved"
      @close="showPhaseForm = false"
      @request-create-from-current="onRequestCreateFromCurrent"
    />
    <StopPhaseDialog
      v-if="showStopDialog && todayData?.phase"
      :client="client"
      :phase="{ id: todayData.phase.id, started_on: todayData.phase.started_on }"
      :today="todayDate ?? selectedDate"
      @stopped="onPhaseStopped"
      @close="showStopDialog = false"
    />
  </div>
  <p
    v-else-if="todayStatus === 'error'"
    class="today-error"
    data-test="today-error"
  >
    Couldn't load today's snapshot.
  </p>
  <p v-else class="today-loading" data-test="today-loading">
    Loading today's snapshot…
  </p>
</template>

<style scoped>
.today-pane {
  display: flex;
  flex-direction: column;
}
.today-loading {
  color: var(--ink-faint, #6b7180);
  font-style: italic;
  padding: 12px 14px;
}
.today-error {
  color: #e6b450;
  font-style: italic;
  padding: 12px 14px;
}
</style>
