<script setup lang="ts">
import { computed } from "vue";
import { ringFillFraction, ringLabel } from "../../lib/macro-progress.js";

const props = defineProps<{ target: number; intake: number }>();

// SVG geometry: r=40 in a 92x92 box, 8px stroke. Circumference = 2πr.
const R = 40;
const CIRC = 2 * Math.PI * R;

const fraction = computed(() => ringFillFraction(props.intake, props.target));
const dashOffset = computed(() => CIRC * (1 - fraction.value));
const label = computed(() => ringLabel(props.target, props.intake));

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r.toString();
}
</script>

<template>
  <div class="ring">
    <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
      <circle class="track" cx="46" cy="46" r="40" fill="none" stroke-width="8" />
      <circle
        class="arc"
        data-test="ring-arc"
        cx="46"
        cy="46"
        r="40"
        fill="none"
        stroke-width="8"
        stroke-linecap="round"
        :stroke-dasharray="CIRC"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 46 46)"
      />
    </svg>
    <div class="ctr">
      <span class="n" data-test="ring-number">{{ fmt(label.magnitude) }}</span>
      <span class="u" data-test="ring-unit">kcal {{ label.word }}</span>
    </div>
  </div>
</template>

<style scoped>
.ring { position: relative; width: 92px; height: 92px; flex: 0 0 auto; }
.track { stroke: #22262f; }
/* Ring is always the kcal token — never red, even when over. */
.arc { stroke: var(--m-kcal, #d8b4fe); }
.ctr {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.ctr .n {
  font-size: 23px; font-weight: 700; line-height: 1;
  color: var(--m-kcal, #d8b4fe); font-variant-numeric: tabular-nums;
}
.ctr .u {
  font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px;
  margin-top: 3px; color: var(--ink-dim, #9aa0ad);
}
</style>
