<script setup lang="ts">
import type { DailyBalanceSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";

type Balance = z.infer<typeof DailyBalanceSchema>;

const props = defineProps<{ balance: Balance | null }>();

const expanded = ref(false);

// Only render when we have a balance with a configured soft limit. With no soft
// limit there's no cap to show, so the indicator stays out of the way.
const show = computed(() => props.balance !== null && props.balance.softLimit !== null);

// Near-limit / over-limit: dim the pill and surface the reassurance copy.
// "Running low" warning: over the soft limit, OR ≤30% of the daily balance left,
// OR ≤2 logs left. The 30% gives early warning at normal/large limits; the
// ≤2-logs floor guarantees a heads-up even at small limits, where 30% is barely
// a message wide.
const low = computed(() => {
  const b = props.balance;
  if (!b) return false;
  if (b.overSoftLimit) return true;
  if (b.pctRemaining !== null && b.pctRemaining <= 30) return true;
  return b.logsLeftEstimate !== null && b.logsLeftEstimate <= 2;
});

const pct = computed(() => props.balance?.pctRemaining ?? 0);
const logsLeft = computed(() => props.balance?.logsLeftEstimate ?? 0);

const avgK = computed(() => ((props.balance?.avgTokensPerLog ?? 0) / 1000).toFixed(1));

// Tokens used of the daily budget — base-consistent, unlike the old
// callsToday-of-implied-logs framing (mixed bases, could read "8 of 7").
// softLimit is non-null whenever the card shows, so ?? 0 never actually fires.
const usedK = computed(() => ((props.balance?.tokensUsed ?? 0) / 1000).toFixed(1));
const budgetK = computed(() => Math.round((props.balance?.softLimit ?? 0) / 1000));
</script>

<template>
  <div v-if="show && balance" class="usage-indicator">
    <button
      type="button"
      class="usage-pill"
      :class="{ warn: low }"
      data-test="usage-pill"
      @click="expanded = !expanded"
    >
      <span class="bar"><span class="bar-fill" :style="{ width: `${pct}%` }" /></span>
      <span class="pill-text">~{{ logsLeft }} logs left</span>
    </button>

    <div v-if="expanded" class="usage-card" data-test="usage-card">
      <div class="headline">~{{ logsLeft }} logs left today</div>
      <div class="pct">{{ pct }}% of daily balance</div>
      <div class="detail">
        {{ usedK }}k of {{ budgetK }}k tokens used · avg ~{{ avgK }}k tokens/log · resets at {{ balance.resetsAt }}
      </div>
      <div class="reassure">You can still log meals manually any time.</div>
    </div>
  </div>
</template>

<style scoped>
.usage-indicator { display: inline-block; }
.usage-pill {
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 11px; cursor: pointer;
  padding: 3px 8px; border-radius: 999px;
  border: 1px solid var(--line, #262a36);
  background: var(--panel-2, #1b1f2a); color: var(--ink-dim, #9aa0ad);
}
.usage-pill.warn {
  border-color: var(--warn, #e6b450);
  color: var(--warn, #e6b450);
}
.bar {
  display: inline-block; width: 36px; height: 4px; border-radius: 999px;
  background: var(--line, #262a36); overflow: hidden;
}
.bar-fill {
  display: block; height: 100%; border-radius: 999px;
  background: var(--accent, #5b7cfa);
}
.usage-pill.warn .bar-fill { background: var(--warn, #e6b450); }
.pill-text { white-space: nowrap; }
.usage-card {
  margin-top: 6px; max-width: 280px;
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px; padding: 8px 10px;
}
.headline { font-size: 13px; color: var(--ink, #e6e8ee); }
.pct { font-size: 12px; color: var(--ink-dim, #9aa0ad); margin-top: 2px; }
.detail { font-size: 11px; color: var(--ink-faint, #6b7180); margin-top: 4px; }
.reassure { font-size: 11px; color: var(--ink-faint, #6b7180); margin-top: 6px; }
</style>
