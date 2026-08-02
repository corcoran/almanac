<script setup lang="ts">
import {
  AlcoholSessionResponseSchema,
  MealResponseSchema,
  StoredMealResponseSchema,
} from "@almanac/core/schemas";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ApiClient } from "../../api/client.js";
import { useIsMobile } from "../../composables/useIsMobile.js";
import { useVisualViewportHeight } from "../../composables/useVisualViewportHeight.js";
import { useLlmUsageStore } from "../../stores/llm-usage.store.js";
import { useMealChatStore } from "../../stores/meal-chat.store.js";
import ChatThread from "./ChatThread.vue";
import UsageIndicator from "./UsageIndicator.vue";

const props = defineProps<{
  client: ApiClient;
  viewedDate: string;
  realToday: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "logged"): void;
}>();

const store = useMealChatStore();
const usageStore = useLlmUsageStore();
const { isMobile } = useIsMobile();
const {
  height: viewportHeight,
  offsetTop: viewportOffsetTop,
  supported: viewportSupported,
} = useVisualViewportHeight();
// On mobile, pin the OVERLAY itself to the visual viewport (the visible region
// above the soft keyboard) rather than the layout viewport. A `fixed; inset:0`
// overlay spans the full layout height (unaffected by the keyboard), so a panel
// centered in it floats mid-screen with big gaps above/below once the keyboard
// is up. Anchoring top=offsetTop / height=visualViewport.height makes the
// overlay exactly cover what the user can see, so the full-screen panel fills it
// and its bottom input bar sits just above the keyboard. `100dvh` (the CSS
// fallback) is unreliable here — Firefox Android never shrinks it. Desktop and
// browsers without the API fall back to the CSS rules.
const overlayStyle = computed(() =>
  isMobile.value && viewportSupported
    ? {
        top: `${viewportOffsetTop.value}px`,
        height: `${viewportHeight.value}px`,
        // override the centered flex layout so the panel fills from the top
        alignItems: "stretch" as const,
      }
    : undefined,
);
const panelRef = ref<HTMLElement | null>(null);
const chatBodyRef = ref<HTMLElement | null>(null);
const draft = ref("");
// True while a log POST is in flight; guards against concurrent logs and
// feeds ChatThread's `pending` (disables card buttons mid-write).
const logging = ref(false);
// Surfaced to the user if a log POST fails; cleared on the next attempt.
const logError = ref<string | null>(null);
// A turn can run a web search server-side (the slow case), but the request is a
// single blocking call — we can't know mid-request whether it searched, so we
// must NOT claim "searching the web" during the wait (it lied on a slow
// stored-meal match that never searched). Instead: "Thinking…" immediately, then
// a neutral "Still working…" after a short delay so a long wait still gives
// feedback. The accurate "🔍 searched the web" note is shown retroactively (from
// the response's web_search_requests). Reset each send.
const stillWorking = ref(false);
let workingTimer: ReturnType<typeof setTimeout> | undefined;
const STILL_WORKING_DELAY_MS = 2500;

// Keep the newest message + the input visible — especially once the soft
// keyboard shrinks the visual viewport, which otherwise leaves the thread
// scrolled up with the latest turn out of view.
function scrollToBottom(): void {
  const el = chatBodyRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  panelRef.value?.focus();
  void usageStore.refresh(props.client, "meal_chat");
});

onBeforeUnmount(() => {
  if (workingTimer) clearTimeout(workingTimer);
});

// New turns (incl. the user's own message and the assistant reply) → scroll to
// bottom after the DOM updates.
watch(
  () => store.turns.length,
  () => {
    void nextTick(scrollToBottom);
  },
);

// The visual viewport shrinking (keyboard opening) must re-pin the view to the
// bottom so the latest content sits just above the keyboard, not above the fold.
watch(viewportHeight, () => {
  void nextTick(scrollToBottom);
});

function close(): void {
  store.reset();
  emit("close");
}

async function onSend(): Promise<void> {
  const text = draft.value;
  draft.value = "";
  // Arm the delayed neutral "Still working…" hint (no claim about searching).
  stillWorking.value = false;
  if (workingTimer) clearTimeout(workingTimer);
  workingTimer = setTimeout(() => {
    stillWorking.value = true;
  }, STILL_WORKING_DELAY_MS);
  try {
    await store.send(props.client, text);
  } finally {
    if (workingTimer) clearTimeout(workingTimer);
    stillWorking.value = false;
  }
  void usageStore.refresh(props.client, "meal_chat");
}

type EstimatedBody = {
  name: string | null;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  eaten_at: string;
};

// Internal per-meal log mechanics. Return true on success (so the caller can
// dismiss + decide when to emit). They do NOT emit or toggle `logging`/`logError`
// themselves — the public callers below own that, so a single card and a batch
// share one implementation while emitting "logged" at most once per user action.
async function doLogEstimated(body: EstimatedBody, save: boolean): Promise<boolean> {
  await props.client.post("/v1/meals", body, MealResponseSchema);
  const name = body.name?.trim();
  // StoredMealInputSchema requires a non-empty name — skip the library save
  // when the estimated meal has no name (still log the meal itself).
  if (save && name) {
    await props.client.post(
      "/v1/stored-meals",
      {
        name,
        kcal: body.kcal,
        protein_g: body.protein_g,
        carb_g: body.carb_g,
        fat_g: body.fat_g,
      },
      StoredMealResponseSchema,
    );
  }
  return true;
}

