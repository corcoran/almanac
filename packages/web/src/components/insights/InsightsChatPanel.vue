<script setup lang="ts">
import { ShareReportSchema } from "@almanac/core/schemas";
import { buildReportMarkdown } from "@almanac/core/signals";
import MarkdownIt from "markdown-it";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ApiClient } from "../../api/client.js";
import { useIsMobile } from "../../composables/useIsMobile.js";
import { useVisualViewportHeight } from "../../composables/useVisualViewportHeight.js";
import { useInsightsChatStore } from "../../stores/insights-chat.store.js";
import { useLlmUsageStore } from "../../stores/llm-usage.store.js";
import WebSourcesFootnote from "../chat/WebSourcesFootnote.vue";
import UsageIndicator from "../meal-chat/UsageIndicator.vue";

const props = defineProps<{ client: ApiClient; viewedDate?: string; realToday?: string }>();

const emit = defineEmits<(e: "close") => void>();

// Assistant replies are model-generated markdown. `html: false` is the security
// guarantee: markdown-it ESCAPES any literal HTML in the source (so a model that
// emits `<script>`/`<img onerror>` can't inject it), and the rendered output
// contains only markdown-derived tags — which makes `v-html` safe here. User
// turns stay plain-text `{{ }}` (no markdown), so no user input is ever rendered
// as HTML. Do NOT set html:true.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// The auto-insight opener, fired on a brand-new empty day. Shared by onMounted
// (opening a fresh day) and onNewChat (clearing today's thread) so the two paths
// stay identical and the literal can't drift.
const OPENER = "Give me a quick read on how I'm doing.";

function renderMarkdown(text: string): string {
  return md.render(text);
}

const store = useInsightsChatStore();
// Insights shares the ONE daily LLM token budget with meal-chat, so refresh the
// same usage store after every send to keep the indicator honest across panels.
const usageStore = useLlmUsageStore();
const { isMobile } = useIsMobile();
const {
  height: viewportHeight,
  offsetTop: viewportOffsetTop,
  supported: viewportSupported,
} = useVisualViewportHeight();
// On mobile, pin the OVERLAY to the visual viewport (the region above the soft
// keyboard) rather than the layout viewport — same rationale as MealChatPanel:
// a `fixed; inset:0` overlay spans the full layout height, so a centered panel
// floats mid-screen once the keyboard is up. Anchoring top=offsetTop /
// height=visualViewport.height makes the overlay cover exactly the visible
// region; the full-screen panel fills it with its input bar just above the
// keyboard. Desktop / browsers without the API fall back to the CSS rules.
const overlayStyle = computed(() =>
  isMobile.value && viewportSupported
    ? {
        top: `${viewportOffsetTop.value}px`,
        height: `${viewportHeight.value}px`,
        alignItems: "stretch" as const,
      }
    : undefined,
);

const panelRef = ref<HTMLElement | null>(null);
const chatBodyRef = ref<HTMLElement | null>(null);
const draft = ref("");

// Day-stepper geometry. `store.days` is NEWEST-FIRST: index 0 is the current
// day, a HIGHER index is an OLDER day. The viewed day's index drives which
// direction buttons are live. A fresh today (no conversation yet) isn't in
// `days`, so `idx` is -1 — but ◀ stays live if any past day exists (see below).
const dayIndex = computed(() => store.days.indexOf(store.viewedDate ?? ""));
// `days` is newest-first. ◀ (older) is enabled when an older day exists at a
// higher index, OR when we're on a FRESH today (viewedDate not in `days`,
// idx === -1) and any past day exists — so you can always reach the archive.
const canGoPrev = computed(() =>
  dayIndex.value === -1 ? store.days.length > 0 : dayIndex.value < store.days.length - 1,
);
// ▶ (newer) is enabled only when a newer day exists at a lower index. A fresh
// today (idx === -1) is already the newest, so nothing newer to step to.
const canGoNext = computed(() => dayIndex.value > 0);
// Show the viewed date only when it isn't the current (newest) day — days[0] is
// "today/current"; an empty `days` is a fresh today, also current.
// Are we viewing a day BEFORE the live current day? Keyed off `realToday` (the
// live current user-day, passed from App.vue) — NOT off `days[0]`. Keying off
// `days[0]` was wrong: on a fresh today with no conversation yet, today isn't in
// `days` (only past days are), so `viewedDate !== days[0]` falsely read as "past"
// and flipped the input to the Jump-to-today button while waiting for the first
// reply. Comparing the viewed date to the actual current day is the real signal.
// `YYYY-MM-DD` strings compare lexically = chronologically. When `realToday` is
// unknown (prop missing / not yet loaded), treat the view as current/interactive.
const isPastView = computed(() => {
  const d = store.viewedDate;
  const today = props.realToday;
  return d !== null && today !== undefined && today !== "" && d < today;
});

