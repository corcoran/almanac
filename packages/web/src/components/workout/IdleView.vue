<script setup lang="ts">
import { ExerciseGroupResponseSchema, ExerciseResponseSchema } from "@almanac/core/schemas";
import { expandProgramPreset, PROGRAM_PRESETS } from "@almanac/core/signals";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import type { ApiClient } from "../../api/client.js";
import type { AddableExercise } from "../../composables/useTemplateForm.js";
import type { UnitSystem } from "../../lib/units.js";
import { nowNaiveLocal } from "../../lib/user-day.js";
import { useExerciseGroupsStore } from "../../stores/exercise-groups.js";
import { useExercisesStore } from "../../stores/exercises.js";
import { useNextBestActionStore } from "../../stores/nextBestAction.js";
import { useRecentWorkoutsStore } from "../../stores/recent-workouts.js";
import {
  type TemplateLastSessionEntry,
  useTemplateLastSessionsStore,
} from "../../stores/template-last-sessions.js";
import { useTemplatesStore } from "../../stores/templates.js";
import { useTodayStore } from "../../stores/today.js";
import { useWinsStore } from "../../stores/wins.js";
import { useWorkoutStore } from "../../stores/workout.js";
import NudgeSummary from "./NudgeSummary.vue";
import ProgramPicker from "./ProgramPicker.vue";
import TemplateFormModal from "./TemplateFormModal.vue";
import TemplatePicker from "./TemplatePicker.vue";
import WinsSummary from "./WinsSummary.vue";

const props = defineProps<{
  client: ApiClient;
}>();

const templatesStore = useTemplatesStore();
const recentStore = useRecentWorkoutsStore();
const exercisesStore = useExercisesStore();
const workoutStore = useWorkoutStore();
const todayStore = useTodayStore();
const lastSessionsStore = useTemplateLastSessionsStore();
const nextBestActionStore = useNextBestActionStore();
const { data: nextBestActionData } = storeToRefs(nextBestActionStore);
const winsStore = useWinsStore();
const { data: winsData } = storeToRefs(winsStore);
const groupsStore = useExerciseGroupsStore();
const { groups, status: groupsStatus } = storeToRefs(groupsStore);

const { templates, recommended_template_id, status: templatesStatus } = storeToRefs(templatesStore);
const { data: recentData, status: recentStatus } = storeToRefs(recentStore);
const { exercises: exerciseLib, status: exercisesStatus } = storeToRefs(exercisesStore);
const { data: todayData } = storeToRefs(todayStore);

// Ensure groups are loaded for the picker / preset resolution.
watch(
  () => groupsStatus.value,
  () => {
    if (groupsStatus.value === "idle") void groupsStore.load(props.client);
  },
  { immediate: true },
);

// Same join as ActiveView — fall back to metric if today hasn't loaded yet.
const unitSystem = computed<UnitSystem>(
  () => todayData.value?.user.preferred_unit_system ?? "metric",
);

// User-local "today" (YYYY-MM-DD) for relative-time on win tiles.
const winsToday = computed<string>(() => todayData.value?.today_date ?? "");

// Template id of the user's most-recently-completed workout, or null if
// there's no history (or the workout was ad-hoc / its template was
// deleted). Drives the picker's "last session" badge + auto-expand seed.
const lastSessionTemplateId = computed(() => recentData.value?.template_id ?? null);

// TemplatePicker's prop type is strictly { id; name }; the full template
// shape is wider (user_id, notes, archived_at, ...), so we narrow here.
// Computed so the mapped array isn't reallocated on every render.
const pickerTemplates = computed(() => templates.value.map((t) => ({ id: t.id, name: t.name })));

// State driving the chevron + panel. Owned here (not in TemplatePicker)
// so the picker stays a presentational, prop-driven component.
const expandedTemplateId = ref<number | null>(null);