// Returns the logged meal's name + kcal so the caller can build the
// "✓ Logged …" confirmation summary (a stored proposed meal only carries a
// name, not kcal — the def fetched here is the source of truth).
async function doLogStored(
  storedMealId: number,
  eatenAt: string,
): Promise<{ name: string; kcal: number }> {
  const def = await props.client.get(`/v1/stored-meals/${storedMealId}`, StoredMealResponseSchema);
  await props.client.post(
    "/v1/meals",
    {
      eaten_at: eatenAt,
      name: def.name,
      kcal: def.kcal,
      protein_g: def.protein_g,
      carb_g: def.carb_g,
      fat_g: def.fat_g,
    },
    MealResponseSchema,
  );
  return { name: def.name, kcal: def.kcal };
}

type AlcoholBody = {
  drinks_count: number;
  est_kcal: number;
  started_at: string;
  notes: string | null;
};

async function doLogAlcohol(body: AlcoholBody): Promise<boolean> {
  await props.client.post("/v1/alcohol-sessions", body, AlcoholSessionResponseSchema);
  return true;
}

function loggedAlcoholSummary(drinks: number, kcal: number): string {
  return `✓ Logged ${drinks} drinks — ~${Math.round(kcal)} kcal`;
}

/** Build the per-meal "✓ Logged <name> — <kcal> kcal" confirmation line. */
function loggedSummary(name: string, kcal: number): string {
  return `✓ Logged ${name} — ${Math.round(kcal)} kcal`;
}

// Single-card handlers (wired to ChatThread): log one meal, then emit once.
async function logEstimated(
  turnIndex: number,
  mealIndex: number,
  body: EstimatedBody,
  save: boolean,
): Promise<void> {
  if (logging.value) return;
  logging.value = true;
  logError.value = null;
  try {
    await doLogEstimated(body, save);
    // Replace the card with a confirmation only on success — never in a finally.
    store.markLogged(turnIndex, mealIndex, loggedSummary(body.name ?? "meal", body.kcal));
    emit("logged");
  } catch {
    logError.value = "Couldn't log — try again.";
  } finally {
    logging.value = false;
  }
}

async function logStored(
  turnIndex: number,
  mealIndex: number,
  storedMealId: number,
  eatenAt: string,
): Promise<void> {
  if (logging.value) return;
  logging.value = true;
  logError.value = null;
  try {
    const { name, kcal } = await doLogStored(storedMealId, eatenAt);
    store.markLogged(turnIndex, mealIndex, loggedSummary(name, kcal));
    emit("logged");
  } catch {
    logError.value = "Couldn't log — try again.";
  } finally {
    logging.value = false;
  }
}

async function logAlcohol(
  turnIndex: number,
  alcoholIndex: number,
  body: AlcoholBody,
): Promise<void> {
  if (logging.value) return;
  logging.value = true;
  logError.value = null;
  try {
    await doLogAlcohol(body);
    store.markAlcoholLogged(
      turnIndex,
      alcoholIndex,
      loggedAlcoholSummary(body.drinks_count, body.est_kcal),
    );
    emit("logged");
  } catch {
    logError.value = "Couldn't log — try again.";
  } finally {
    logging.value = false;
  }
}

async function logAll(turnIndex: number): Promise<void> {
  if (logging.value) return;
  const turn = store.turns[turnIndex];
  if (turn?.role !== "assistant" || turn.kind !== "proposal") return;
  logging.value = true;
  logError.value = null;
  let loggedAny = false;
  let anyFailed = false;
  // Iterate from the end backward so dismissMeal's splice doesn't shift the
  // indices of cards we haven't logged yet.
  try {
    for (let mi = turn.meals.length - 1; mi >= 0; mi--) {
      const meal = turn.meals[mi];
      if (!meal) continue;
      try {
        let summary: string;
        if (meal.source === "stored") {
          const { name, kcal } = await doLogStored(
            meal.stored_meal_id,
            meal.eaten_at ?? `${props.viewedDate}T12:00:00`,
          );
          summary = loggedSummary(name, kcal);
        } else {
          await doLogEstimated(
            {
              name: meal.name,
              kcal: meal.kcal,
              protein_g: meal.protein_g,
              carb_g: meal.carb_g,
              fat_g: meal.fat_g,
              eaten_at: meal.eaten_at ?? `${props.viewedDate}T12:00:00`,
            },
            // Honor each card's own default save state.
            meal.suggest_store,
          );
          summary = loggedSummary(meal.name ?? "meal", meal.kcal);
        }
        // Replace only the cards that logged with a confirmation row; failures
        // stay visible to retry.
        store.markLogged(turnIndex, mi, summary);
        loggedAny = true;
      } catch {
        anyFailed = true;
      }
    }
    for (let ai = turn.alcoholSessions.length - 1; ai >= 0; ai--) {
      const a = turn.alcoholSessions[ai];
      if (!a) continue;
      try {
        await doLogAlcohol({
          drinks_count: a.drinks_count,
          est_kcal: a.est_kcal,
          started_at: a.started_at ?? `${props.viewedDate}T12:00:00`,
          notes: a.note ?? null,
        });
        store.markAlcoholLogged(turnIndex, ai, loggedAlcoholSummary(a.drinks_count, a.est_kcal));
        loggedAny = true;
      } catch {
        anyFailed = true;
      }
    }
  } finally {
    logging.value = false;
  }
  // One refresh for the whole batch (not per-meal), and keep an error banner if
  // any meal failed — a later success must not clear an earlier failure.
  if (loggedAny) emit("logged");
  if (anyFailed) logError.value = "Some items couldn't be logged — try again.";
}
</script>

