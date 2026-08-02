<!-- packages/web/src/components/workout/TemplateFormModal.vue -->
<script setup lang="ts">
import { type ExerciseResponseSchema, WorkoutTemplateResponseSchema } from "@almanac/core/schemas";
import { onMounted, ref } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { type AddableExercise, useTemplateForm } from "../../composables/useTemplateForm.js";
import type { UnitSystem } from "../../lib/units.js";
import { weightUnitLabel } from "../../lib/units.js";
import ExercisePicker from "./ExercisePicker.vue";

type Exercise = z.infer<typeof ExerciseResponseSchema>;
type ExerciseGroup = { id: number; name: string };

const props = defineProps<{
  client: ApiClient;
  mode: "create" | "edit";
  unitSystem: UnitSystem;
  exercises: Exercise[];
  groups: ExerciseGroup[];
  templateId?: number;
  initialName?: string;
  initialRows?: AddableExercise[];
  initialItemDefaults?: ReadonlyArray<{ default_sets: number; default_reps: number | null }>;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "close"): void;
}>();

const form = useTemplateForm(props.unitSystem);
const pickerOpen = ref(false);
const pending = ref(false);
const error = ref<string | null>(null);

const unitLabel = weightUnitLabel(props.unitSystem);

function lookup(exerciseId: number): { name: string; groupName: string } | null {
  const ex = props.exercises.find((e) => e.id === exerciseId);
  if (!ex) return null;
  return { name: ex.name, groupName: props.groups.find((g) => g.id === ex.group_id)?.name ?? "" };
}

// Props are read once here and treated as fixed for the modal's lifetime — the
// parent remounts this component per open (no live reload of templateId/initial*).
onMounted(async () => {
  if (props.mode === "edit" && props.templateId != null) {
    try {
      const tpl = await props.client.get(
        `/v1/workout-templates/${props.templateId}`,
        WorkoutTemplateResponseSchema,
      );
      form.setFromTemplate({ name: tpl.name, items: tpl.items ?? [] }, lookup);
    } catch {
      error.value = "Couldn't load the template.";
    }
    return;
  }
  // create / preset-walkthrough prefill
  if (props.initialRows && props.initialRows.length > 0) {
    form.setFromPreset(props.initialRows, props.initialItemDefaults ?? [], props.initialName ?? "");
  } else if (props.initialName) {
    form.name.value = props.initialName;
  }
});

function addExercise(ex: AddableExercise): void {
  form.addRow(ex);
  pickerOpen.value = false;
}

async function save(): Promise<void> {
  if (form.name.value.trim() === "") {
    error.value = "Give the template a name.";
    return;
  }
  pending.value = true;
  error.value = null;
  const payload = form.buildPayload();
  try {
    if (props.mode === "create") {
      await props.client.post("/v1/workout-templates", payload, WorkoutTemplateResponseSchema);
    } else if (props.templateId != null) {
      await props.client.patch(
        `/v1/workout-templates/${props.templateId}`,
        { name: payload.name },
        WorkoutTemplateResponseSchema,
      );
      await props.client.put(
        `/v1/workout-templates/${props.templateId}/items`,
        { items: payload.items },
        WorkoutTemplateResponseSchema,
      );
    }
    emit("saved");
  } catch {
    error.value = "Couldn't save the template. Try again.";
  } finally {
    pending.value = false;
  }
}

async function archive(): Promise<void> {
  if (props.templateId == null) return;
  if (!window.confirm("Archive this template? It will no longer appear in the picker.")) return;
  pending.value = true;
  error.value = null;
  try {
    await props.client.delete(`/v1/workout-templates/${props.templateId}`, z.unknown());
    emit("saved");
  } catch {
    error.value = "Couldn't archive the template.";
  } finally {
    pending.value = false;
  }
}

// Exposed so component tests can drive the add-exercise path directly
// (the picker is normally opened by the user).
defineExpose({ addExercise });
</script>