// Auto-expand a row on mount so the user sees a template's last session
// without an extra click. We prefer the RECOMMENDED template's row — that's
// the one we're steering them toward, so showing what it looked like last
// time is the most useful default. Only when there's no recommendation do
// we fall back to the last-workout-overall row. Fires at most once: the
// guard on `expandedTemplateId.value !== null` keeps a later user toggle
// from being clobbered if a store re-emits.
watch(
  () =>
    [
      lastSessionTemplateId.value,
      recommended_template_id.value,
      recentStatus.value,
      templatesStatus.value,
    ] as const,
  () => {
    if (expandedTemplateId.value !== null) return;
    if (recentStatus.value !== "ready" || templatesStatus.value !== "ready") {
      return;
    }
    const target = recommended_template_id.value ?? lastSessionTemplateId.value;
    if (target === null) return;
    expandedTemplateId.value = target;
  },
  { immediate: true },
);

// Drive chevron visibility off the store's per-template entry state. For
// templates we haven't fetched yet we use a "?" sentinel so the chevron
// renders with no date label (rather than hiding it, which would prevent
// the user from ever discovering whether history exists). Once the store
// resolves, this turns into either an ISO date (chevron shows date) or
// `null` (chevron disappears).
const lastSessionDates = computed<Record<number, string | null>>(() => {
  const out: Record<number, string | null> = {};
  for (const tpl of pickerTemplates.value) {
    const entry = lastSessionsStore.entryFor(tpl.id);
    if (entry.status === "ready") {
      out[tpl.id] = entry.data?.started_at ?? null;
    } else {
      // idle / loading / error — assume history exists until proven
      // otherwise. The chevron renders without a date.
      out[tpl.id] = "?";
    }
  }
  return out;
});

const lastSessionEntries = computed<Record<number, TemplateLastSessionEntry>>(() =>
  Object.fromEntries(pickerTemplates.value.map((t) => [t.id, lastSessionsStore.entryFor(t.id)])),
);

function handleSelect(templateId: number) {
  const tpl = templates.value.find((t) => t.id === templateId);
  if (!tpl) return;
  // Build the TemplateBaseline from the picked template's items, joining
  // against the exercises store for name + group_id (the template item
  // schema only carries exercise_id). The picker render is gated on both
  // stores being ready, so exerciseLib is populated here.
  const items = tpl.items ?? [];
  // Stamp the session start as a naive-local wall-clock string in the user's
  // timezone (NOT UTC `toISOString()`), so an evening workout for a west-of-UTC
  // user buckets onto today, not tomorrow. Falls back to UTC if today hasn't
  // loaded (matches the unitSystem fallback above).
  const tz = todayData.value?.user.timezone ?? "UTC";
  const startedAt = nowNaiveLocal(new Date(), tz);
  workoutStore.startSession(
    {
      template_id: tpl.id,
      template_name: tpl.name,
      exercises: items.map((item) => {
        const lib = exerciseLib.value.find((e) => e.id === item.exercise_id);
        return {
          exercise_id: item.exercise_id,
          name: lib?.name ?? "(unknown)",
          group_id: lib?.group_id ?? 0,
          display_order: item.display_order,
          planned_sets: item.default_sets,
          default_reps: item.default_reps,
          default_weight_kg: item.default_weight_kg,
        };
      }),
    },
    startedAt,
  );
}

function handleToggleLastSession(templateId: number) {
  if (expandedTemplateId.value === templateId) {
    expandedTemplateId.value = null;
    return;
  }
  expandedTemplateId.value = templateId;
  // Lazy-fetch on first expand as a safety net — if the boot-time eager
  // load hasn't completed yet (or errored) we kick off the request here.
  // The store dedupes loading/ready entries so this never re-issues HTTP
  // for an already-resolved row.
  const entry = lastSessionsStore.entryFor(templateId);
  if (entry.status === "idle" || entry.status === "error") {
    void lastSessionsStore.loadForTemplate(
      props.client,
      templateId,
      (id) => exerciseLib.value.find((e) => e.id === id)?.name ?? "(unknown)",
    );
  }
}

