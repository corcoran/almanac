<script setup lang="ts">
import { addDaysIso } from "@almanac/core/types";
import { useElementVisibility } from "@vueuse/core";
import { storeToRefs } from "pinia";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ApiClient } from "./api/client.js";
import AchievementHistory from "./components/achievements/AchievementHistory.vue";
import InsightsChatPanel from "./components/insights/InsightsChatPanel.vue";
import MealChatPanel from "./components/meal-chat/MealChatPanel.vue";
import OfflineBanner from "./components/OfflineBanner.vue";
import SettingsPanel from "./components/settings/SettingsPanel.vue";
import UserMenu from "./components/settings/UserMenu.vue";
import PastDayBanner from "./components/today/PastDayBanner.vue";
import TodayPane from "./components/today/TodayPane.vue";
import WorkoutPane from "./components/workout/WorkoutPane.vue";
import { type PanelName, useActivePanel } from "./composables/useActivePanel.js";
import { useIsMobile } from "./composables/useIsMobile.js";
import { useLastSeenVersion } from "./composables/useLastSeenVersion.js";
import { useWelcomeDismissed } from "./composables/useWelcomeDismissed.js";
import { reloadForViewedDate } from "./lib/reload-for-date.js";
import { reloadNudge } from "./lib/reload-nudge.js";
import type { UnitSystem } from "./lib/units.js";
import { currentUserDate, daysAgoUserDate, daysAhead } from "./lib/user-day.js";
import { useAuthStore } from "./stores/auth.js";
import { useBodyWeightsRangeStore } from "./stores/body-weights-range.js";
import { useExerciseGroupsStore } from "./stores/exercise-groups.js";
import { useExercisesStore } from "./stores/exercises.js";
import { useMacrosRangeStore } from "./stores/macros-range.js";
import { useMealsStore } from "./stores/meals.js";
import { useNextBestActionStore } from "./stores/nextBestAction.js";
import { useRecentWorkoutsStore } from "./stores/recent-workouts.js";
import { useSleepLogsRangeStore } from "./stores/sleep-logs-range.js";
import { useStoredMealsStore } from "./stores/stored-meals.js";
import { useTemplatesStore } from "./stores/templates.js";
import { useTodayStore } from "./stores/today.js";
import { useWinsStore } from "./stores/wins.js";
import { useWorkoutStore } from "./stores/workout.js";

// Dev-time base URL is /api — the Vite proxy (vite.config.ts) rewrites to
// http://127.0.0.1:3001. Production builds will need a different baseUrl,
// but that's out of scope for Stage 1.
const client = new ApiClient({ baseUrl: "/api" });

const todayStore = useTodayStore();
const templatesStore = useTemplatesStore();
const recentStore = useRecentWorkoutsStore();
const exercisesStore = useExercisesStore();
const exerciseGroupsStore = useExerciseGroupsStore();
const macrosStore = useMacrosRangeStore();
const weightsStore = useBodyWeightsRangeStore();
const sleepLogsStore = useSleepLogsRangeStore();
const mealsStore = useMealsStore();
const storedMealsStore = useStoredMealsStore();
const nextBestActionStore = useNextBestActionStore();
const winsStore = useWinsStore();
const workoutStore = useWorkoutStore();
const authStore = useAuthStore();

const { isMobile } = useIsMobile();

const panesRef = ref<HTMLElement | null>(null);
const dashboardRef = ref<HTMLElement | null>(null);
const workoutRef = ref<HTMLElement | null>(null);

const {
  activePanel,
  setup: setupPanelObserver,
  scrollToPanel,
} = useActivePanel(panesRef, { dashboard: dashboardRef, workout: workoutRef }, isMobile);

// Ref to the dashboard TodayPane; it exposes `phaseCardEl`, the phase-card
// element. The mobile sticky header appears once that card scrolls off the top.
const dashboardPaneRef = ref<{ phaseCardEl: HTMLElement | null } | null>(null);
const phaseCardEl = computed(() => dashboardPaneRef.value?.phaseCardEl ?? null);
const phaseCardVisible = useElementVisibility(phaseCardEl);
// Header shows when we're mobile, have data, the card exists, and it has
// scrolled out of view (not visible). `phaseCardEl` guards against the brief
// pre-mount window where visibility is falsy because the element is null.
const showMobileStickyHeader = computed(
  () => isMobile.value && !!todayStore.data && !!phaseCardEl.value && !phaseCardVisible.value,
);

