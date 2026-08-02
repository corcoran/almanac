<script setup lang="ts">
import { computed } from "vue";
import type { ActiveSet } from "../../lib/active-workout-types.js";
import { displayWeightToKg, kgToDisplayWeight, type UnitSystem } from "../../lib/units.js";
import { weightColor } from "../../lib/weight-color.js";

const props = defineProps<{
  set: ActiveSet;
  plannedReps: number | null;
  plannedWeightKg: number | null;
  unitSystem: UnitSystem;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: "tick", set_number: number): void;
  (e: "edit", set_number: number, patch: { reps?: number; weight_kg?: number | null }): void;
}>();

const displayWeight = computed(() => kgToDisplayWeight(props.set.weight_kg, props.unitSystem));
const displayPlannedWeight = computed(() =>
  kgToDisplayWeight(props.plannedWeightKg, props.unitSystem),
);

// Color the planned-reference weight number the same way LastSessionPanel
// does. Same weight kg always maps to the same hue, so "80kg" reads the
// same color whether you see it on the recent-session card or the active
// set row. Editable inputs stay default-colored — color there would just
// be noise while typing.
const plannedWeightStyle = computed(() => ({
  color: weightColor(props.plannedWeightKg),
}));

function onRepsInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit("edit", props.set.set_number, { reps: Number(value) });
}

function onWeightInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (value === "") {
    emit("edit", props.set.set_number, { weight_kg: null });
    return;
  }
  const n = Number(value);
  // Convert the typed (display-unit) value back to canonical kg before
  // emitting upstream — the store and server only ever see kg.
  emit("edit", props.set.set_number, {
    weight_kg: Number.isFinite(n) ? displayWeightToKg(n, props.unitSystem) : null,
  });
}
</script>

<template>
  <tr v-if="!isMobile" :class="['set-row', { 'done-row': set.done, 'is-done': set.done }]">
    <td><span class="set-num">{{ set.set_number }}</span></td>
    <td>
      <span class="planned">
        <span class="planned-reps">{{ plannedReps ?? "—" }}</span>
        <span class="planned-x"> × </span>
        <span class="planned-weight" :style="plannedWeightStyle">{{ displayPlannedWeight ?? "—" }}</span>
      </span>
    </td>
    <td>
      <input data-test="set-reps" class="input" type="text" inputmode="numeric" pattern="[0-9]*" :value="set.reps" @input="onRepsInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
    </td>
    <td>
      <input data-test="set-weight" class="input" type="text" inputmode="decimal" pattern="[0-9]*\.?[0-9]*" :value="displayWeight ?? ''" @input="onWeightInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
    </td>
    <td>
      <button data-test="set-check" :class="['check', { done: set.done }]" @click="emit('tick', set.set_number)">{{ set.done ? '✓' : '○' }}</button>
    </td>
  </tr>
  <div v-else :class="['set-row-mobile', { 'is-done': set.done }]">
    <span class="planned-mobile">{{ plannedReps ?? '—' }} × {{ displayPlannedWeight ?? '—' }}</span>
    <div class="input-row-mobile">
      <input data-test="set-reps" class="input input-mobile" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="reps" :value="set.reps" @input="onRepsInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
      <input data-test="set-weight" class="input input-mobile" type="text" inputmode="decimal" pattern="[0-9]*\.?[0-9]*" placeholder="weight" :value="displayWeight ?? ''" @input="onWeightInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
      <button data-test="set-check" :class="['check check-mobile', { done: set.done }]" @click="emit('tick', set.set_number)">{{ set.done ? '✓' : '○' }}</button>
    </div>
  </div>
</template>

<style scoped>
.input {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 4px;
  padding: 3px 6px;
  width: 56px;
  text-align: right;
  font: inherit;
}
.check {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1.5px solid var(--line-2, #353a4a);
  background: transparent;
  cursor: pointer;
}
.check.done {
  background: var(--good, #4cc38a);
  color: #0c1018;
}
.done-row td {
  color: var(--ink-faint, #6b7180);
}
/* Subtle reinforcement that a set is done — the ✓ button already signals
 * state, this just nudges the eye past completed rows. Very faint green
 * tint matches the check button's --good color family, and the input text
 * fades to ink-dim so finished numbers stop competing for attention. */
.set-row.is-done {
  background: rgba(76, 195, 138, 0.05);
}
.set-row.is-done .input {
  color: var(--ink-dim, #9aa0ad);
}
.planned {
  font-variant-numeric: tabular-nums;
}
.planned-x {
  color: var(--ink-faint, #6b7180);
}
.set-row-mobile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
  border-bottom: 1px solid var(--line-1, #262a36);
}
.set-row-mobile.is-done {
  background: rgba(76, 195, 138, 0.05);
}
.planned-mobile {
  font-size: 10px;
  color: var(--ink-faint, #6b7180);
  font-variant-numeric: tabular-nums;
}
.input-row-mobile {
  display: flex;
  gap: 6px;
  align-items: center;
}
.input-mobile {
  flex: 1 1 0;
  min-width: 0;
  min-height: 36px;
  font-size: 15px;
  padding: 6px 8px;
  width: 0;
}
.check-mobile {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  font-size: 16px;
}
</style>