<template>
  <div class="modal-backdrop" role="dialog" aria-modal="true" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-head">
        <h3 class="title">{{ mode === "create" ? "New template" : "Edit template" }}</h3>
        <button class="icon-btn" aria-label="Close" @click="emit('close')">✕</button>
      </div>

      <label class="field-label">Template name</label>
      <input v-model="form.name.value" data-test="template-name" class="name-input" type="text" />

      <div class="rows-head">
        <span>Exercises</span>
        <span class="rows-hint">sets × reps · weight ({{ unitLabel }})</span>
      </div>

      <div class="rows">
        <div
          v-for="(row, i) in form.rows.value"
          :key="row.key"
          class="row"
          :class="{ 'row-warn': !(Number(row.default_sets) > 0) }"
        >
          <div class="row-move">
            <button aria-label="Move up" :disabled="i === 0" @click="form.moveUp(row.key)">▲</button>
            <button
              aria-label="Move down"
              :disabled="i === form.rows.value.length - 1"
              @click="form.moveDown(row.key)"
            >
              ▼
            </button>
          </div>
          <div class="row-main">
            <div class="row-name">{{ row.exerciseName }}</div>
            <div v-if="!(Number(row.default_sets) > 0)" data-test="row-nudge" class="row-nudge">
              add sets to prescribe this lift
            </div>
            <div v-else class="row-group">{{ row.groupName }}</div>
          </div>
          <input
            v-model.number="row.default_sets"
            data-test="row-sets"
            class="num"
            type="number"
            min="0"
            aria-label="sets"
          />
          <span class="times">×</span>
          <input
            v-model.number="row.default_reps"
            data-test="row-reps"
            class="num"
            type="number"
            min="0"
            aria-label="reps"
          />
          <input
            v-model.number="row.default_weight"
            data-test="row-weight"
            class="num wide"
            type="number"
            step="0.5"
            aria-label="weight"
          />
          <button class="icon-btn" aria-label="Remove" @click="form.removeRow(row.key)">🗑</button>
        </div>
      </div>

      <button class="add-exercise" @click="pickerOpen = true">+ Add exercise</button>

      <div v-if="pickerOpen" class="picker-wrap">
        <ExercisePicker
          :exercises="exercises"
          :groups="groups"
          :client="client"
          @select="addExercise"
          @close="pickerOpen = false"
        />
      </div>

      <p v-if="error" data-test="template-error" class="form-error">{{ error }}</p>

      <div class="actions">
        <button
          v-if="mode === 'edit'"
          data-test="template-archive"
          class="archive-btn"
          :disabled="pending"
          @click="archive"
        >
          Archive
        </button>
        <span class="foot-spacer" />
        <button class="ghost" :disabled="pending" @click="emit('close')">Cancel</button>
        <button data-test="template-save" class="primary" :disabled="pending" @click="save">
          Save template
        </button>
      </div>
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
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.field-label {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
}
.name-input {
  width: 100%;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 6px 9px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  color-scheme: dark;
}
.name-input:focus {
  outline: none;
  border-color: var(--accent, #4a7dff);
}
.rows-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 8px;
  padding: 8px;
  background: var(--surface-2, #1f2330);
}
.row-warn {
  border-color: var(--warn, #e6b450);
  background: rgba(230, 180, 80, 0.08);
}
.row-move {
  display: flex;
  flex-direction: column;
}
.row-move button {
  background: none;
  border: none;
  cursor: pointer;
  line-height: 1;
  color: var(--ink-dim, #9aa0ad);
}
.row-move button:hover:not(:disabled) {
  color: var(--ink, #e6e8ee);
}
.row-move button:disabled {
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.row-main {
  flex: 1;
  min-width: 0;
}
.row-name {
  font-weight: 500;
  color: var(--ink, #e6e8ee);
}
.row-group {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
}
.row-nudge {
  font-size: 12px;
  color: var(--warn, #e6b450);
}
.num {
  width: 48px;
  text-align: center;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 5px 4px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
  color-scheme: dark;
}
.num:focus {
  outline: none;
  border-color: var(--accent, #4a7dff);
}
.num.wide {
  width: 64px;
}
.times {
  color: var(--ink-faint, #6b7180);
}
.add-exercise {
  border: 1px dashed var(--line-2, #353a4a);
  background: transparent;
  color: var(--ink-dim, #9aa0ad);
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.add-exercise:hover {
  border-color: var(--accent, #4a7dff);
  color: var(--ink, #e6e8ee);
}
.picker-wrap {
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 8px;
  padding: 10px;
  background: var(--surface-2, #1f2330);
}
.form-error {
  margin: 0;
  font-size: 12px;
  color: var(--bad, #f08a8a);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.foot-spacer {
  flex: 1;
}
.archive-btn {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: var(--bad, #f08a8a);
  border-radius: 6px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.archive-btn:disabled {
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.primary:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.ghost {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 6px;
  padding: 7px 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-dim, #9aa0ad);
}
.icon-btn:hover {
  color: var(--ink, #e6e8ee);
}

@media (max-width: 768px) {
  .modal {
    min-width: 0;
    max-width: none;
    width: calc(100vw - 32px);
    height: 100%;
    max-height: 100vh;
    border-radius: 0;
    margin: 0;
  }
  .modal-backdrop {
    align-items: stretch;
  }
}
</style>
