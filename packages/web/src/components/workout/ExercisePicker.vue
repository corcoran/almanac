<!-- packages/web/src/components/workout/ExercisePicker.vue -->
<script setup lang="ts">
import { ExerciseResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import type { AddableExercise } from "../../composables/useTemplateForm.js";

type Exercise = z.infer<typeof ExerciseResponseSchema>;
type ExerciseGroup = {
  id: number;
  name: string;
};

const props = defineProps<{
  exercises: Exercise[];
  groups: ExerciseGroup[];
  client: ApiClient;
}>();

const emit = defineEmits<{
  (e: "select", exercise: AddableExercise): void;
  (e: "close"): void;
}>();

const query = ref("");
const newGroupId = ref<number | null>(null);
const pending = ref(false);
const error = ref<string | null>(null);

const groupName = (id: number): string => props.groups.find((g) => g.id === id)?.name ?? "";

const filtered = computed<Exercise[]>(() => {
  const q = query.value.trim().toLowerCase();
  const active = props.exercises.filter((e) => e.archived_at === null);
  if (q === "") return active;
  return active.filter((e) => e.name.toLowerCase().includes(q));
});

// Group filtered exercises by group name for display.
const grouped = computed<Array<{ name: string; items: Exercise[] }>>(() => {
  const byGroup = new Map<string, Exercise[]>();
  for (const ex of filtered.value) {
    const gn = groupName(ex.group_id) || "Other";
    const list = byGroup.get(gn) ?? [];
    list.push(ex);
    byGroup.set(gn, list);
  }
  return Array.from(byGroup.entries()).map(([name, items]) => ({ name, items }));
});

const showCreate = computed(() => query.value.trim().length > 0 && filtered.value.length === 0);

function pick(ex: Exercise): void {
  emit("select", {
    exercise_id: ex.id,
    name: ex.name,
    group_id: ex.group_id,
    groupName: groupName(ex.group_id),
  });
}

async function createAndAdd(): Promise<void> {
  const name = query.value.trim();
  const gid = newGroupId.value;
  if (name === "" || gid === null) {
    error.value = "Pick a group for the new exercise.";
    return;
  }
  pending.value = true;
  error.value = null;
  try {
    const created = await props.client.post(
      "/v1/exercises",
      { group_id: gid, name },
      ExerciseResponseSchema,
    );
    emit("select", {
      exercise_id: created.id,
      name: created.name,
      group_id: created.group_id,
      groupName: groupName(created.group_id),
    });
  } catch {
    error.value = "Couldn't create the exercise. Try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="picker">
    <div class="picker-head">
      <span class="picker-title">Add exercise</span>
      <button class="icon-btn" aria-label="Close" @click="emit('close')">✕</button>
    </div>
    <input
      v-model="query"
      data-test="picker-search"
      class="picker-search"
      type="text"
      placeholder="Exercise name"
    />
    <p class="picker-hint">Pick from your library, or type a new name to create one.</p>
    <div v-for="g in grouped" :key="g.name" class="picker-group">
      <div class="picker-group-name">{{ g.name }}</div>
      <button
        v-for="ex in g.items"
        :key="ex.id"
        data-test="picker-exercise"
        class="picker-exercise"
        @click="pick(ex)"
      >
        {{ ex.name }}
      </button>
    </div>
    <div v-if="showCreate" data-test="picker-create" class="picker-create">
      <div class="picker-create-label">Create "{{ query.trim() }}"</div>
      <select v-model.number="newGroupId" data-test="picker-create-group" class="picker-create-group">
        <option :value="null" disabled>Muscle group…</option>
        <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <button
        data-test="picker-create-submit"
        class="picker-create-submit"
        :disabled="pending"
        @click="createAndAdd"
      >
        Create &amp; add
      </button>
      <p v-if="error" class="picker-error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.picker { display: flex; flex-direction: column; gap: 10px; }
.picker-head { display: flex; align-items: center; justify-content: space-between; }
.picker-title { font-weight: 500; }
.picker-search { width: 100%; }
.picker-hint { font-size: 12px; color: var(--ink-dim, #9aa0ad); margin: -4px 0 0; }
.picker-group { display: flex; flex-direction: column; gap: 2px; }
.picker-group-name { font-size: 12px; color: var(--ink-dim, #9aa0ad); }
.picker-exercise { text-align: left; background: none; border: none; padding: 8px; cursor: pointer; color: var(--ink, #e6e8ee); }
.picker-exercise:hover { background: rgba(76, 195, 138, 0.05); }
.picker-create { border-top: 1px solid var(--line-1, #262a36); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.picker-create-label { font-weight: 500; }
.picker-error { color: var(--bad, #f08a8a); font-size: 13px; }
.icon-btn { background: none; border: none; cursor: pointer; color: var(--ink-dim, #9aa0ad); }
</style>
