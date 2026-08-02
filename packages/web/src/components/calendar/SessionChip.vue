<script setup lang="ts">
import { computed } from "vue";
import { templateColor } from "../../lib/template-color.js";

const props = defineProps<{ templateName: string }>();

/**
 * Compact label for the chip: first 4 characters of the template name, or
 * the whole name when it's already short enough. Matches the mock pattern
 * (e.g. "PUSH A" → "PUSH"). Whitespace at the boundary is trimmed so a
 * trailing space doesn't sit awkwardly inside the colored chip.
 */
const label = computed(() => {
  const n = props.templateName.trim();
  if (n.length <= 4) return n;
  return n.slice(0, 4).trimEnd();
});
</script>

<template>
  <span
    class="session-chip"
    :style="{ backgroundColor: templateColor(templateName) }"
    :title="templateName"
  >{{ label }}</span>
</template>

<style scoped>
.session-chip {
  align-self: flex-start;
  height: 11px;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
  /* Chip background is bright; pin a dark ink color for legibility regardless
     of theme variable values. Matches the mock's `#0c1018`. */
  color: #0c1018;
  font-weight: 700;
  line-height: 11px;
  white-space: nowrap;
}
</style>
