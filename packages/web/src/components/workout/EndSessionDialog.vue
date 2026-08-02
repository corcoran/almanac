<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import type { Divergence } from "../../lib/divergence-diff.js";
import { kgToDisplayWeight, type UnitSystem, weightUnitLabel } from "../../lib/units.js";

const props = withDefaults(
  defineProps<{
    divergences: Divergence[];
    /** ISO datetime from active.started_at — used to seed the duration input. */
    startedAt: string;
    submitting?: boolean;
    /** Display unit for divergence weights. Defaults to metric. */
    unitSystem?: UnitSystem;
  }>(),
  { unitSystem: "metric" },
);

// A11y: stable id wired from aria-labelledby on the dialog root to the
// visible title element. Auto-focus the dialog root on mount so the
// Escape keydown handler is reachable without a prior click.
const titleId = useId();
const durationId = useId();
const dialogRef = ref<HTMLDivElement | null>(null);
onMounted(() => dialogRef.value?.focus());

const emit = defineEmits<{
  (
    e: "confirm",
    payload:
      | { saveChoice: "all"; duration_min: number }
      | { saveChoice: "selected"; selected_ids: number[]; duration_min: number }
      | { saveChoice: "none"; duration_min: number },
  ): void;
  (e: "cancel"): void;
}>();

const picking = ref(false);
const selected = ref<Set<number>>(new Set());

// Seed the duration input from started_at at mount time. Held as a string
// to match the native <input type="number"> binding; coerced back to int on
// emit. Clamped to a min of 1 because CreateWorkoutBodySchema requires a
// positive int, and "just started" sessions would otherwise round to 0.
function seedDuration(startedAt: string): number {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 1;
  const elapsedMin = Math.round((Date.now() - started) / 60_000);
  return Math.max(1, elapsedMin);
}
const durationMin = ref<string>(String(seedDuration(props.startedAt)));

