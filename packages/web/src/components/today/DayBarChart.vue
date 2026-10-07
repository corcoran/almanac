<script lang="ts">
export type ChartBar = {
  /** Emitted on click; also matched against `editingKey`. */
  key: string;
  /** False renders a dashed ghost slot (no value, fixed short height). */
  logged: boolean;
  heightPct: number;
  color?: string;
  valueLabel?: string;
  /** Short weekday under the bar. */
  dayLabel: string;
  ariaLabel: string;
  highlighted: boolean;
  classes?: string[];
};
</script>

<script setup lang="ts">
defineProps<{
  /** Prefix for data-test hooks: `<testId>-bar`, `<testId>-ghost`, `<testId>-bar-value`, `<testId>-reference`. */
  testId: string;
  bars: ChartBar[];
  editingKey: string | null;
  reference?: { pct: number; label: string } | null;
}>();

const emit = defineEmits<(e: "select", key: string) => void>();
</script>

<template>
  <div class="day-bars">
    <div
      v-if="reference"
      class="reference"
      :data-test="`${testId}-reference`"
      :style="{ bottom: `${reference.pct}%` }"
    >{{ reference.label }}</div>
    <template v-for="bar in bars" :key="bar.key">
      <button
        v-if="bar.logged"
        type="button"
        class="bar"
        :class="[
          ...(bar.classes ?? []),
          {
            target: bar.highlighted,
            editing: bar.key === editingKey,
            'tiny-bar': bar.heightPct < 25,
          },
        ]"
        :style="{ height: `${bar.heightPct}%`, backgroundColor: bar.color }"
        :aria-label="bar.ariaLabel"
        :data-test="`${testId}-bar`"
        @click="emit('select', bar.key)"
      >
        <span class="bar-value" :data-test="`${testId}-bar-value`">{{ bar.valueLabel }}</span>
        <span class="lbl">{{ bar.dayLabel }}</span>
      </button>
      <button
        v-else
        type="button"
        class="bar ghost"
        :class="{ target: bar.highlighted, editing: bar.key === editingKey }"
        :aria-label="bar.ariaLabel"
        :data-test="`${testId}-ghost`"
        @click="emit('select', bar.key)"
      >
        <span class="lbl">{{ bar.dayLabel }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.day-bars {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  height: 60px;
  margin-top: 8px;
  padding-bottom: 14px;
}
.bar {
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  background: var(--line-2, #2a2f3d);
  border-radius: 2px;
  align-self: end;
  position: relative;
}
.bar:hover { filter: brightness(1.15); }
.bar.editing { outline: 2px solid var(--ink, #e6e8ee); outline-offset: 1px; }
.bar.ghost {
  height: 14%;
  background: transparent;
  border: 1px dashed var(--line-2, #2a2f3d);
  opacity: 0.55;
}
.bar.ghost.target {
  border-color: var(--ink-dim, #9aa0ad);
  opacity: 0.9;
}
.lbl {
  position: absolute;
  bottom: -14px;
  left: 0;
  right: 0;
  text-align: center;
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
}
.bar-value {
  position: absolute;
  top: 2px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
  line-height: 1;
  pointer-events: none;
}
.bar.target .bar-value { color: #10141c; }
.bar.tiny-bar .bar-value {
  /* Bars too thin for the label to sit inside — float it above instead. */
  top: -12px;
  color: var(--ink-dim, #9aa0ad);
}
.reference {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed var(--line-2, #2a2f3d);
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
  padding-left: 2px;
  line-height: 0;
  pointer-events: none;
}
</style>