<template>
  <div class="chat-overlay" :style="overlayStyle" data-test="meal-chat-panel">
    <section
      ref="panelRef"
      class="chat-panel"
      role="dialog"
      aria-modal="true"
      aria-label="AI meal assistant"
      tabindex="-1"
      @keydown.esc="close"
    >
      <header class="chat-header">
        <span class="title">AI Meal Assistant</span>
        <UsageIndicator :balance="usageStore.balance" />
        <button type="button" class="close-btn" aria-label="Close" @click="close">×</button>
      </header>

      <div ref="chatBodyRef" class="chat-body">
        <p v-if="store.turns.length === 0" class="empty">
          Tell me what you ate or drank — e.g. "a chicken burrito and a beer".
        </p>
        <ChatThread
          :turns="store.turns"
          :viewed-date="viewedDate"
          :real-today="realToday"
          :pending="logging"
          @log-estimated="logEstimated"
          @log-stored="logStored"
          @log-all="logAll"
          @log-alcohol="logAlcohol"
          @dismiss-alcohol="(ti, ai) => store.dismissAlcohol(ti, ai)"
          @dismiss="(ti, mi) => store.dismissMeal(ti, mi)"
        />
        <p v-if="store.pending && stillWorking" class="pending" data-test="chat-still-working">
          Still working…
        </p>
        <p
          v-else-if="store.pending"
          class="pending"
          data-test="chat-pending"
        >Thinking…</p>
        <p v-if="store.error" class="error" data-test="chat-error">{{ store.error }}</p>
        <p v-if="logError" class="error" data-test="chat-log-error">{{ logError }}</p>
      </div>

      <form class="input-bar" @submit.prevent="onSend">
        <input
          v-model="draft"
          type="text"
          placeholder="What did you eat?"
          data-test="chat-input"
          :disabled="store.pending"
        />
        <button type="submit" :disabled="store.pending || draft.trim() === ''" data-test="chat-send">
          Send
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.chat-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.chat-panel {
  width: min(520px, 96vw); max-height: 88vh;
  display: flex; flex-direction: column;
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36); border-radius: 12px;
  overflow: hidden; outline: none;
}
.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--line, #262a36);
}
.title { font-size: 13px; font-weight: 600; color: var(--ink, #e6e8ee); }
.close-btn {
  font-size: 20px; line-height: 1; background: transparent; border: none;
  color: var(--ink-dim, #9aa0ad); cursor: pointer;
}
.chat-body { flex: 1; overflow-y: auto; padding: 14px; }
.empty { margin: 0; font-size: 13px; color: var(--ink-faint, #6b7180); }
.pending { font-size: 12px; color: var(--ink-faint, #6b7180); margin: 8px 0 0; }
.error { font-size: 12px; color: var(--bad, #f08a8a); margin: 8px 0 0; }
.input-bar {
  display: flex; gap: 8px; padding: 10px 14px;
  border-top: 1px solid var(--line, #262a36);
}
.input-bar input {
  flex: 1; font: inherit; font-size: 13px; min-height: 38px;
  background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36);
  border-radius: 8px; color: var(--ink, #e6e8ee); padding: 0 10px;
}
.input-bar button {
  font: inherit; font-size: 13px; cursor: pointer; padding: 0 16px;
  border: none; border-radius: 8px; background: var(--accent, #5b7cfa); color: #fff;
}
.input-bar button:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 768px) {
  /* Full-screen on mobile, filling the overlay. The overlay carries the
     keyboard-awareness: JS pins it to the visual viewport (overlayStyle), so a
     panel at height:100% exactly covers the visible region and its bottom input
     bar sits above the keyboard. The dvh/vh lines are a graceful fallback for the
     rare browser without the visualViewport API (overlay stays full layout
     height); 100% wins when present and resolves against the pinned overlay. */
  .chat-panel {
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
  /* Full-screen on mobile means the input bar sits on the very bottom edge —
     give it clearance from the screen edge + the home-indicator/gesture area.
     The 20px floor covers phones with no inset; env() adds the real inset on
     phones that expose it (resolves to 0 without app-wide viewport-fit=cover,
     so the floor always applies). */
  .input-bar { padding-bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px)); }
}
</style>
