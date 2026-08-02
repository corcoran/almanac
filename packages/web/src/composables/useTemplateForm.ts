import { computed, ref } from "vue";
import { displayWeightToKg, kgToDisplayWeight, type UnitSystem } from "../lib/units.js";

/**
 * Coerce a number-input value to a finite number or null. Vue's `v-model.number`
 * leaves the raw `""` (or other non-numeric strings) in place when a parse fails,
 * so a "cleared" numeric field arrives here as `""` despite its `number | null`
 * declared type — param is `unknown` to narrow that defensively. Returns null for
 * empty/blank/NaN so the API never sees `""`/`NaN`.
 */
function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export type AddableExercise = {
  exercise_id: number;
  name: string;
  group_id: number;
  groupName: string;
};

export type DraftRow = {
  key: string;
  exercise_id: number;
  exerciseName: string;
  groupName: string;
  default_sets: number;
  default_reps: number | null;
  /** In the user's DISPLAY unit; converted to kg in buildPayload. */
  default_weight: number | null;
};

export type TemplateItemPayload = {
  exercise_id: number;
  display_order: number;
  default_sets: number;
  default_reps: number | null;
  default_weight_kg: number | null;
};

export type TemplatePayload = {
  name: string;
  items: TemplateItemPayload[];
};

type TemplateLike = {
  name: string;
  items: ReadonlyArray<{
    exercise_id: number;
    display_order: number;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
  }>;
};

/**
 * Reactive draft state for the template create/edit form. Mirrors usePhaseForm:
 * holds refs/computeds, performs no I/O. The modal wires this up and does the
 * POST/PATCH/PUT. Weight is held per-row in the user's display unit; buildPayload
 * converts to kg. No API calls here.
 */
export function useTemplateForm(unitSystem: UnitSystem) {
  const name = ref("");
  const rows = ref<DraftRow[]>([]);
  let keySeq = 0;
  const nextKey = () => `row-${keySeq++}`;

  function addRow(ex: AddableExercise): void {
    rows.value.push({
      key: nextKey(),
      exercise_id: ex.exercise_id,
      exerciseName: ex.name,
      groupName: ex.groupName,
      default_sets: 1,
      default_reps: null,
      default_weight: null,
    });
  }

  function removeRow(key: string): void {
    rows.value = rows.value.filter((r) => r.key !== key);
  }

  function moveUp(key: string): void {
    const i = rows.value.findIndex((r) => r.key === key);
    if (i <= 0) return;
    const arr = rows.value;
    const a = arr[i - 1];
    const b = arr[i];
    if (!a || !b) return;
    arr[i - 1] = b;
    arr[i] = a;
  }

  function moveDown(key: string): void {
    const i = rows.value.findIndex((r) => r.key === key);
    if (i < 0 || i >= rows.value.length - 1) return;
    const arr = rows.value;
    const a = arr[i];
    const b = arr[i + 1];
    if (!a || !b) return;
    arr[i] = b;
    arr[i + 1] = a;
  }

  function setFromTemplate(
    tpl: TemplateLike,
    lookup: (exerciseId: number) => { name: string; groupName: string } | null,
  ): void {
    name.value = tpl.name;
    rows.value = tpl.items
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((item) => {
        const meta = lookup(item.exercise_id);
        return {
          key: nextKey(),
          exercise_id: item.exercise_id,
          exerciseName: meta?.name ?? "(unknown)",
          groupName: meta?.groupName ?? "",
          default_sets: item.default_sets,
          default_reps: item.default_reps,
          default_weight: kgToDisplayWeight(item.default_weight_kg, unitSystem),
        };
      });
  }

  function setFromPreset(
    presetRows: AddableExercise[],
    itemDefaults: ReadonlyArray<{ default_sets: number; default_reps: number | null }>,
    templateName: string,
  ): void {
    name.value = templateName;
    rows.value = presetRows.map((ex, i) => ({
      key: nextKey(),
      exercise_id: ex.exercise_id,
      exerciseName: ex.name,
      groupName: ex.groupName,
      default_sets: itemDefaults[i]?.default_sets ?? 1,
      default_reps: itemDefaults[i]?.default_reps ?? null,
      default_weight: null,
    }));
  }

  function buildPayload(): TemplatePayload {
    return {
      name: name.value.trim(),
      items: rows.value.map((r, i) => {
        const w = toNumOrNull(r.default_weight);
        return {
          exercise_id: r.exercise_id,
          display_order: i,
          default_sets: toNumOrNull(r.default_sets) ?? 0,
          default_reps: toNumOrNull(r.default_reps),
          default_weight_kg: w === null ? null : displayWeightToKg(w, unitSystem),
        };
      }),
    };
  }

  const hasEmptyPrescription = computed(() =>
    rows.value.some((r) => (toNumOrNull(r.default_sets) ?? 0) === 0),
  );

  return {
    name,
    rows,
    addRow,
    removeRow,
    moveUp,
    moveDown,
    setFromTemplate,
    setFromPreset,
    buildPayload,
    hasEmptyPrescription,
  };
}
