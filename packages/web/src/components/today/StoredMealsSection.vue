<script setup lang="ts">
import { StoredMealResponseSchema } from "@almanac/core/schemas";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { isApiError } from "../../api/errors.js";
import { useStoredMealsStore } from "../../stores/stored-meals.js";
import StoredMealRow from "./StoredMealRow.vue";

type StoredMeal = z.infer<typeof StoredMealResponseSchema>;
type StoredMealEdit = {
  name: string;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

const props = defineProps<{
  client: ApiClient;
  /** Logs a stored meal as an eaten meal on the viewed day. Provided by
   *  MealsList, which owns composeEatenAt (the viewed-day / pre-4am logic). */
  logMeal: (stored: StoredMeal) => Promise<void>;
}>();

const storedStore = useStoredMealsStore();
const { data: storedMeals } = storeToRefs(storedStore);
const count = computed(() => storedMeals.value.length);

const expanded = ref(false);
const adding = ref(false);
const pending = ref(false);
const error = ref<string | null>(null);

// Pending overwrite: the add payload held back while we confirm a name clash.
const overwriteCandidate = ref<StoredMealEdit | null>(null);

const addSeed = computed<StoredMeal>(() => ({
  id: -1,
  user_id: -1,
  name: "",
  kcal: 0,
  protein_g: 0,
  carb_g: 0,
  fat_g: 0,
  description: null,
  created_at: "",
}));

function toggle(): void {
  expanded.value = !expanded.value;
}
function openAdd(): void {
  error.value = null;
  overwriteCandidate.value = null;
  adding.value = true;
}
function closeAdd(): void {
  adding.value = false;
  overwriteCandidate.value = null;
}

// Extract a user-facing message. API errors are structured ApiError objects
// (NOT Error instances), so unwrap an http body — the backend returns a friendly
// 409 message (e.g. "A stored meal named 'X' already exists.") in the body.
function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.kind === "http" && e.body) {
      try {
        const parsed = JSON.parse(e.body) as { error?: { message?: string }; message?: string };
        const msg = parsed.error?.message ?? parsed.message;
        if (msg) return msg;
      } catch {
        return e.body;
      }
    }
    return "Something went wrong. Please try again.";
  }
  return e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    pending.value = false;
  }
}

function storedBody(edit: StoredMealEdit) {
  return {
    name: edit.name,
    kcal: edit.kcal,
    protein_g: edit.protein_g,
    carb_g: edit.carb_g,
    fat_g: edit.fat_g,
  };
}

async function postStored(edit: StoredMealEdit): Promise<void> {
  await run(async () => {
    await props.client.post("/v1/stored-meals", storedBody(edit), StoredMealResponseSchema);
    await storedStore.reload(props.client);
    adding.value = false;
    overwriteCandidate.value = null;
  });
}

function onAddSave(edit: StoredMealEdit): void {
  // POST is an UPSERT on (user_id,name) — a duplicate name silently overwrites.
  // Guard with a client-side check against the loaded list so the overwrite is
  // explicit, never silent.
  const clash = storedMeals.value.some(
    (m) => m.name.toLowerCase() === edit.name.trim().toLowerCase(),
  );
  if (clash) {
    overwriteCandidate.value = edit;
    return;
  }
  void postStored(edit);
}

function confirmOverwrite(): void {
  const edit = overwriteCandidate.value;
  if (edit) void postStored(edit);
}
function cancelOverwrite(): void {
  overwriteCandidate.value = null;
}

async function onEditSave(id: number, edit: StoredMealEdit): Promise<void> {
  await run(async () => {
    await props.client.patch(`/v1/stored-meals/${id}`, storedBody(edit), StoredMealResponseSchema);
    await storedStore.reload(props.client);
  });
}

async function onDelete(id: number): Promise<void> {
  await run(async () => {
    await props.client.delete(`/v1/stored-meals/${id}`, z.undefined());
    await storedStore.reload(props.client);
  });
}

