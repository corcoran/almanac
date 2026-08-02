<script setup lang="ts">
import type { AccomplishmentsResponseSchema } from "@almanac/core/schemas";
import { computed } from "vue";
import type { z } from "zod";
import {
  ACCOMPLISHMENT_ICON,
  ACCOMPLISHMENT_ICON_FALLBACK,
} from "../../lib/accomplishment-icons.js";
import { formatAccomplishmentValue, type UnitSystem } from "../../lib/units.js";

type Wins = z.infer<typeof AccomplishmentsResponseSchema>;

const props = withDefaults(
  defineProps<{
    data: Wins | null;
    today?: string;
    /** Display unit for weight-bearing prior_best values. Defaults to metric. */
    unitSystem?: UnitSystem;
  }>(),
  { unitSystem: "metric" },
);

type Row = {
  icon: string;
  message: string;
  prior: string | null;
  when: string | null;
};

// Whole days between two YYYY-MM-DD strings (toIso - fromIso), UTC-anchored
// string math (both args are already user-local calendar dates).
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function relativeDay(earnedOn: string, today: string): string | null {
  if (today === "") return null; // no reference day → hide the label
  const d = daysBetween(earnedOn, today);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} days ago`;
}

const rows = computed<Row[]>(() => {
  const accomplishments = props.data?.accomplishments ?? [];
  const today = props.today ?? "";
  return accomplishments.map((w) => ({
    icon: ACCOMPLISHMENT_ICON[w.code] ?? ACCOMPLISHMENT_ICON_FALLBACK,
    message: w.message,
    prior:
      w.prior_best !== null
        ? `prev best ${formatAccomplishmentValue(w.code, w.prior_best.value, props.unitSystem)} (${w.prior_best.earned_on})`
        : null,
    when: relativeDay(w.earned_on, today),
  }));
});

const hasWins = computed(() => rows.value.length > 0);
</script>

<template>
  <div v-if="hasWins" data-test="wins-summary" class="wins-summary">
    <div class="wins-label">★ Wins</div>
    <div class="wins-card">
      <div v-for="(row, i) in rows" :key="i" class="wins-row">
        <span class="wins-icon" aria-hidden="true">{{ row.icon }}</span>
        <span class="wins-text">
          {{ row.message }}
          <span v-if="row.prior !== null" class="wins-prior"> · {{ row.prior }}</span>
          <span v-if="row.when !== null" class="wins-when"> · {{ row.when }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wins-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wins-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6ee7a8;
  font-weight: 600;
}
.wins-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #1f3a2a;
  border-radius: 8px;
  background: #121b15;
  overflow: hidden;
}
.wins-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.wins-row + .wins-row {
  border-top: 1px solid #1f3a2a;
}
.wins-icon {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.wins-text {
  color: #d7e6dc;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}
.wins-prior {
  color: #6b8b76;
  font-weight: 400;
  font-size: 12px;
}
.wins-when {
  color: #6b8b76;
  font-weight: 400;
  font-size: 12px;
}
</style>
