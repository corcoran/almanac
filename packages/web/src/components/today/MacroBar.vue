<script setup lang="ts">
import { computed } from "vue";
import { macroFillFraction, remainingLabel } from "../../lib/macro-progress.js";

const props = defineProps<{
  name: string;
  macro: "protein" | "carb" | "fat";
  target: number;
  intake: number;
}>();

const fillPct = computed(() => `${macroFillFraction(props.intake, props.target) * 100}%`);
const label = computed(() => remainingLabel(props.target, props.intake));

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r.toString();
}
</script>

<template>
  <div class="bar-row">
    <div class="bar-head">
      <span class="nm">{{ name }}</span>
      <span class="vl" data-test="macro-value">
        <b :class="macro">{{ fmt(label.magnitude) }}</b> g {{ label.word }}
      </span>
    </div>
    <div class="bar-track">
      <div class="bar-fill" :class="macro" :style="{ width: fillPct }"></div>
    </div>
  </div>
</template>

<style scoped>
.bar-head {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 11px; margin-bottom: 3px;
}
.bar-head .nm { color: var(--ink-dim, #9aa0ad); }
.bar-head .vl { color: var(--ink-faint, #6b7180); font-size: 10px; font-variant-numeric: tabular-nums; }
.bar-head .vl b { font-weight: 700; }
.bar-track { height: 7px; background: #22262f; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; }
/* Own macro color, always — over-ness is in the label word, not color. */
.protein { color: var(--m-protein, #6ee7a8); }
.carb { color: var(--m-carb, #f5c25a); }
.fat { color: var(--m-fat, #f08a8a); }
.bar-fill.protein { background: var(--m-protein, #6ee7a8); }
.bar-fill.carb { background: var(--m-carb, #f5c25a); }
.bar-fill.fat { background: var(--m-fat, #f08a8a); }
</style>