// Settings panel visibility — purely client-side, no router. UserMenu emits
// `open-settings`, SettingsPanel emits `close`; both toggle this ref.
const showSettings = ref(false);
const { lastSeen, unseenCount, markAllSeen } = useLastSeenVersion();

// The last-seen version SNAPSHOTTED at the moment Settings opened. We pass this
// (not the live `lastSeen`) to the What's-new panel so it can highlight the
// releases that were unseen on this visit — `markAllSeen()` below immediately
// advances `lastSeen` to the latest, which would otherwise leave nothing
// accented. Null until first open, and stays null on a true first visit.
const settingsLastSeen = ref<string | null>(null);

// Opening Settings is the "seen" signal — the badge's job (nudge you to look)
// is done once you're in the panel where What's new lives. Snapshot BEFORE
// clearing so the panel still shows what changed since the prior visit.
function openSettings() {
  settingsLastSeen.value = lastSeen.value;
  showSettings.value = true;
  markAllSeen();
}
const showHistory = ref(false);
const showMealChat = ref(false);
const showInsights = ref(false);
const { me: authMe } = storeToRefs(authStore);

// Synchronous hydrate from localStorage. Must run before the template renders
// so WorkoutPane's `hasActiveSession` toggle resolves correctly on first paint;
// the parallel store loads in onMounted come after. Spec §4.4.
workoutStore.hydrate();
const { status: todayStatus } = storeToRefs(todayStore);
const { status: templatesStatus } = storeToRefs(templatesStore);
const { status: recentStatus } = storeToRefs(recentStore);
const { status: exercisesStatus } = storeToRefs(exercisesStore);
const { status: exerciseGroupsStatus } = storeToRefs(exerciseGroupsStore);
const { status: macrosStatus } = storeToRefs(macrosStore);
const { status: weightsStatus } = storeToRefs(weightsStore);
const { status: sleepLogsStatus } = storeToRefs(sleepLogsStore);
const { status: mealsStatus } = storeToRefs(mealsStore);

// Onboarding: no tokens and profile incomplete → full-width welcome card,
// hide the empty workout pane. Suppressed once the user dismisses the welcome
// splash (localStorage) — they then get the normal dashboard + phase card.
const { dismissed: welcomeDismissed } = useWelcomeDismissed();
const needsOnboarding = computed(() => {
  if (!todayStore.data) return false;
  if (welcomeDismissed.value) return false;
  return authStore.tokens.length === 0 && !todayStore.data.profile_complete;
});

// User's display unit, for surfaces (e.g. AchievementHistory) that render raw
// kg values. Defaults to metric until the profile loads.
const unitSystem = computed<UnitSystem>(
  () => todayStore.data?.user.preferred_unit_system ?? "metric",
);

// LLM meal-chat needs BOTH halves of the server gate: the per-user flag
// (llm_logging_enabled) AND server-side availability (llm_available — master
// switch on + API key configured). Hide the entry entirely unless both hold,
// rather than show a button that 403s (e.g. when the admin set no API key).
const mealChatEnabled = computed(
  () => (authMe.value?.llm_logging_enabled ?? 0) === 1 && authMe.value?.llm_available === true,
);

const showOffline = computed(
  () =>
    todayStatus.value === "error" ||
    templatesStatus.value === "error" ||
    recentStatus.value === "error" ||
    exercisesStatus.value === "error" ||
    exerciseGroupsStatus.value === "error" ||
    macrosStatus.value === "error" ||
    weightsStatus.value === "error" ||
    sleepLogsStatus.value === "error" ||
    mealsStatus.value === "error",
);

