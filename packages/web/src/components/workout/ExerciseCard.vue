<script setup lang="ts">
import { computed } from "vue";
import type { ActiveExercise, TemplateBaseline } from "../../lib/active-workout-types.js";
import { type UnitSystem, weightUnitLabel } from "../../lib/units.js";
import SetRow from "./SetRow.vue";

const props = defineProps<{
  exercise: ActiveExercise;
  /** Null when the exercise was added mid-session (no baseline planned values). */
  templateItem: TemplateBaseline["exercises"][number] | null;
  unitSystem: UnitSystem;
  /**
   * Position in the ActiveView list. Drives even/odd background alternation so
   * the eye can track exercise boundaries without leaning on the header alone.
   * Defaults to 0 so existing call sites (and tests) don't need to thread it
   * just to get a sensible look.
   */
  index?: number;
  isMobile?: boolean;
}>();

const weightLabel = computed(() => weightUnitLabel(props.unitSystem));

const isOdd = computed(() => (props.index ?? 0) % 2 === 1);

const emit = defineEmits<{
  (e: "tick", client_id: string, set_number: number): void;
  (
    e: "edit",
    client_id: string,
    set_number: number,
    patch: { reps?: number; weight_kg?: number | null },
  ): void;
  (e: "addSet", client_id: string): void;
  (e: "skip", client_id: string): void;
}>();

function onTick(set_number: number) {
  emit("tick", props.exercise.client_id, set_number);
}

function onEdit(set_number: number, patch: { reps?: number; weight_kg?: number | null }) {
  emit("edit", props.exercise.client_id, set_number, patch);
}

function onAddSet() {
  emit("addSet", props.exercise.client_id);
}

function onSkip() {
  emit("skip", props.exercise.client_id);
}
</script>

<template>
  <section
    class="exercise-card"
    :class="[isOdd ? 'card-odd' : 'card-even', { 'is-skipped': exercise.skipped }]"
    :data-test="'exercise-card'"
  >
    <header class="head">
      <div class="title-row">
        <h4 class="name">{{ exercise.name }}</h4>
        <span
          v-if="exercise.added_mid_session"
          class="badge badge-added"
          data-test="added-badge"
        >added</span>
      </div>
      <button
        type="button"
        class="skip-toggle"
        data-test="skip-toggle"
        @click="onSkip"
      >
        {{ exercise.skipped ? "skipped" : "skip" }}
      </button>
    </header>

    <table v-if="!isMobile" class="sets">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-planned">planned</th>
          <th class="col-reps">reps</th>
          <th class="col-weight">{{ weightLabel }}</th>
          <th class="col-check"></th>
        </tr>
      </thead>
      <tbody>
        <SetRow
          v-for="set in exercise.sets"
          :key="set.set_number"
          :set="set"
          :planned-reps="templateItem?.default_reps ?? null"
          :planned-weight-kg="templateItem?.default_weight_kg ?? null"
          :unit-system="unitSystem"
          @tick="onTick"
          @edit="onEdit"
        />
      </tbody>
    </table>
    <div v-else class="sets-mobile">
      <SetRow
        v-for="set in exercise.sets"
        :key="set.set_number"
        :set="set"
        :planned-reps="templateItem?.default_reps ?? null"
        :planned-weight-kg="templateItem?.default_weight_kg ?? null"
        :unit-system="unitSystem"
        :is-mobile="true"
        @tick="onTick"
        @edit="onEdit"
      />
    </div>

    <button
      type="button"
      class="add-set"
      data-test="add-set"
      @click="onAddSet"
    >
      + Add set
    </button>
  </section>
</template>

<style scoped>
.exercise-card {
  border: 1px solid var(--line-1, #262a36);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* Alternating shades give the eye a rhythm so consecutive exercise cards
 * don't blur into one slab. The two values are picked close enough that
 * neither reads as a state — just texture. */
.exercise-card.card-even {
  background: var(--surface-1, #161922);
}
.exercise-card.card-odd {
  background: #1a1d28;
}
.exercise-card.is-skipped {
  opacity: 0.55;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--accent-soft, #2a3556);
  color: var(--accent, #4a7dff);
}
.skip-toggle {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}
.sets {
  width: 100%;
  border-collapse: collapse;
}
.sets th {
  text-align: left;
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-faint, #9aa0ad);
  padding: 2px 4px;
}
.col-num { width: 28px; }
.col-check { width: 32px; }
.add-set {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.add-set:hover {
  border-color: var(--accent, #4a7dff);
  color: var(--accent, #4a7dff);
}
.sets-mobile {
  display: flex;
  flex-direction: column;
}
@media (max-width: 768px) {
  .exercise-card {
    padding: 10px 10px;
    border-radius: 8px;
  }
}
</style>
