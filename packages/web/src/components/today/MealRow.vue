<script setup lang="ts">
import type { MealResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";

type Meal = z.infer<typeof MealResponseSchema>;

const props = withDefaults(
  defineProps<{ meal: Meal; pending?: boolean; startEditing?: boolean }>(),
  { pending: false, startEditing: false },
);

type MealEdit = {
  name: string | null;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  time: string;
};

const emit = defineEmits<{
  (e: "save", value: MealEdit): void;
  (e: "delete", id: number): void;
  (e: "cancel-add"): void;
}>();

const confirmingDelete = ref(false);

function onConfirmYes(): void {
  confirmingDelete.value = false;
  emit("delete", props.meal.id);
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const time = computed(() => timeFmt.format(new Date(props.meal.eaten_at)));

const displayName = computed(() => {
  const n = props.meal.name;
  return n && n.trim().length > 0 ? n : "(unnamed)";
});

function formatMacroG(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

const nameDraft = ref("");
const kcalDraft = ref("");
const proteinDraft = ref("");
const carbDraft = ref("");
const fatDraft = ref("");
const timeDraft = ref("");

// Fixed en-GB / 24h so the prefilled value is a strict "HH:MM" that
// <input type="time"> accepts. Do NOT replace with the locale-driven display
// formatter (`timeFmt`) — a 12h/locale value (e.g. "12:30 am") is rejected by
// the time input. Display formatting and form-value formatting differ on purpose.
const hhmmFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const isEditing = ref(props.startEditing);
if (props.startEditing) {
  nameDraft.value = props.meal.name ?? "";
  kcalDraft.value = props.meal.kcal === 0 ? "" : String(props.meal.kcal);
  proteinDraft.value = props.meal.protein_g === 0 ? "" : String(props.meal.protein_g);
  carbDraft.value = props.meal.carb_g === 0 ? "" : String(props.meal.carb_g);
  fatDraft.value = props.meal.fat_g === 0 ? "" : String(props.meal.fat_g);
  timeDraft.value = hhmmFmt.format(new Date(props.meal.eaten_at));
}

function beginEdit(): void {
  nameDraft.value = props.meal.name ?? "";
  kcalDraft.value = String(props.meal.kcal);
  proteinDraft.value = String(props.meal.protein_g);
  carbDraft.value = String(props.meal.carb_g);
  fatDraft.value = String(props.meal.fat_g);
  timeDraft.value = hhmmFmt.format(new Date(props.meal.eaten_at));
  confirmingDelete.value = false;
  isEditing.value = true;
}

function parseMacro(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const saveDisabled = computed(() => {
  const k = Number(kcalDraft.value.trim());
  return props.pending || !(kcalDraft.value.trim() !== "" && Number.isInteger(k) && k >= 0);
});

function onSave(): void {
  const k = Number(kcalDraft.value.trim());
  if (!(Number.isInteger(k) && k >= 0)) return;
  const name = nameDraft.value.trim();
  emit("save", {
    name: name.length > 0 ? name : null,
    kcal: k,
    protein_g: parseMacro(proteinDraft.value),
    carb_g: parseMacro(carbDraft.value),
    fat_g: parseMacro(fatDraft.value),
    time: timeDraft.value,
  });
  isEditing.value = false;
}

function onCancel(): void {
  isEditing.value = false;
  if (props.startEditing) emit("cancel-add");
}
</script>

<template>
  <tr v-if="!isEditing" class="meal-row" data-test="meal-row">
    <td class="time" data-test="meal-time">{{ time }}</td>
    <td class="name" :title="displayName" data-test="meal-name">{{ displayName }}</td>
    <td class="m kcal"><b>{{ meal.kcal }}</b><span class="lbl">kcal</span></td>
    <td class="m protein"><b>{{ formatMacroG(meal.protein_g) }}</b><span class="lbl">p</span></td>
    <td class="m carb"><b>{{ formatMacroG(meal.carb_g) }}</b><span class="lbl">c</span></td>
    <td class="m fat"><b>{{ formatMacroG(meal.fat_g) }}</b><span class="lbl">f</span></td>
    <td class="acts">
      <span v-if="confirmingDelete" class="confirm" data-test="meal-delete-confirm">
        <span class="q">Delete?</span>
        <button type="button" class="yes" data-test="meal-delete-yes" :disabled="pending" @click="onConfirmYes">Yes</button>
        <button type="button" class="no" data-test="meal-delete-no" @click="confirmingDelete = false">No</button>
      </span>
      <template v-else>
        <button type="button" data-test="meal-row-edit" aria-label="Edit meal" @click="beginEdit">✎</button>
        <button type="button" class="del" data-test="meal-row-delete" aria-label="Delete meal" :disabled="pending" @click="confirmingDelete = true">✕</button>
      </template>
    </td>
  </tr>
  <tr v-else class="meal-edit-row" data-test="meal-edit-form">
    <td colspan="7">
      <div class="grid">
        <label>Name</label>
        <span class="field name"><input v-model="nameDraft" type="text" data-test="meal-edit-name" placeholder="optional" @keydown.esc="onCancel" /></span>
        <label class="cal">Calories</label>
        <span class="field macro"><input v-model="kcalDraft" type="text" inputmode="numeric" data-test="meal-edit-kcal" @keydown.enter.prevent="!saveDisabled && onSave()" @keydown.esc="onCancel" /><span class="suffix">kcal</span></span>
        <label class="pro">Protein</label>
        <span class="field macro"><input v-model="proteinDraft" type="text" inputmode="numeric" data-test="meal-edit-protein" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
        <label class="carb">Carbs</label>
        <span class="field macro"><input v-model="carbDraft" type="text" inputmode="numeric" data-test="meal-edit-carb" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
        <label class="fat">Fat</label>
        <span class="field macro"><input v-model="fatDraft" type="text" inputmode="numeric" data-test="meal-edit-fat" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
        <label>Time</label>
        <span class="field time"><input v-model="timeDraft" type="time" data-test="meal-edit-time" @keydown.esc="onCancel" /></span>
      </div>
      <div class="formfoot">
        <button type="button" class="save" data-test="meal-edit-save" :disabled="saveDisabled" @click="onSave">Save</button>
        <button type="button" class="cancel" data-test="meal-edit-cancel" aria-label="Cancel" @click="onCancel">×</button>
      </div>
    </td>
  </tr>
</template>

<style scoped>
.meal-row td { padding: 3px 0; vertical-align: baseline; font-size: 12px; font-variant-numeric: tabular-nums; }
.meal-row .time { color: var(--ink-faint, #6b7180); font-size: 11px; width: 36px; padding-right: 8px; white-space: nowrap; }
.meal-row .name { color: var(--ink, #e6e8ee); max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meal-row .m { text-align: right; white-space: nowrap; }
.meal-row .m.kcal { min-width: 48px; padding-left: 16px; }
.meal-row .m.protein, .meal-row .m.carb, .meal-row .m.fat { min-width: 30px; }
.meal-row .m b { color: var(--ink, #e6e8ee); font-weight: 600; }
.meal-row .m .lbl { font-size: 10px; margin-left: 1px; font-weight: 600; text-transform: uppercase; }
.meal-row .m.kcal .lbl { color: var(--m-kcal); }
.meal-row .m.protein .lbl { color: var(--m-protein); }
.meal-row .m.carb .lbl { color: var(--m-carb); }
.meal-row .m.fat .lbl { color: var(--m-fat); }
.meal-row .acts { text-align: right; white-space: nowrap; padding-left: 8px; width: 54px; }
.meal-row .acts button {
  width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--line-2, #353a4a);
  background: var(--surface-2, #1f2330); color: var(--ink-dim, #9aa0ad); font-size: 11px;
  line-height: 1; cursor: pointer; margin-left: 4px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0; vertical-align: middle;
}
.meal-row .acts button:hover { color: var(--ink, #e6e8ee); }
.meal-row .acts button.del:hover { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.meal-row .acts .confirm { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; font-size: 11px; color: var(--bad, #f08a8a); white-space: nowrap; }
.meal-row .acts .confirm .q { margin-right: 4px; }
.meal-row .acts .confirm button {
  width: 22px; height: 22px; margin: 0; padding: 0; border-radius: 5px;
  border: 1px solid var(--line-2, #353a4a); background: var(--surface-2, #1f2330);
  color: var(--ink-dim, #9aa0ad); font: inherit; font-size: 11px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.meal-row .acts .confirm button.yes { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.meal-row .acts .confirm button.no { color: var(--ink-dim, #9aa0ad); }
.meal-edit-row td { padding: 6px 0; }
.meal-edit-row .grid { display: grid; grid-template-columns: max-content max-content; row-gap: 8px; column-gap: 12px; align-items: center; }
.meal-edit-row .grid > label { font-size: 11px; color: var(--ink-dim, #9aa0ad); justify-self: start; }
.meal-edit-row label.cal { color: var(--m-kcal); }
.meal-edit-row label.pro { color: var(--m-protein); }
.meal-edit-row label.carb { color: var(--m-carb); }
.meal-edit-row label.fat { color: var(--m-fat); }
.meal-edit-row .field { display: inline-flex; align-items: baseline; background: var(--surface-2, #1f2330); border: 1px solid var(--line-2, #353a4a); border-radius: 6px; padding: 5px 8px; }
.meal-edit-row .field:focus-within { border-color: var(--accent, #4a7dff); }
.meal-edit-row .field input { background: transparent; border: none; outline: none; font: inherit; font-size: 13px; color: var(--ink, #e6e8ee); font-variant-numeric: tabular-nums; text-align: left; padding: 0; }
.meal-edit-row .field .suffix { font-size: 10px; color: var(--ink-faint, #6b7180); margin-left: 5px; }
.meal-edit-row .field.macro { width: 74px; }
.meal-edit-row .field.macro input { width: 4ch; flex: none; }
.meal-edit-row .field.macro .suffix { margin-left: 6px; }
.meal-edit-row .field.name { width: 200px; }
.meal-edit-row .field.name input { width: 100%; }
.meal-edit-row .field.time { width: max-content; }
.meal-edit-row .field.time input { color-scheme: dark; }
.meal-edit-row .formfoot { display: flex; align-items: center; margin-top: 12px; gap: 10px; }
.meal-edit-row .save { margin-left: auto; background: var(--accent, #4a7dff); color: #fff; border: none; border-radius: 6px; padding: 6px 13px; font-size: 12px; font-weight: 500; cursor: pointer; }
.meal-edit-row .save:disabled { background: var(--line-2, #353a4a); color: var(--ink-faint, #6b7180); cursor: not-allowed; }
.meal-edit-row .cancel { background: transparent; border: none; color: var(--ink-dim, #9aa0ad); font-size: 17px; line-height: 1; cursor: pointer; padding: 0 2px; }
</style>