async function onLog(id: number): Promise<void> {
  const stored = storedMeals.value.find((m) => m.id === id);
  if (!stored) return;
  await run(async () => {
    await props.logMeal(stored);
  });
}
</script>

<template>
  <div class="stored">
    <div
      class="stored-head"
      :class="{ open: expanded }"
      data-test="stored-head"
      role="button"
      tabindex="0"
      :aria-expanded="expanded"
      @click="toggle"
      @keydown.enter="toggle"
      @keydown.space.prevent="toggle"
    >
      <span class="chev">▶</span>Stored meals<span class="count">· {{ count }} saved</span>
    </div>

    <div v-if="expanded" class="stored-body">
      <p v-if="count === 0 && !adding" class="empty" data-test="stored-empty">No saved meals yet.</p>
      <table v-if="count > 0 || adding" class="stored-table">
        <tbody>
          <StoredMealRow
            v-for="m in storedMeals"
            :key="m.id"
            :stored-meal="m"
            :pending="pending"
            @log="onLog"
            @save="(edit) => onEditSave(m.id, edit)"
            @delete="onDelete"
          />
          <StoredMealRow
            v-if="adding && !overwriteCandidate"
            :stored-meal="addSeed"
            :pending="pending"
            start-editing
            data-test="stored-add-form"
            @save="onAddSave"
            @cancel-add="closeAdd"
          />
        </tbody>
      </table>

      <div v-if="overwriteCandidate" class="overwrite" data-test="stored-overwrite-confirm">
        <span>"{{ overwriteCandidate.name }}" already exists — overwrite its macros?</span>
        <button type="button" class="yes" data-test="stored-overwrite-yes" :disabled="pending" @click="confirmOverwrite">Overwrite</button>
        <button type="button" class="no" data-test="stored-overwrite-no" @click="cancelOverwrite">Cancel</button>
      </div>

      <button
        v-if="!adding"
        type="button"
        class="add-btn"
        data-test="stored-add"
        @click="openAdd"
      >+ Add stored meal</button>

      <div v-if="error" class="stored-error" data-test="stored-error">{{ error }}</div>
    </div>
  </div>
</template>

<style scoped>
.stored { margin-top: 12px; border-top: 1px solid var(--line, #262a36); padding-top: 10px; }
.stored-head {
  display: flex; align-items: center; cursor: pointer; user-select: none;
  font-size: 11px; color: var(--ink-faint, #6b7180); text-transform: uppercase; letter-spacing: 0.6px;
}
.stored-head .chev { margin-right: 6px; transition: transform 0.15s; font-size: 10px; color: var(--ink-dim, #9aa0ad); display: inline-block; }
.stored-head.open .chev { transform: rotate(90deg); }
.stored-head .count { margin-left: 6px; color: var(--ink-dim, #9aa0ad); text-transform: none; letter-spacing: 0; }
.stored-body { margin-top: 8px; }
.stored-body .empty { margin: 0; font-style: italic; color: var(--ink-faint, #6b7180); font-size: 12px; }
.stored-table { width: 100%; border-collapse: collapse; }
.overwrite { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--bad, #f08a8a); margin-top: 8px; }
.overwrite button { border-radius: 5px; border: 1px solid var(--line-2, #353a4a); background: var(--surface-2, #1f2330); font: inherit; font-size: 11px; padding: 3px 8px; cursor: pointer; color: var(--ink-dim, #9aa0ad); }
.overwrite button.yes { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.add-btn {
  margin-top: 8px; width: 100%; background: transparent;
  border: 1px dashed var(--line-2, #353a4a); color: var(--ink-dim, #9aa0ad);
  border-radius: 6px; padding: 6px; font: inherit; font-size: 12px; cursor: pointer;
}
.add-btn:hover { border-color: var(--ink-dim, #9aa0ad); color: var(--ink, #e6e8ee); }
.stored-error { font-size: 11px; color: var(--bad, #f08a8a); margin-top: 6px; }
</style>
