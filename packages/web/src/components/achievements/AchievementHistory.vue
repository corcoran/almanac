<script setup lang="ts">
import type { AccomplishmentHistoryResponseSchema } from "@almanac/core/schemas";
import { computed, onMounted, ref } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import {
  ACCOMPLISHMENT_ICON,
  ACCOMPLISHMENT_ICON_FALLBACK,
} from "../../lib/accomplishment-icons.js";
import {
  formatAccomplishmentValue,
  kgToDisplayWeight,
  type UnitSystem,
  weightUnitLabel,
} from "../../lib/units.js";
import { useAccomplishmentHistoryStore } from "../../stores/accomplishment-history.js";

type History = z.infer<typeof AccomplishmentHistoryResponseSchema>;
type Win = History["accomplishments"][number];

const props = withDefaults(defineProps<{ client: ApiClient; unitSystem?: UnitSystem }>(), {
  unitSystem: "metric",
});
const emit = defineEmits<(e: "close") => void>();

const store = useAccomplishmentHistoryStore();

// A11y: auto-focus the panel on mount so the Escape keydown handler
// is reachable without a prior click. Mirrors SettingsPanel's pattern.
const panelRef = ref<HTMLElement | null>(null);

onMounted(() => {
  void store.load(props.client);
  panelRef.value?.focus();
});

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthLabel(ym: string): string {
  // earned_on is already user-local YYYY-MM-DD (see CLAUDE.md: this is NOT a UTC
  // event-timestamp, so slicing the year/month is correct — do NOT use Date/UTC).
  const year = Number(ym.slice(0, 4));
  const monthIdx = Number(ym.slice(5, 7)) - 1;
  const name = MONTHS[monthIdx] ?? ym.slice(5, 7);
  return `${name} ${year}`;
}

type MonthGroup = { key: string; label: string; wins: Win[] };

const groups = computed<MonthGroup[]>(() => {
  const wins = store.data?.accomplishments ?? [];
  const out: MonthGroup[] = [];
  const byKey = new Map<string, MonthGroup>();
  for (const w of wins) {
    const key = w.earned_on.slice(0, 7);
    let g = byKey.get(key);
    if (g === undefined) {
      g = { key, label: monthLabel(key), wins: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.wins.push(w);
  }
  return out;
});

function iconFor(code: string): string {
  return ACCOMPLISHMENT_ICON[code] ?? ACCOMPLISHMENT_ICON_FALLBACK;
}

function priorText(w: Win): string | null {
  return w.prior_best !== null
    ? `prev best ${formatAccomplishmentValue(w.code, w.prior_best.value, props.unitSystem)} (${w.prior_best.earned_on})`
    : null;
}

const aggregates = computed(() => store.data?.aggregates ?? null);
const bestWeighInStreak = computed(
  () => aggregates.value?.best_by_type.weigh_in_streak?.value ?? 0,
);
// "Most down" tile: the best weight_milestone value is kg; convert for display.
const mostDown = computed(() =>
  kgToDisplayWeight(aggregates.value?.best_by_type.weight_milestone?.value ?? 0, props.unitSystem),
);
const weightUnit = computed(() => weightUnitLabel(props.unitSystem));
const isEmpty = computed(() => store.status === "ready" && groups.value.length === 0);
</script>

<template>
  <div class="history-overlay" data-test="achievement-history">
    <div
      ref="panelRef"
      class="history-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="achievement-history-title"
      tabindex="-1"
      data-test="history-panel"
      @keydown.esc="emit('close')"
    >
      <header class="history-header">
        <h2 id="achievement-history-title">Achievements</h2>
        <button
          type="button"
          class="history-close"
          data-test="history-close"
          aria-label="Close"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div v-if="store.status === 'loading'" class="history-status">Loading…</div>
      <div v-else-if="store.status === 'error'" class="history-status">
        Couldn't load achievements.
      </div>
      <div v-else-if="isEmpty" class="history-status">No wins yet — keep logging.</div>
      <template v-else>
        <div class="agg-strip">
          <div class="agg-tile">
            <div class="agg-value" data-test="agg-total">{{ aggregates?.total ?? 0 }}</div>
            <div class="agg-label">total wins</div>
          </div>
          <div class="agg-tile">
            <div class="agg-value">{{ bestWeighInStreak }}d</div>
            <div class="agg-label">best streak</div>
          </div>
          <div class="agg-tile">
            <div class="agg-value">{{ mostDown }}{{ weightUnit }}</div>
            <div class="agg-label">most down</div>
          </div>
        </div>
        <div class="history-list">
          <section v-for="g in groups" :key="g.key" class="month-group">
            <div class="month-header" data-test="month-header">{{ g.label }}</div>
            <div v-for="(w, i) in g.wins" :key="`${g.key}-${i}`" class="win-row">
              <span class="win-icon" aria-hidden="true">{{ iconFor(w.code) }}</span>
              <span class="win-text"
                >{{ w.message
                }}<span v-if="priorText(w) !== null" class="win-prior">
                  · {{ priorText(w) }}</span
                ></span
              >
              <span class="win-date">{{ w.earned_on }}</span>
            </div>
          </section>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.history-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: var(--bg, #0f1115);
  display: flex;
  justify-content: center;
  overflow-y: auto;
}
.history-panel {
  width: 100%;
  max-width: 520px;
  padding: 0 0 40px;
}
/* tabindex="-1" makes the panel programmatically focusable so Esc reaches
 * the keydown handler, but we don't want a visible focus ring. */
.history-panel:focus {
  outline: none;
}
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line-1, #262a36);
  position: sticky;
  top: 0;
  background: var(--bg, #0f1115);
}
.history-header h2 {
  font-size: 15px;
  margin: 0;
  color: var(--ink, #e6e8ee);
}
.history-close {
  background: transparent;
  border: none;
  color: var(--ink-faint, #9aa0ad);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.history-close:hover {
  color: var(--ink, #e6e8ee);
}
.history-status {
  padding: 40px 16px;
  text-align: center;
  color: var(--ink-faint, #9aa0ad);
  font-size: 13px;
}
.agg-strip {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid #1f3a2a;
  background: #101813;
}
.agg-tile {
  flex: 1;
  text-align: center;
}
.agg-value {
  color: #6ee7a8;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.agg-label {
  color: #6b8b76;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.month-header {
  padding: 14px 16px 4px;
  color: var(--ink-faint, #9aa0ad);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.win-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid #161c18;
}
.win-icon {
  font-size: 16px;
}
.win-text {
  flex: 1;
  color: #d7e6dc;
  font-size: 13px;
}
.win-prior {
  color: #6b8b76;
  font-size: 12px;
}
.win-date {
  color: #5a6b60;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
</style>
