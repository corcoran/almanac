<script setup lang="ts">
import type { ExerciseGroupResponseSchema, ExerciseResponseSchema } from "@almanac/core/schemas";
import { computed, nextTick, ref } from "vue";
import type { z } from "zod";

type Exercise = z.infer<typeof ExerciseResponseSchema>;
type ExerciseGroup = z.infer<typeof ExerciseGroupResponseSchema>;

const props = defineProps<{
  exercises: Exercise[];
  groups: ExerciseGroup[];
  primaryGroupId: number | null;
  /**
   * Callback that performs POST /v1/exercises. Passed in by the parent so
   * the component stays dumb-and-testable (no fetch mocking required).
   */
  createExercise: (input: { name: string; group_id: number }) => Promise<Exercise>;
}>();

const emit =
  defineEmits<
    (e: "select", payload: { exercise_id: number; name: string; group_id: number }) => void
  >();

const open = ref(false);
const searchRef = ref<HTMLInputElement | null>(null);
const query = ref("");
const showAll = ref(false);
const newGroupId = ref<number | null>(null);
const submitting = ref(false);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const groupFilter = (ex: Exercise) =>
    showAll.value || props.primaryGroupId === null ? true : ex.group_id === props.primaryGroupId;
  return props.exercises
    .filter(groupFilter)
    .filter((ex) => (q === "" ? true : ex.name.toLowerCase().includes(q)));
});

const noMatch = computed(() => query.value.trim() !== "" && filtered.value.length === 0);

function openPanel() {
  open.value = true;
  nextTick(() => searchRef.value?.focus());
}

function reset() {
  open.value = false;
  query.value = "";
  showAll.value = false;
  newGroupId.value = null;
}

function pick(ex: Exercise) {
  emit("select", {
    exercise_id: ex.id,
    name: ex.name,
    group_id: ex.group_id,
  });
  reset();
}

async function submitCreate() {
  const name = query.value.trim();
  if (name === "" || newGroupId.value === null) return;
  submitting.value = true;
  try {
    const created = await props.createExercise({
      name,
      group_id: newGroupId.value,
    });
    emit("select", {
      exercise_id: created.id,
      name: created.name,
      group_id: created.group_id,
    });
    reset();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="add-exercise">
    <button
      v-if="!open"
      type="button"
      class="open-btn"
      data-test="open-add-exercise"
      @click="openPanel"
    >
      + Add exercise
    </button>

    <div v-else class="panel" data-test="add-exercise-panel">
      <input
        ref="searchRef"
        v-model="query"
        type="text"
        placeholder="Search exercises…"
        class="search"
        data-test="search-input"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
      />
      <label class="show-all-row">
        <input
          v-model="showAll"
          type="checkbox"
          data-test="show-all"
        />
        Show all groups
      </label>

      <ul v-if="filtered.length > 0" class="options">
        <li
          v-for="ex in filtered"
          :key="ex.id"
          class="option"
          data-test="exercise-option"
          @click="pick(ex)"
        >
          {{ ex.name }}
        </li>
      </ul>

      <div v-if="noMatch" class="create-new" data-test="create-new-form">
        <p class="create-hint">No match. Create new exercise:</p>
        <label class="create-row">
          <span>Group</span>
          <select
            v-model.number="newGroupId"
            class="select"
            data-test="create-group"
          >
            <option :value="null" disabled>Choose a group…</option>
            <option
              v-for="g in groups"
              :key="g.id"
              :value="g.id"
            >{{ g.name }}</option>
          </select>
        </label>
        <button
          type="button"
          class="create-submit"
          data-test="create-submit"
          :disabled="submitting"
          @click="submitCreate"
        >
          Create "{{ query }}"
        </button>
      </div>

      <button
        type="button"
        class="cancel"
        data-test="cancel-add-exercise"
        @click="reset"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<style scoped>
.open-btn {
  background: transparent;
  border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.open-btn:hover {
  border-color: var(--accent, #4a7dff);
  color: var(--accent, #4a7dff);
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line-1, #262a36);
  border-radius: 8px;
  background: var(--surface-1, #161922);
}
.search {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 4px;
  padding: 5px 8px;
  font: inherit;
}
.show-all-row {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.options {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}
.option {
  padding: 5px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.option:hover {
  background: var(--surface-2, #1f2330);
}
.create-new {
  border-top: 1px dashed var(--line-2, #353a4a);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.create-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.create-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.select {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 4px;
  padding: 3px 6px;
  font: inherit;
}
.create-submit {
  align-self: flex-start;
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.create-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cancel {
  align-self: flex-end;
  background: transparent;
  border: none;
  color: var(--ink-faint, #9aa0ad);
  font-size: 11px;
  cursor: pointer;
}
</style>