onMounted(() => {
  // Boot sequence per spec §4.3: fire reads in parallel. The three range
  // stores (macros / weights / sleep-logs) need `user.timezone` to compute
  // their date windows, so they chain off todayStore.load completing —
  // everything else stays parallel.
  void templatesStore.load(client);
  void storedMealsStore.load(client);
  void recentStore.load(client);
  void exercisesStore.load(client);
  void exerciseGroupsStore.load(client);
  void nextBestActionStore.load(client);
  void winsStore.load(client);
  // whoami + tokens populate the UserMenu chip and the onboarding check.
  // Independent of the rest of the boot fan-out.
  void authStore.loadWhoami(client);
  void authStore.loadTokens(client);
  void todayStore.load(client).then(() => {
    const tz = todayStore.data?.user.timezone ?? "UTC";
    const now = new Date();
    const today = currentUserDate(now, tz);
    selectedDate.value = today;
    const tomorrow = daysAhead(now, 1, tz);
    const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
    const fourteenDaysAgo = daysAgoUserDate(now, 13, tz);
    // Macros repo uses inclusive `to_date` — pass today.
    void macrosStore.load(client, sevenDaysAgo, today);
    // Sleep + body-weight repos treat `to` as EXCLUSIVE (slept_on /
    // measured_on < to), so we pad with tomorrow's user-date to include
    // today's just-logged entry in the histogram / sparkline.
    void sleepLogsStore.load(client, sevenDaysAgo, tomorrow);
    sleepWindowDates.value = Array.from({ length: 7 }, (_, i) => daysAgoUserDate(now, 6 - i, tz));
    void weightsStore.load(client, fourteenDaysAgo, tomorrow);
    // Today's meals — the `/v1/meals` route uses TimestampRangeQuery which
    // resolves `from_date=X&to_date=X` to a single user-day window
    // (inclusive lower / exclusive upper bound of the day in the user's
    // tz). Today as both endpoints selects just today's logs.
    void mealsStore.load(client, today, today);
  });
  setupPanelObserver();
});

// Stale-state check on resume (§4.4). If hydrate() restored an in-progress
// workout AND the API's most-recent workout has the same started_at, the
// session was already submitted from another tab/device — clear local state
// with a notice so the user doesn't re-submit. Same client writes both
// strings, so exact ISO match is sufficient.
const staleNotice = ref<string | null>(null);
const sleepWindowDates = ref<string[]>([]);

// The calendar day the user is currently viewing. Defaults to the real
// today (derived from the today store's `now` + timezone); updated when
// the user clicks a day on the MonthCalendar or steps via the banner.
const selectedDate = ref<string>("");
// The REAL today — must NOT derive from `todayStore.data.now`, because once a
// past day is loaded via ?date=, that `now` is the selected day's mid-day
// timestamp (so realToday would wrongly equal selectedDate and hide the
// banner). Derive from the live clock + the user's timezone instead.
const realToday = computed(() =>
  todayStore.data ? currentUserDate(new Date(), todayStore.data.user.timezone) : "",
);
const isPastDay = computed(
  () =>
    selectedDate.value !== "" && realToday.value !== "" && selectedDate.value !== realToday.value,
);

function onSelectDate(date: string): void {
  selectedDate.value = date;
}
function onPrevDay(): void {
  if (selectedDate.value !== "") selectedDate.value = addDaysIso(selectedDate.value, -1);
}
function onNextDay(): void {
  if (selectedDate.value !== "" && selectedDate.value < realToday.value) {
    selectedDate.value = addDaysIso(selectedDate.value, 1);
  }
}
function onGoToday(): void {
  selectedDate.value = realToday.value;
}

watch(selectedDate, (d, prev) => {
  // Skip the empty initial value and the boot-time "" → today assignment
  // (the boot already loaded today via todayStore.load). Any real navigation
  // (prev is a non-empty date) reloads for the viewed day.
  if (d === "" || prev === "" || prev === undefined) return;
  // Reload BOTH the today payload and the meals window for the viewed day.
  // The meals store is otherwise only loaded once at boot (pinned to today),
  // so without this the meals list goes stale when switching days while the
  // rest of the dashboard updates. See reloadForViewedDate.
  void reloadForViewedDate({ todayStore, mealsStore }, client, d, realToday.value);
});

watch(
  () => recentStore.status,
  (status) => {
    if (status !== "ready") return;
    const active = workoutStore.active;
    const recent = recentStore.data;
    if (!active || !recent) return;
    if (active.started_at === recent.started_at) {
      workoutStore.cancelSession();
      staleNotice.value = "Your in-progress workout was already submitted from another device.";
    }
  },
);

const mobileWorkoutProgress = computed(() => {
  const active = workoutStore.active;
  if (!active) return "";
  const done = active.exercises.filter((ex) => ex.sets.some((s) => s.done)).length;
  return `${done}/${active.exercises.length} done`;
});

