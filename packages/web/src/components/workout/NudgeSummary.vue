<script setup lang="ts">
import type { NextBestActionResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";

type NextBestAction = z.infer<typeof NextBestActionResponseSchema>;
type Action = NextBestAction["actions"][number];
type Severity = "concern" | "warn" | "info" | "none";

const props = defineProps<{
  data: NextBestAction | null;
}>();

const expanded = ref(false);

// All-clear when there's no actionable headline. Exhaustive: by the API
// contract `headline` is always `actions[0]`, so `all_clear === false` with
// an empty `actions` array still yields a null headline — covered here.
const isAllClear = computed(
  () => props.data === null || props.data.all_clear || props.data.headline === null,
);

// Non-null only when we have an action to show. The template's `v-else-if`
// on this is the single non-null gate for `headline.title`.
const headline = computed<Action | null>(() => {
  if (props.data === null || props.data.all_clear) return null;
  return props.data.headline;
});

// Everything past the headline. Gated on `headline` being non-null so the
// "no orphan +N more" invariant is structural, not branch-incidental.
const extras = computed<Action[]>(() =>
  headline.value === null ? [] : (props.data?.actions.slice(1) ?? []),
);

const moreCount = computed(() => extras.value.length);

function severityOf(a: Action): Severity {
  if (a.severity === "concern") return "concern";
  if (a.severity === "warn") return "warn";
  if (a.severity === "info") return "info";
  return "none";
}

function toggle() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div v-if="data !== null" data-test="nudge-summary" class="nudge-summary">
    <div v-if="isAllClear" class="nudge-row nudge-row--clear">
      <span class="nudge-icon" data-test="nudge-icon" data-severity="clear" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <span class="nudge-text">Ready to train</span>
    </div>

    <div v-else-if="headline" class="nudge-card">
      <div
        class="nudge-row nudge-row--head"
        :class="{ 'is-button': moreCount > 0 }"
        :role="moreCount > 0 ? 'button' : undefined"
        :tabindex="moreCount > 0 ? 0 : undefined"
        :aria-expanded="moreCount > 0 ? expanded : undefined"
        :data-test="moreCount > 0 ? 'nudge-expand' : undefined"
        @click="moreCount > 0 && toggle()"
        @keydown.enter.prevent="moreCount > 0 && toggle()"
        @keydown.space.prevent="moreCount > 0 && toggle()"
      >
        <span
          class="nudge-icon"
          data-test="nudge-icon"
          :data-severity="severityOf(headline)"
          aria-hidden="true"
        >
          <span class="nudge-glyph"></span>
        </span>
        <span class="nudge-text">{{ headline.title }}</span>
        <span v-if="moreCount > 0" class="nudge-more">+{{ moreCount }} more</span>
        <span
          v-if="moreCount > 0"
          class="nudge-chevron"
          :class="{ expanded }"
          aria-hidden="true"
        >›</span>
      </div>

      <ul v-if="expanded && moreCount > 0" class="nudge-body" data-test="nudge-body">
        <li v-for="(a, i) in extras" :key="i" class="nudge-row nudge-row--extra">
          <span class="nudge-icon" :data-severity="severityOf(a)" aria-hidden="true">
            <span class="nudge-glyph"></span>
          </span>
          <span class="nudge-text nudge-text--extra">{{ a.title }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.nudge-summary {
  display: flex;
  flex-direction: column;
}
.nudge-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #262a36;
  border-radius: 8px;
  background: #161922;
  overflow: hidden;
}
.nudge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}
.nudge-row--clear {
  border: 1px solid #262a36;
  border-radius: 8px;
  background: #161922;
}
.nudge-row--head.is-button {
  cursor: pointer;
  user-select: none;
}
.nudge-row--extra {
  padding: 9px 12px 9px 14px;
  border-top: 1px solid #262a36;
}
.nudge-icon {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  font-size: 14px;
}
.nudge-row--clear .nudge-icon { color: #6ee7a8; }
.nudge-icon[data-severity="concern"] { color: #f08a8a; }
.nudge-icon[data-severity="warn"] { color: #f5c25a; }
.nudge-icon[data-severity="info"] { color: #9aa0ad; }
.nudge-icon[data-severity="none"] { color: #6b7180; }
.nudge-glyph::before { content: "•"; }
.nudge-icon[data-severity="concern"] .nudge-glyph::before { content: "⊘"; }
.nudge-icon[data-severity="warn"] .nudge-glyph::before { content: "△"; }
.nudge-icon[data-severity="info"] .nudge-glyph::before { content: "ⓘ"; }
.nudge-text {
  color: #e6e8ee;
  font-size: 13px;
  font-weight: 500;
  flex: 1;
}
.nudge-text--extra {
  color: #c8ccd6;
  font-weight: 400;
  font-size: 12px;
}
.nudge-more {
  color: #6b7180;
  font-size: 11px;
}
.nudge-chevron {
  color: #9aa0ad;
  font-size: 16px;
  line-height: 1;
  display: inline-block;
  transition: transform 120ms ease;
}
.nudge-chevron.expanded {
  transform: rotate(90deg);
}
</style>