// Show the viewed date (compact MM/DD) only when viewing a past day. Same signal
// as isPastView. The full ISO date pushed the header buttons off-screen on a
// phone; `d` is a validated YYYY-MM-DD so slicing month/day is safe.
const viewedDateLabel = computed(() => {
  const d = store.viewedDate;
  if (!isPastView.value || d === null) return null;
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`;
});

// Copy-stats state machine, ported from ShareStatsButton: idle → preparing →
// copied/error, auto-resetting to idle after 2s.
type CopyState = "idle" | "preparing" | "copied" | "error";
const copyState = ref<CopyState>("idle");
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

// Keep the newest message + the input visible — especially once the soft
// keyboard shrinks the visual viewport, which otherwise leaves the latest turn
// scrolled out of view.
function scrollToBottom(): void {
  const el = chatBodyRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  panelRef.value?.focus();
  void usageStore.refresh(props.client, "insights_chat");
  // Hydrate the server-persisted transcript FIRST (zero tokens), THEN gate the
  // auto-opener on the LOADED turns — so reopening a day that already has a
  // conversation (or stepping to a past day) never re-fires the insight; only a
  // brand-new empty day surfaces one with no typing.
  void (async () => {
    // Open the SELECTED calendar day when it's a PAST day; otherwise (today, or
    // no traversal) load today. A past day is read-only and must NOT auto-fire
    // the opener — only a brand-new empty TODAY surfaces one with no typing.
    const initialDate =
      props.viewedDate && props.realToday && props.viewedDate < props.realToday
        ? props.viewedDate
        : undefined;
    await store.load(props.client, initialDate);
    if (initialDate === undefined && store.turns.length === 0) {
      void send(OPENER);
    }
    void nextTick(scrollToBottom);
  })();
});

// The copy-stats handler arms a 2s setTimeout to reset copyState. If the panel
// unmounts before it fires, clear it so the callback can't mutate state on a
// torn-down component.
onBeforeUnmount(() => {
  if (copyResetTimer !== null) clearTimeout(copyResetTimer);
});

// New turns (the user's own message and the assistant reply) → scroll to bottom
// after the DOM updates.
watch(
  () => store.turns.length,
  () => {
    void nextTick(scrollToBottom);
  },
);

// The visual viewport shrinking (keyboard opening) must re-pin the view to the
// bottom so the latest content sits just above the keyboard.
watch(viewportHeight, () => {
  void nextTick(scrollToBottom);
});

async function send(text: string): Promise<void> {
  await store.send(props.client, text);
  // Insights spends from the shared budget — refresh the indicator after each
  // turn so the remaining-logs hint stays accurate.
  void usageStore.refresh(props.client, "insights_chat");
}

async function onSend(): Promise<void> {
  const text = draft.value;
  draft.value = "";
  await send(text);
}

// "Reset day" permanently DELETES today's server-side thread (store.newChat does
// a hard clearDay), then re-fires the auto-insight — mirroring onMounted's
// load-then-gate so the fresh thread behaves like opening a brand-new day. It's
// destructive (the day's conversation is gone, not recoverable), so confirm first.
async function onResetDay(): Promise<void> {
  if (store.loading) return;
  const ok = window.confirm(
    "Reset today's conversation? This clears today's chat history and can't be undone.",
  );
  if (!ok) return;
  await store.newChat(props.client);
  if (store.turns.length === 0) {
    void send(OPENER);
  }
  void nextTick(scrollToBottom);
}

// Past days are read-only. "Jump to today" returns to the live conversation.
async function onJumpToday(): Promise<void> {
  if (store.loading) return;
  await store.load(props.client); // no date → today; resets viewedDate
  if (store.turns.length === 0) void send(OPENER); // fresh today → opener
  void nextTick(scrollToBottom);
}

function close(): void {
  store.reset();
  emit("close");
}

async function onCopy(): Promise<void> {
  if (copyState.value === "preparing") return;
  if (copyResetTimer !== null) {
    clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }
  copyState.value = "preparing";
  try {
    const report = await props.client.get("/v1/report", ShareReportSchema);
    const md = buildReportMarkdown(report);
    await navigator.clipboard.writeText(md);
    copyState.value = "copied";
  } catch {
    copyState.value = "error";
  }
  copyResetTimer = setTimeout(() => {
    copyState.value = "idle";
    copyResetTimer = null;
  }, 2000);
}
</script>

<template>
  <div class="chat-overlay" :style="overlayStyle" data-test="insights-panel">
    <section
      ref="panelRef"
      class="chat-panel"
      role="dialog"
      aria-modal="true"
      aria-label="AI insights"
      tabindex="-1"
      @keydown.esc="close"
    >
      <header class="chat-header">
        <span class="title">Insights</span>
        <button
          type="button"
          class="step-btn"
          data-test="insights-prev-day"
          aria-label="Previous day"
          :disabled="!canGoPrev || store.loading"
          @click="store.stepDay(props.client, -1)"
        >◀</button>
        <button
          type="button"
          class="step-btn"
          data-test="insights-next-day"
          aria-label="Next day"
          :disabled="!canGoNext || store.loading"
          @click="store.stepDay(props.client, 1)"
        >▶</button>
        <span v-if="viewedDateLabel" class="viewed-date" data-test="insights-viewed-date">{{
          viewedDateLabel
        }}</span>
        <!-- "Reset day" clears TODAY's thread, so it only makes sense on the
             current day — hide it entirely when viewing a past day. -->
        <button
          v-if="viewedDateLabel === null"
          type="button"
          class="reset-day-btn"
          data-test="insights-new-chat"
          :disabled="store.loading"
          @click="onResetDay"
        >Reset day</button>
        <UsageIndicator :balance="usageStore.balance" />
        <button
          type="button"
          class="copy-btn"
          data-test="insights-copy"
          :data-state="copyState"
          :aria-label="
            copyState === 'copied'
              ? 'Copied'
              : copyState === 'error'
                ? 'Copy failed'
                : 'Copy stats for LLM'
          "
          @click="onCopy"
        >
          <span v-if="copyState === 'copied'">✓</span>
          <span v-else-if="copyState === 'error'">✕</span>
          <span v-else>📋</span>
        </button>
        <button
          type="button"
          class="close-btn"
          aria-label="Close"
          data-test="insights-close"
          @click="close"
        >×</button>
      </header>

      <div ref="chatBodyRef" class="chat-body">
        <div
          v-for="(turn, i) in store.turns"
          :key="i"
          class="turn"
          :class="turn.role === 'user' ? 'turn-user' : 'turn-assistant'"
          :data-test="turn.role === 'user' ? 'insights-user-turn' : 'insights-assistant-turn'"
        >
          <p v-if="turn.role === 'user'" class="bubble bubble-user">{{ turn.content }}</p>
          <!-- v-html is safe here: renderMarkdown uses markdown-it with html:false, which escapes any literal HTML in the model output (no <script>/<img onerror> can slip through). -->
          <div v-else class="bubble markdown" v-html="renderMarkdown(turn.content)"></div>
          <!-- Dormant until insights web search is enabled: turn.sources is [] today
               (the coach runs with searchEnabled:false), so this never renders. Kept
               wired so sources work with zero further change the day search flips on. -->
          <WebSourcesFootnote
            v-if="turn.sources && turn.sources.length > 0"
            :sources="turn.sources"
          />
        </div>
        <p v-if="store.pending || store.loading" class="pending" data-test="insights-pending">
          {{ store.pending ? "Thinking…" : "Loading…" }}
        </p>
        <p v-if="store.error" class="error" data-test="insights-error">{{ store.error }}</p>
      </div>

      <form v-if="!isPastView" class="input-bar" @submit.prevent="onSend">
        <textarea
          v-model="draft"
          rows="1"
          placeholder="Ask about your trend, sleep, targets…"
          data-test="insights-input"
          :disabled="store.pending"
          @keydown.enter.exact.prevent="onSend"
        ></textarea>
        <button
          type="submit"
          data-test="insights-send"
          :disabled="store.pending || draft.trim() === ''"
        >
          Send
        </button>
      </form>
      <!-- Past days are read-only: no input, just a way back to the live chat. -->
      <div v-else class="input-bar jump-bar">
        <button
          type="button"
          class="jump-today-btn"
          data-test="insights-jump-today"
          :disabled="store.loading"
          @click="onJumpToday"
        >
          Jump to today
        </button>
      </div>
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
  display: flex; align-items: center; gap: 8px;
  /* Wrap rather than overflow: on a narrow phone the row (title · date · ◀ ▶ ·
     New chat · usage · 📋 · ✕) could push the close button off-screen. Wrapping
     keeps every control reachable. */
  flex-wrap: wrap;
  padding: 10px 14px; border-bottom: 1px solid var(--line, #262a36);
}
/* The title yields space first (truncates) so the action buttons never get
   pushed out. */
.title {
  font-size: 13px; font-weight: 600; color: var(--ink, #e6e8ee);
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The viewed-date sits right after the title; the right-hand action cluster is
   anchored by the close button's own margin (below), so nothing relies on the
   date's presence for layout. */
/* Styled as a non-interactive pill matching the New chat button (same border,
   padding, height, background, and min-width) so the two chips read as balanced
   peers rather than the date being fine print. It's a label, so no cursor/hover. */
.viewed-date {
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; height: 28px; padding: 0 8px; min-width: 64px;
  border: 1px solid var(--line, #262a36); border-radius: 6px;
  background: var(--surface-1, #161c18); color: var(--ink-dim, #9aa0ad);
  font-variant-numeric: tabular-nums;
}
/* Action buttons never shrink — they stay full-size and tappable; the title
   absorbs the squeeze instead. */
.step-btn, .reset-day-btn, .copy-btn, .close-btn { flex: 0 0 auto; }
.step-btn {
  flex-shrink: 0;
  width: 28px; height: 28px; border-radius: 6px;
  border: 1px solid var(--line, #262a36);
  background: var(--surface-1, #161c18);
  color: var(--ink-dim, #9aa0ad); font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.step-btn:first-of-type { margin-left: auto; }
.viewed-date + .step-btn { margin-left: 0; }
.step-btn:disabled { opacity: 0.4; cursor: default; }
/* min-width:64px matches the viewed-date pill so the two header chips read as
   equal-width peers across the current-day / past-day states. */
.reset-day-btn {
  flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 64px;
  font-size: 11px; cursor: pointer; padding: 0 8px; height: 28px;
  border: 1px solid var(--line, #262a36); border-radius: 6px;
  background: var(--surface-1, #161c18); color: var(--ink-dim, #9aa0ad);
}
.reset-day-btn:disabled { opacity: 0.4; cursor: default; }
.copy-btn {
  flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 8px;
  border: 1px solid var(--line, #262a36);
  background: var(--surface-1, #161c18);
  color: #6ee7a8; font-size: 16px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.copy-btn[data-state="error"] { color: #e6b450; }
.close-btn {
  font-size: 20px; line-height: 1; background: transparent; border: none;
  color: var(--ink-dim, #9aa0ad); cursor: pointer;
}
.chat-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.turn { display: flex; }
.turn-user { justify-content: flex-end; }
.turn-assistant { justify-content: flex-start; }
.bubble {
  margin: 0; font-size: 13px; line-height: 1.45;
  max-width: 85%; padding: 8px 12px; border-radius: 12px;
  color: var(--ink, #e6e8ee);
}
/* User turns are plain text — preserve their newlines. Assistant markdown
   handles line breaks via markdown-it (breaks:true), so it must NOT pre-wrap. */
.bubble-user { white-space: pre-wrap; }
.turn-user .bubble { background: var(--accent, #5b7cfa); color: #fff; }
.turn-assistant .bubble { background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36); }
.markdown :deep(p) { margin: 0 0 8px; }
.markdown :deep(p:last-child) { margin-bottom: 0; }
.markdown :deep(ul),
.markdown :deep(ol) { margin: 4px 0; padding-left: 20px; }
.markdown :deep(strong) { font-weight: 600; }
.markdown :deep(code) {
  background: rgba(255, 255, 255, 0.08); padding: 1px 4px;
  border-radius: 4px; font-size: 12px;
}
.markdown :deep(a) { color: var(--accent, #5b7cfa); }
/* Headers: the model occasionally leads sections with ## / ###. Scale them down
   to fit a chat bubble rather than the default page-sized h1/h2. */
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3) { margin: 8px 0 4px; font-size: 14px; font-weight: 600; }
.markdown :deep(h1:first-child),
.markdown :deep(h2:first-child),
.markdown :deep(h3:first-child) { margin-top: 0; }
/* Tables: markdown-it renders GFM tables out of the box; give them borders +
   padding so the AI's day-by-day breakdowns are legible in the bubble. */
.markdown :deep(table) {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 12px;
  width: 100%;
}
.markdown :deep(th),
.markdown :deep(td) {
  border: 1px solid var(--line, #262a36);
  padding: 3px 8px;
  text-align: left;
}
.markdown :deep(th) { background: rgba(255, 255, 255, 0.04); font-weight: 600; }
.markdown :deep(blockquote) {
  margin: 6px 0;
  padding: 2px 0 2px 10px;
  border-left: 3px solid var(--line, #262a36);
  color: var(--ink-faint, #6b7180);
}
.pending { font-size: 12px; color: var(--ink-faint, #6b7180); margin: 0; }
.error { font-size: 12px; color: var(--bad, #f08a8a); margin: 0; }
.input-bar {
  display: flex; gap: 8px; padding: 10px 14px;
  border-top: 1px solid var(--line, #262a36);
}
.input-bar textarea {
  flex: 1; font: inherit; font-size: 13px; min-height: 38px; resize: none;
  background: var(--bg, #0e1016); border: 1px solid var(--line, #262a36);
  border-radius: 8px; color: var(--ink, #e6e8ee); padding: 8px 10px;
}
.input-bar button {
  font: inherit; font-size: 13px; cursor: pointer; padding: 0 16px;
  border: none; border-radius: 8px; background: var(--accent, #5b7cfa); color: #fff;
}
.input-bar button:disabled { opacity: 0.5; cursor: default; }
/* Past-day read-only footer: the "Jump to today" button fills the bar like a
   full-width primary action, matching the Send button's accent look. */
.jump-bar { display: flex; }
.jump-today-btn {
  flex: 1; font: inherit; font-size: 13px; cursor: pointer; height: 36px;
  border: none; border-radius: 8px;
  background: var(--accent, #5b7cfa); color: #fff;
}
.jump-today-btn:disabled { opacity: 0.5; cursor: default; }
@media (max-width: 768px) {
  /* Full-screen on mobile, filling the overlay. The overlay carries the
     keyboard-awareness: JS pins it to the visual viewport (overlayStyle), so a
     panel at height:100% exactly covers the visible region and its bottom input
     bar sits above the keyboard. The dvh/vh lines are a graceful fallback for the
     rare browser without the visualViewport API; 100% wins when present. */
  .chat-panel {
    width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    height: 100%;
    max-height: 100%;
    border-radius: 0;
  }
  /* Clear the home-indicator/gesture area at the bottom edge. */
  .input-bar { padding-bottom: max(20px, calc(env(safe-area-inset-bottom) + 12px)); }
}
</style>
