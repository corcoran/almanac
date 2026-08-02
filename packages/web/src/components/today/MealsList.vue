<script setup lang="ts">
import { MealResponseSchema, type StoredMealResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { composeEatenAt } from "../../lib/eaten-at.js";
import MealRow from "./MealRow.vue";
import StoredMealsSection from "./StoredMealsSection.vue";

type Meal = z.infer<typeof MealResponseSchema>;
type MealEdit = {
  name: string | null;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  time: string;
};

const props = defineProps<{
  meals: Meal[];
  client: ApiClient;
  /** Real current user-local date, for choosing the add-form's default time. */
  realToday: string;
  /** YYYY-MM-DD of the viewed day. */
  date?: string;
  isPastDay?: boolean;
  /** Whether the LLM meal-chat feature is enabled (shows the "Log with AI" shortcut). */
  mealChatEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "changed"): void;
  (e: "log-with-ai"): void;
}>();

const shortDateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const caption = computed(() =>
  props.isPastDay && props.date
    ? `Meals · ${shortDateFmt.format(new Date(`${props.date}T12:00:00Z`))}`
    : "Today's meals",
);

const hasMeals = computed(() => props.meals.length > 0);

const error = ref<string | null>(null);
const pending = ref(false);

async function run(fn: () => Promise<void>): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  error.value = null;
  try {
    await fn();
    emit("changed");
  } catch (e) {
    error.value =
      e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
  } finally {
    pending.value = false;
  }
}

// The viewed day for composing eaten_at. props.date is always set by TodayPane,
// but guard with realToday so a naive datetime is always well-formed.
const viewedDate = computed(() => props.date ?? props.realToday);

// --- add form ---
const adding = ref(false);

// Default time: current local HH:MM when viewing today, else noon for a past day
// (noon is always inside the day's 4am-rollover window for any tz).
const hhmmFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
function defaultTime(): string {
  return viewedDate.value === props.realToday ? hhmmFmt.format(new Date()) : "12:00";
}

// A synthetic "blank" meal to feed MealRow's add instance via its edit form.
const addSeed = computed<Meal>(() => ({
  id: -1, // sentinel; never read — add saves via onAddSave, not onEditSave(id)
  user_id: -1,
  // Naive-local (NO Z): MealRow prefills its time field by formatting this
  // through a local formatter, so a Z/UTC seed would shift the displayed
  // default time by the user's offset. Matches composeEatenAt's convention.
  eaten_at: `${viewedDate.value}T${defaultTime()}:00`,
  name: null,
  kcal: 0,
  protein_g: 0,
  carb_g: 0,
  fat_g: 0,
  notes: null,
  created_at: `${viewedDate.value}T${defaultTime()}:00`,
}));

function openAdd(): void {
  error.value = null;
  adding.value = true;
}
function closeAdd(): void {
  adding.value = false;
}

function mealBody(edit: MealEdit) {
  return {
    eaten_at: composeEatenAt(edit.time, viewedDate.value),
    name: edit.name,
    kcal: edit.kcal,
    protein_g: edit.protein_g,
    carb_g: edit.carb_g,
    fat_g: edit.fat_g,
  };
}

async function onAddSave(edit: MealEdit): Promise<void> {
  await run(async () => {
    await props.client.post("/v1/meals", mealBody(edit), MealResponseSchema);
    adding.value = false;
  });
}

async function onEditSave(id: number, edit: MealEdit): Promise<void> {
  await run(async () => {
    await props.client.patch(`/v1/meals/${id}`, mealBody(edit), MealResponseSchema);
  });
}

async function onDelete(id: number): Promise<void> {
  await run(async () => {
    await props.client.delete(`/v1/meals/${id}`, z.undefined());
  });
}

type StoredMeal = z.infer<typeof StoredMealResponseSchema>;

async function logStoredMeal(stored: StoredMeal): Promise<void> {
  await run(async () => {
    await props.client.post(
      "/v1/meals",
      {
        eaten_at: composeEatenAt(defaultTime(), viewedDate.value),
        name: stored.name,
        kcal: stored.kcal,
        protein_g: stored.protein_g,
        carb_g: stored.carb_g,
        fat_g: stored.fat_g,
      },
      MealResponseSchema,
    );
  });
}
</script>

<template>
  <div class="block" data-test="meals-list">
    <div class="caption">
      <span class="caption-label" data-test="meals-caption">{{ caption }}</span>
    </div>

    <p v-if="!hasMeals && !adding" class="empty" data-test="meals-empty">
      {{ isPastDay ? "No meals logged." : "No meals logged today yet." }}
    </p>

    <table v-if="hasMeals || adding" class="meals-table" data-test="meals-table">
      <tbody>
        <MealRow
          v-for="meal in meals"
          :key="meal.id"
          :meal="meal"
          :pending="pending"
          @save="(edit) => onEditSave(meal.id, edit)"
          @delete="onDelete"
        />
        <MealRow
          v-if="adding"
          :meal="addSeed"
          :pending="pending"
          start-editing
          data-test="meal-add-form"
          @save="onAddSave"
          @cancel-add="closeAdd"
        />
      </tbody>
    </table>

    <div v-if="!adding" class="meals-actions">
      <button
        type="button"
        class="add-btn"
        data-test="meals-add"
        @click="openAdd"
      >+ Add meal</button>
      <button
        v-if="mealChatEnabled"
        type="button"
        class="ai-btn"
        data-test="meals-log-with-ai"
        @click="emit('log-with-ai')"
      >💬 Log with AI</button>
    </div>

    <StoredMealsSection :client="client" :log-meal="logStoredMeal" />

    <div v-if="error" class="meals-error" data-test="meals-error">{{ error }}</div>
  </div>
</template>

<style scoped>
.block {
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.caption {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--ink-faint, #6b7180);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin-bottom: 8px;
}
.empty { margin: 0; font-style: italic; color: var(--ink-faint, #6b7180); font-size: 12px; }
.meals-actions { display: flex; gap: 8px; margin-top: 8px; }
.add-btn {
  flex: 1;
  background: transparent;
  border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 6px; padding: 6px;
  font: inherit; font-size: 12px; cursor: pointer;
}
.add-btn:hover { border-color: var(--ink-dim, #9aa0ad); color: var(--ink, #e6e8ee); }
.ai-btn {
  flex: none;
  background: transparent;
  border: 1px solid var(--accent, #5b7cfa);
  color: var(--accent, #5b7cfa);
  border-radius: 6px; padding: 6px 10px;
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.ai-btn:hover { background: color-mix(in srgb, var(--accent, #5b7cfa) 12%, transparent); }
.meals-table { width: 100%; border-collapse: collapse; }
.meals-error { font-size: 11px; color: var(--bad, #f08a8a); margin-top: 6px; }
</style>