// Eagerly fetch last-session metadata for every template once both the
// templates and exercises stores are ready. This drives the chevron's
// date label + tooltip on first render — without it, the chevron would
// stay in the "?" sentinel state (no date, no tooltip) until the user
// clicked to expand a row.
//
// Exercises must be loaded first because loadForTemplate uses the
// exercise-name lookup when populating the detail payload. The store's
// loadForTemplate is idempotent against ready/loading entries, so this
// batch is safe to re-fire if the watch ever runs more than once.
function loadAllLastSessions() {
  if (templatesStatus.value !== "ready" || exercisesStatus.value !== "ready") {
    return;
  }
  for (const tpl of templates.value) {
    void lastSessionsStore.loadForTemplate(
      props.client,
      tpl.id,
      (id) => exerciseLib.value.find((e) => e.id === id)?.name ?? "(unknown)",
    );
  }
}

watch(
  () => [templatesStatus.value, exercisesStatus.value] as const,
  () => loadAllLastSessions(),
  { immediate: true },
);

// --- Template authoring + program presets ---------------------------------

type ItemDefault = { default_sets: number; default_reps: number | null };
type QueueEntry = { name: string; rows: AddableExercise[]; defaults: ItemDefault[] };

type ModalState =
  | { open: false }
  | {
      open: true;
      mode: "create";
      initialName?: string;
      initialRows?: AddableExercise[];
      initialItemDefaults?: ReadonlyArray<ItemDefault>;
    }
  | { open: true; mode: "edit"; templateId: number };

const modal = ref<ModalState>({ open: false });

// Bumped on every modal open / walk-through advance, bound as the modal's
// :key. TemplateFormModal reads its initial* props only in onMounted, so each
// walk-through step (Push -> Pull -> Legs) must REMOUNT to re-prefill —
// without a changing key Vue would patch the existing instance and the second
// step would still show the first template's exercises.
const modalKey = ref(0);

// Walk-through queue: remaining preset templates after the current one.
const programQueue = ref<QueueEntry[]>([]);

// Surfaces a failure while resolving a program's exercises (the resolve loop
// hits the network to create missing exercises/groups). Without this the
// modal would silently never open on a failed create.
const programError = ref<string | null>(null);

function openCreate() {
  modalKey.value++;
  modal.value = { open: true, mode: "create" };
}

function openEdit(templateId: number) {
  modalKey.value++;
  modal.value = { open: true, mode: "edit", templateId };
}

function closeModal() {
  modal.value = { open: false };
  programQueue.value = [];
}

async function onSaved() {
  await Promise.all([
    templatesStore.reload(props.client),
    exercisesStore.load(props.client),
    groupsStore.load(props.client),
  ]);
  // Advance the walk-through if more preset templates remain.
  const next = programQueue.value.shift();
  if (next) {
    modalKey.value++;
    modal.value = {
      open: true,
      mode: "create",
      initialName: next.name,
      initialRows: next.rows,
      initialItemDefaults: next.defaults,
    };
  } else {
    modal.value = { open: false };
  }
}

// Resolve a preset item's exercise name to an AddableExercise, creating the
// exercise (and its group if absent) when missing. Case-insensitive match
// against the loaded library; sequential awaits (small N).
async function resolvePresetExercise(
  exerciseName: string,
  groupName: string,
): Promise<AddableExercise> {
  const existing = exerciseLib.value.find(
    (e) => e.name.toLowerCase() === exerciseName.toLowerCase() && e.archived_at === null,
  );
  if (existing) {
    return {
      exercise_id: existing.id,
      name: existing.name,
      group_id: existing.group_id,
      groupName: groups.value.find((g) => g.id === existing.group_id)?.name ?? groupName,
    };
  }
  // Ensure the group exists (case-insensitive), creating it if absent.
  let group = groups.value.find((g) => g.name.toLowerCase() === groupName.toLowerCase());
  if (!group) {
    group = await props.client.post(
      "/v1/exercise-groups",
      { name: groupName },
      ExerciseGroupResponseSchema,
    );
    await groupsStore.load(props.client);
  }
  const created = await props.client.post(
    "/v1/exercises",
    { group_id: group.id, name: exerciseName },
    ExerciseResponseSchema,
  );
  await exercisesStore.load(props.client);
  return { exercise_id: created.id, name: created.name, group_id: created.group_id, groupName };
}