const mobileWorkoutStarted = computed(() => {
  const active = workoutStore.active;
  if (!active) return "";
  const d = new Date(active.started_at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});

const mobileRemainingKcal = computed(() => {
  const today = todayStore.data?.today;
  if (!today?.target) return null;
  return Math.round(today.target.kcal - today.intake.kcal);
});

const mobileRemainingP = computed(() => {
  const today = todayStore.data?.today;
  if (!today?.target) return "—";
  return Math.round(today.target.protein_g - today.intake.protein_g);
});

const mobileRemainingC = computed(() => {
  const today = todayStore.data?.today;
  if (!today?.target) return "—";
  return Math.round(today.target.carb_g - today.intake.carb_g);
});

const mobileRemainingF = computed(() => {
  const today = todayStore.data?.today;
  if (!today?.target) return "—";
  return Math.round(today.target.fat_g - today.intake.fat_g);
});

async function onWeightSaved(): Promise<void> {
  const tz = todayStore.data?.user.timezone ?? "UTC";
  const now = new Date();
  const today = currentUserDate(now, tz);
  const tomorrow = daysAhead(now, 1, tz);
  const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
  const fourteenDaysAgo = daysAgoUserDate(now, 13, tz);
  await Promise.all([
    todayStore.reload(client, isPastDay.value ? selectedDate.value : undefined),
    weightsStore.reload(client, fourteenDaysAgo, tomorrow),
    // A weight change shifts measured TDEE, which moves the week grid's NET row
    // for the affected days — refresh the macros range so that row stays live.
    macrosStore.reload(client, sevenDaysAgo, today),
    // Logging weight resolves the stale_weight_log nudge — refresh next steps.
    reloadNudge(nextBestActionStore, client),
  ]);
}

async function onSleepSaved(): Promise<void> {
  const tz = todayStore.data?.user.timezone ?? "UTC";
  const now = new Date();
  const tomorrow = daysAhead(now, 1, tz);
  const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
  await Promise.all([
    todayStore.reload(client, isPastDay.value ? selectedDate.value : undefined),
    sleepLogsStore.reload(client, sevenDaysAgo, tomorrow),
    // Logging sleep resolves the stale_sleep_log / log_yesterday_sleep nudge —
    // refresh next steps.
    reloadNudge(nextBestActionStore, client),
  ]);
}

async function onMealsChanged(): Promise<void> {
  const tz = todayStore.data?.user.timezone ?? "UTC";
  const now = new Date();
  const today = currentUserDate(now, tz);
  const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
  await Promise.all([
    // Reloads the today payload (intake/targets) AND the viewed-day meals window
    // — the meals store is otherwise pinned to today, so editing a past day's
    // meal would leave the list stale. See reloadForViewedDate.
    reloadForViewedDate({ todayStore, mealsStore }, client, selectedDate.value, realToday.value),
    // A meal change shifts the week grid's intake + NET rows for the affected
    // day — refresh the macros range so those rows stay live.
    macrosStore.reload(client, sevenDaysAgo, today),
    // Logging a meal can resolve the low_intake_today nudge — refresh next steps.
    reloadNudge(nextBestActionStore, client),
  ]);
}

async function onPhaseChanged(): Promise<void> {
  const tz = todayStore.data?.user.timezone ?? "UTC";
  const now = new Date();
  const today = currentUserDate(now, tz);
  const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
  await Promise.all([
    todayStore.reload(client, isPastDay.value ? selectedDate.value : undefined),
    // A phase change shifts the week-grid targets — refresh the macros range so
    // those rows stay live.
    macrosStore.reload(client, sevenDaysAgo, today),
    // Starting a phase resolves the start_nutrition_phase onboarding nudge —
    // refresh next steps.
    reloadNudge(nextBestActionStore, client),
  ]);
}

async function onCardioChanged(): Promise<void> {
  const tz = todayStore.data?.user.timezone ?? "UTC";
  const now = new Date();
  const today = currentUserDate(now, tz);
  const sevenDaysAgo = daysAgoUserDate(now, 6, tz);
  await Promise.all([
    todayStore.reload(client, isPastDay.value ? selectedDate.value : undefined),
    // The week grid's CARDIO + NET rows for today come from the macros range
    // store, not the today payload — refresh it so they're not left stale.
    macrosStore.reload(client, sevenDaysAgo, today),
    // MovementBlock also covers steps; logging steps can resolve the
    // unlogged_steps / log_yesterday_steps nudge — refresh next steps.
    reloadNudge(nextBestActionStore, client),
  ]);
}

watch(
  () => workoutStore.hasActiveSession,
  (hasSession) => {
    if (hasSession && isMobile.value) {
      nextTick(() => scrollToPanel("workout"));
    }
  },
);
</script>

<template>
  <div class="app">
    <OfflineBanner :show="showOffline" />
    <div v-if="staleNotice" class="stale-notice" role="status">
      <span>{{ staleNotice }}</span>
      <button
        type="button"
        class="stale-dismiss"
        aria-label="Dismiss notice"
        @click="staleNotice = null"
      >
        ×
      </button>
    </div>
    <div class="top-bar">
      <template v-if="isMobile && activePanel === 'workout' && workoutStore.hasActiveSession">
        <div class="mobile-header">
          <span class="mobile-title">{{ workoutStore.active?.template_baseline.template_name }}</span>
          <span class="mobile-meta">{{ mobileWorkoutProgress }} · started {{ mobileWorkoutStarted }}</span>
        </div>
      </template>
      <template v-else-if="showMobileStickyHeader">
        <div class="mobile-header">
          <div class="mobile-title-row">
            <span class="mobile-title">{{ todayStore.data?.phase ? `${todayStore.data.phase.phase_type ?? todayStore.data.phase.intent} day ${todayStore.data.phase.days_in}` : 'Almanac' }}</span>
          </div>
          <div class="mobile-meta">
            <span v-if="todayStore.data?.phase" class="mobile-macros">
              <span class="mm protein">{{ mobileRemainingP }}p</span>
              <span class="mm carb">{{ mobileRemainingC }}c</span>
              <span class="mm fat">{{ mobileRemainingF }}f</span>
              <span class="mm sep">·</span>
              <span>TDEE {{ todayStore.data.phase.tdee_at_phase_start ?? '—' }}</span>
            </span>
          </div>
        </div>
        <span v-if="mobileRemainingKcal !== null" class="mobile-remaining">{{ mobileRemainingKcal }}<span class="mobile-remaining-unit">kcal left</span></span>
      </template>
      <button
        type="button"
        class="trophy-btn"
        data-test="open-history"
        aria-label="Achievements"
        @click="showHistory = true"
      >
        🏆
      </button>
      <button
        v-if="mealChatEnabled"
        type="button"
        class="trophy-btn"
        data-test="open-insights"
        aria-label="AI insights"
        @click="showInsights = true"
      >
        💬
      </button>
      <UserMenu :me="authMe" :has-unseen="unseenCount > 0" @open-settings="openSettings" />
    </div>
    <div v-if="isPastDay" class="past-day-banner-wrap">
      <PastDayBanner
        :selected-date="selectedDate"
        :today="realToday"
        @prev="onPrevDay"
        @next="onNextDay"
        @go-today="onGoToday"
      />
    </div>
    <div v-if="needsOnboarding" class="onboarding-full" :class="{ 'has-banner': isPastDay }">
      <TodayPane :client="client" :window-dates="sleepWindowDates" :selected-date="selectedDate" :meal-chat-enabled="mealChatEnabled" @open-settings="openSettings" @weight-saved="onWeightSaved" @sleep-saved="onSleepSaved" @cardio-changed="onCardioChanged" @meals-changed="onMealsChanged" @phase-changed="onPhaseChanged" @select-date="onSelectDate" @log-with-ai="showMealChat = true" />
    </div>
    <div v-else ref="panesRef" class="panes" :class="{ 'has-banner': isPastDay }">
      <section ref="dashboardRef" class="panel panel-dashboard">
        <TodayPane ref="dashboardPaneRef" :client="client" :window-dates="sleepWindowDates" :selected-date="selectedDate" :meal-chat-enabled="mealChatEnabled" @open-settings="openSettings" @weight-saved="onWeightSaved" @sleep-saved="onSleepSaved" @cardio-changed="onCardioChanged" @meals-changed="onMealsChanged" @phase-changed="onPhaseChanged" @select-date="onSelectDate" @log-with-ai="showMealChat = true" />
      </section>
      <section ref="workoutRef" class="panel panel-workout">
        <WorkoutPane :client="client" />
      </section>
    </div>
    <div v-if="isMobile && !needsOnboarding" class="dot-indicators">
      <button
        :class="['dot', { active: activePanel === 'dashboard' }]"
        aria-label="Dashboard"
        @click="scrollToPanel('dashboard')"
      />
      <button
        :class="['dot', { active: activePanel === 'workout' }]"
        aria-label="Workout"
        @click="scrollToPanel('workout')"
      />
    </div>
    <SettingsPanel
      v-if="showSettings"
      :client="client"
      :tdee-basis="todayStore.data?.tdee?.basis ?? null"
      :last-seen="settingsLastSeen"
      @close="showSettings = false"
    />
    <AchievementHistory
      v-if="showHistory"
      :client="client"
      :unit-system="unitSystem"
      @close="showHistory = false"
    />
    <MealChatPanel
      v-if="showMealChat"
      :client="client"
      :viewed-date="selectedDate"
      :real-today="realToday"
      @close="showMealChat = false"
      @logged="onMealsChanged"
    />
    <InsightsChatPanel
      v-if="showInsights"
      :client="client"
      :viewed-date="selectedDate"
      :real-today="realToday"
      @close="showInsights = false"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  max-width: 100vw;
  overflow-x: hidden;
}
.top-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line-1, #262a36);
}
@media (max-width: 768px) {
  /* The document (window) is the scroller on mobile, not an inner container,
     so `position: sticky` doesn't engage — the bar scrolls off the top. Use
     `position: fixed` to pin it to the viewport, and offset the content below
     by the bar's resting height so nothing hides under it. */
  .top-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 40;
    background: var(--bg, #0f1115);
  }
  .panes,
  .onboarding-full {
    padding-top: 49px; /* resting .top-bar height (8+8 padding + 32 button + 1 border) */
  }
  /* When the past-day banner is shown it sits first (it carries the 49px
     clearance below), so the panes/onboarding must NOT add a second 49px —
     that double offset left a ~50px band of dead space under the banner. */
  .panes.has-banner,
  .onboarding-full.has-banner {
    padding-top: 0;
  }
  .past-day-banner-wrap {
    padding-top: 49px; /* clear the fixed .top-bar (8+8 padding + 32 button + 1 border) */
  }
}
.trophy-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--line-1, #262a36);
  background: var(--surface-1, #161c18);
  color: #6ee7a8;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-right: 8px;
}
.trophy-btn:hover {
  filter: brightness(1.15);
}
.onboarding-full {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 60px;
}
.panes {
  display: grid;
  grid-template-columns: minmax(440px, 1.2fr) minmax(400px, 1fr);
  flex: 1;
}
.panel-dashboard {
  border-right: 1px solid #262a36;
}
@media (max-width: 768px) {
  .panes {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    grid-template-columns: none;
  }
  .panes::-webkit-scrollbar {
    display: none;
  }
  .panel-dashboard {
    border-right: none;
  }
  .panes > .panel {
    scroll-snap-align: start;
    flex: 0 0 100%;
    width: 100%;
    min-width: 0;
    overflow-y: auto;
    overflow-x: hidden;
    box-sizing: border-box;
  }
}
.dot-indicators {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 50;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: #444;
  cursor: pointer;
  padding: 0;
  transition: background 0.2s;
}
.dot.active {
  background: var(--good, #4cc38a);
}
.mobile-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.mobile-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.mobile-title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ink, #e6e8ee);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.mobile-remaining {
  /* Direct child of .top-bar (a sibling of .mobile-header), so the bar's
     `align-items: center` centers it against the FULL bar height — not the top
     row of the two-row header block. .mobile-header's `flex: 1` pushes it here. */
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--m-kcal);
  white-space: nowrap;
  flex-shrink: 0;
}
.mobile-remaining-unit {
  font-size: 10px;
  font-weight: 500;
  color: var(--ink-faint, #9aa0ad);
  margin-left: 3px;
}
.mobile-meta {
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
}
.mobile-macros {
  font-variant-numeric: tabular-nums;
  display: flex;
  gap: 6px;
}
.mm.protein { color: var(--m-protein); font-weight: 600; }
.mm.carb { color: var(--m-carb); font-weight: 600; }
.mm.fat { color: var(--m-fat); font-weight: 600; }
.mm.sep { color: var(--ink-faint, #6b7180); font-weight: 400; }
/* Same warn palette as OfflineBanner — both surface boot-time anomalies. */
.stale-notice {
  background: #3a2a14;
  color: #e6b450;
  padding: 6px 14px;
  font-size: 12px;
  border-bottom: 1px solid #4a3818;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.stale-dismiss {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.stale-dismiss:hover {
  color: #fff;
}
</style>
