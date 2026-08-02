<script setup lang="ts">
import { templateColor } from "../../lib/template-color.js";

type Phase = "too_soon" | "acceptable" | "prime" | "in_window";

defineProps<{
  templateName: string;
  phase: Phase;
  isProposed: boolean;
}>();
</script>

<template>
  <div
    class="pill"
    :class="phase"
    :style="{ '--pill-color': templateColor(templateName) }"
  >
    <span v-if="isProposed" class="star">★</span>
  </div>
</template>

<style scoped>
.pill {
  height: var(--pill-h, 5px);
  width: 100%;
  border-radius: 3px;
  position: relative;
  background-color: var(--pill-color);
}
/* Phases mirror the mock's "outline / faded / solid / slightly-faded" contract
   (spec §2 Q9). too_soon is qualitatively distinct — transparent fill + dashed
   outline — so it never reads as just "a paler version of acceptable". The
   other three phases share the solid fill and differ only in opacity. */
.pill.too_soon {
  background-color: transparent;
  border: 1px dashed var(--pill-color);
  opacity: 0.7;
}
.pill.acceptable { opacity: 0.6; }
.pill.prime { opacity: 1; }
.pill.in_window { opacity: 0.75; }

.pill .star {
  position: absolute;
  top: -7px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.6);
  line-height: 1;
  pointer-events: none;
}
</style>