async function onPickProgram(programId: "ppl" | "upper_lower") {
  const preset = PROGRAM_PRESETS.find((p) => p.id === programId);
  if (!preset) return;
  const expanded = expandProgramPreset(preset);
  // Resolve every template's exercises up front (creates missing
  // exercises/groups before the walk-through opens). Build `rows` and
  // `defaults` from the SAME loop so they stay index-aligned by construction.
  // Any create can hit the network, so surface a failure rather than letting
  // the rejection escape and leave the modal silently un-opened.
  programError.value = null;
  const resolved: QueueEntry[] = [];
  try {
    for (const tpl of expanded.templates) {
      const rows: AddableExercise[] = [];
      const defaults: ItemDefault[] = [];
      for (const item of tpl.items) {
        rows.push(await resolvePresetExercise(item.exerciseName, item.groupName));
        defaults.push({ default_sets: item.default_sets, default_reps: item.default_reps });
      }
      resolved.push({ name: tpl.name, rows, defaults });
    }
  } catch {
    // Partial creates are idempotent on retry — the case-insensitive match
    // picks up any exercise/group already created before the failure.
    programError.value = "Couldn't set up that program. Check your connection and try again.";
    return;
  }
  const first = resolved.shift();
  if (!first) return;
  programQueue.value = resolved;
  modalKey.value++;
  modal.value = {
    open: true,
    mode: "create",
    initialName: first.name,
    initialRows: first.rows,
    initialItemDefaults: first.defaults,
  };
}
</script>

<template>
  <div class="idle-view">
    <NudgeSummary :data="nextBestActionData" />
    <WinsSummary :data="winsData" :today="winsToday" :unit-system="unitSystem" />
    <!-- Template picker -->
    <template
      v-if="templatesStatus === 'ready' && exercisesStatus === 'ready'"
    >
      <TemplatePicker
        :templates="pickerTemplates"
        :recommended-id="recommended_template_id"
        :last-session-template-id="lastSessionTemplateId"
        :last-session-dates="lastSessionDates"
        :expanded-template-id="expandedTemplateId"
        :last-session-entries="lastSessionEntries"
        :unit-system="unitSystem"
        @select="handleSelect"
        @toggle-last-session="handleToggleLastSession"
        @edit="openEdit"
      />
      <div class="idle-actions">
        <button data-test="new-template" type="button" class="new-template-btn" @click="openCreate">
          + New template
        </button>
      </div>
      <ProgramPicker :template-count="templates.length" @pick="onPickProgram" />
      <p v-if="programError" data-test="program-error" class="idle-error">{{ programError }}</p>
    </template>
    <p
      v-else-if="templatesStatus === 'error' || exercisesStatus === 'error'"
      class="idle-error"
    >
      Couldn't load templates.
    </p>
    <p v-else class="idle-loading">Loading templates…</p>

    <TemplateFormModal
      v-if="modal.open"
      :key="modalKey"
      :client="client"
      :mode="modal.mode"
      :unit-system="unitSystem"
      :exercises="exerciseLib"
      :groups="groups"
      :template-id="modal.mode === 'edit' ? modal.templateId : undefined"
      :initial-name="modal.mode === 'create' ? modal.initialName : undefined"
      :initial-rows="modal.mode === 'create' ? modal.initialRows : undefined"
      :initial-item-defaults="modal.mode === 'create' ? modal.initialItemDefaults : undefined"
      @saved="onSaved"
      @close="closeModal"
    />
  </div>
</template>

<style scoped>
.idle-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.idle-loading {
  color: #9aa0ad;
  font-style: italic;
}
.idle-error {
  color: #e6b450;
  font-style: italic;
}
.idle-actions {
  display: flex;
}
.new-template-btn {
  align-self: flex-start;
  background: transparent;
  border: 1px dashed var(--line-2, #353a4a);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 6px;
  padding: 7px 12px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.new-template-btn:hover {
  border-color: var(--accent, #4a7dff);
  color: var(--ink, #e6e8ee);
}
</style>
