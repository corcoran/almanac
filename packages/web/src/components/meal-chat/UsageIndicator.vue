<script setup lang="ts">
import type { DailyBalanceSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";

type Balance = z.infer<typeof DailyBalanceSchema>;

const props = defineProps<{ balance: Balance | null }>();

const expanded = ref(false);

// Only render when we have a balance with a configured soft limit. The hard cap
// is deliberately NOT surfaced: it exists to stop runaway spend, not to be
// planned around, and naming it turns the card into a second budget readout.
const show = computed(() => props.balance !== null && props.balance.softLimit !== null);

// Past the soft limit the counter stops meaning anything, so say that rather
// than freezing at "~0 logs left".
const meter = computed(() => {
  const b = props.balance;
  if (!b) return null;
  if (!b.overSoftLimit && b.softLimit !== null && b.logsLeftEstimate !== null) {
    return { basis: "soft" as const, count: b.logsLeftEstimate, pct: b.pctRemaining ?? 0 };
  }
  return { basis: "none" as const, count: 0, pct: 0 };
});

// "Running low": over the soft limit, OR ≤30% of the daily balance left, OR ≤2
// logs left. The 30% gives early warning at normal/large limits; the ≤2-logs
// floor guarantees a heads-up even at small limits, where 30% is barely a
// message wide. The hard tier never contributes.
const low = computed(() => {
  const b = props.balance;
  if (!b) return false;
  if (b.overSoftLimit) return true;
  if (b.pctRemaining !== null && b.pctRemaining <= 30) return true;
  return b.logsLeftEstimate !== null && b.logsLeftEstimate <= 2;
});

const pct = computed(() => meter.value?.pct ?? 0);

const avgK = computed(() => ((props.balance?.avgTokensPerLog ?? 0) / 1000).toFixed(1));

// Tokens used of the daily budget — base-consistent, unlike the old
// callsToday-of-implied-logs framing (mixed bases, could read "8 of 7").
const usedK = computed(() => ((props.balance?.tokensUsed ?? 0) / 1000).toFixed(1));
const budgetK = computed(() => Math.round((props.balance?.softLimit ?? 0) / 1000));

// Past the soft limit "60.0k of 50k tokens used" reads as a contradiction.
// State the overage instead.
const overK = computed(() => {
  const b = props.balance;
  if (!b || b.softLimit === null) return "0.0";
  return ((b.tokensUsed - b.softLimit) / 1000).toFixed(1);
});
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
      <span v-if="meter?.basis === 'soft'" class="pill-text">~{{ meter.count }} logs left</span>
      <span v-else class="pill-text">over budget</span>
    </button>

    <div v-if="expanded" class="usage-card" data-test="usage-card">
      <div v-if="meter?.basis === 'soft'" class="headline">~{{ meter.count }} logs left today</div>
      <div v-else class="headline">Over your daily budget</div>

      <div v-if="meter?.basis === 'soft'" class="pct">{{ pct }}% of daily balance</div>

      <div class="detail">
        <template v-if="balance.overSoftLimit">{{ overK }}k over your {{ budgetK }}k budget</template>
        <template v-else>{{ usedK }}k of {{ budgetK }}k tokens used</template>
        · avg ~{{ avgK }}k tokens/log · resets at {{ balance.resetsAt }}
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