function currentDuration(): number {
  // Whatever the user typed; clamp to 1 to satisfy the positive-int server
  // schema even if they delete the field or type 0.
  const n = Math.round(Number(durationMin.value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function divKey(d: Divergence): number {
  // Each divergence is keyed by its exercise_id; the diff guarantees one
  // divergence per (exercise_id, kind) but within the dialog the selection
  // unit is "the exercise", which is exactly what filterChosenDivergences
  // matches on in the store.
  return d.exercise_id;
}

function divName(d: Divergence): string {
  return d.kind === "added_exercise" ? d.name : d.exercise_name;
}

// Format a kg weight in the user's display unit with a label, or "—" when null
// (bodyweight / not recorded — no unit shown for the placeholder).
function fmtWeight(kg: number | null): string {
  const display = kgToDisplayWeight(kg, props.unitSystem);
  return display === null ? "—" : `${display} ${weightUnitLabel(props.unitSystem)}`;
}

function divSummary(d: Divergence): string {
  if (d.kind === "set_changes") {
    const reps = d.new_default_reps ?? "—";
    return `reps/load → ${reps} × ${fmtWeight(d.new_default_weight_kg)}`;
  }
  if (d.kind === "added_sets") {
    return `sets ${d.old_planned_sets} → ${d.new_planned_sets}`;
  }
  return `added: ${d.planned_sets} × ${d.default_reps ?? "—"} @ ${fmtWeight(d.default_weight_kg)}`;
}

function toggle(id: number, checked: boolean) {
  if (checked) selected.value.add(id);
  else selected.value.delete(id);
}

const selectedIds = computed(() =>
  // Preserve the order in which the divergences appear in the prop list so
  // the emitted ids match the visible row order; that makes test
  // assertions order-stable without sorting.
  props.divergences.map(divKey).filter((id) => selected.value.has(id)),
);

function onSaveAll() {
  emit("confirm", { saveChoice: "all", duration_min: currentDuration() });
}

function onSaveSelected() {
  emit("confirm", {
    saveChoice: "selected",
    selected_ids: selectedIds.value,
    duration_min: currentDuration(),
  });
}

function onSaveNone() {
  emit("confirm", { saveChoice: "none", duration_min: currentDuration() });
}

function onSubmitEmpty() {
  emit("confirm", { saveChoice: "none", duration_min: currentDuration() });
}

function onCancel() {
  emit("cancel");
}

function formatKind(kind: Divergence["kind"]): string {
  switch (kind) {
    case "set_changes":
      return "updated";
    case "added_sets":
      return "more sets";
    case "added_exercise":
      return "new exercise";
    default: {
      // Exhaustive-safe: TypeScript narrows `kind` to `never` here.
      const _exhaustive: never = kind;
      return String(_exhaustive);
    }
  }
}
</script>

<template>
  <div
    ref="dialogRef"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    tabindex="-1"
    data-test="end-session-dialog"
    @keydown.esc="onCancel"
  >
    <div class="modal">
      <template v-if="divergences.length === 0">
        <h3 :id="titleId" class="title">End workout</h3>
        <div class="duration-row">
          <label :for="durationId">Duration (min)</label>
          <input
            :id="durationId"
            v-model="durationMin"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            data-test="duration-min-input"
          />
        </div>
        <div class="actions">
          <button
            type="button"
            class="primary"
            data-test="submit-empty"
            :disabled="submitting"
            @click="onSubmitEmpty"
          >
            {{ submitting ? "Saving…" : "End workout" }}
          </button>
          <button type="button" class="ghost" data-test="cancel" :disabled="submitting" @click="onCancel">
            Cancel
          </button>
        </div>
      </template>

      <template v-else>
        <h3 :id="titleId" class="title">Save changes to template?</h3>
        <ul class="div-list">
          <li
            v-for="d in divergences"
            :key="`${d.kind}-${divKey(d)}`"
            class="div-row"
            data-test="divergence-row"
          >
            <label class="div-label">
              <input
                v-if="picking"
                type="checkbox"
                data-test="divergence-check"
                @change="toggle(divKey(d), ($event.target as HTMLInputElement).checked)"
              />
              <span class="div-kind">{{ formatKind(d.kind) }}</span>
              <span class="div-name">{{ divName(d) }}</span>
              <span class="div-summary">{{ divSummary(d) }}</span>
            </label>
          </li>
        </ul>

        <div class="duration-row">
          <label :for="durationId">Duration (min)</label>
          <input
            :id="durationId"
            v-model="durationMin"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            data-test="duration-min-input"
          />
        </div>

        <div class="actions">
          <button
            v-if="!picking"
            type="button"
            class="primary"
            data-test="save-all"
            :disabled="submitting"
            @click="onSaveAll"
          >
            {{ submitting ? "Saving…" : "Save all" }}
          </button>
          <button
            v-if="!picking"
            type="button"
            class="ghost"
            data-test="pick-which"
            :disabled="submitting"
            @click="picking = true"
          >
            Pick which to save
          </button>
          <button
            v-if="picking"
            type="button"
            class="primary"
            data-test="save-selected"
            :disabled="submitting"
            @click="onSaveSelected"
          >
            {{ submitting ? "Saving…" : "Save selected" }}
          </button>
          <button
            type="button"
            class="ghost"
            data-test="save-none"
            :disabled="submitting"
            @click="onSaveNone"
          >
            Don't save
          </button>
          <button type="button" class="ghost" data-test="cancel" :disabled="submitting" @click="onCancel">
            Cancel
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-1, #262a36);
  border-radius: 10px;
  padding: 20px 22px;
  min-width: 380px;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.div-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 260px;
  overflow-y: auto;
}
.div-row {
  padding: 6px 8px;
  border: 1px solid var(--line-1, #262a36);
  border-radius: 6px;
  background: var(--surface-2, #1f2330);
}
.div-label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  cursor: pointer;
}
.div-kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent, #4a7dff);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--accent-soft, #2a3556);
}
.div-name {
  font-weight: 500;
}
.div-summary {
  color: var(--ink-faint, #9aa0ad);
  margin-left: auto;
}
.duration-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-faint, #9aa0ad);
}
.duration-row input {
  width: 70px;
  padding: 5px 8px;
  font-size: 13px;
  background: var(--surface-2, #1f2330);
  color: inherit;
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 5px;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
.ghost {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}

@media (max-width: 768px) {
  .modal {
    min-width: 0;
    max-width: none;
    width: calc(100vw - 32px);
    margin: 16px;
  }
}
</style>
