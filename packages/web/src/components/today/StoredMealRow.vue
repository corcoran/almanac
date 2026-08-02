<script setup lang="ts">
import type { StoredMealResponseSchema } from "@almanac/core/schemas";
import { computed, ref } from "vue";
import type { z } from "zod";

type StoredMeal = z.infer<typeof StoredMealResponseSchema>;

const props = withDefaults(
  defineProps<{ storedMeal: StoredMeal; pending?: boolean; startEditing?: boolean }>(),
  { pending: false, startEditing: false },
);

type StoredMealEdit = {
  name: string;
  kcal: number;
  protein_g: number;
  carb_g: number;
  fat_g: number;
};

const emit = defineEmits<{
  (e: "log", id: number): void;
  (e: "save", value: StoredMealEdit): void;
  (e: "delete", id: number): void;
  (e: "cancel-add"): void;
}>();

function formatMacroG(g: number): string {
  const rounded = Math.round(g * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

const confirmingDelete = ref(false);

function onConfirmYes(): void {
  confirmingDelete.value = false;
  emit("delete", props.storedMeal.id);
}

const nameDraft = ref("");
const kcalDraft = ref("");
const proteinDraft = ref("");
const carbDraft = ref("");
const fatDraft = ref("");

const isEditing = ref(props.startEditing);
if (props.startEditing) {
  nameDraft.value = props.storedMeal.name;
  kcalDraft.value = props.storedMeal.kcal === 0 ? "" : String(props.storedMeal.kcal);
  proteinDraft.value = props.storedMeal.protein_g === 0 ? "" : String(props.storedMeal.protein_g);
  carbDraft.value = props.storedMeal.carb_g === 0 ? "" : String(props.storedMeal.carb_g);
  fatDraft.value = props.storedMeal.fat_g === 0 ? "" : String(props.storedMeal.fat_g);
}

function beginEdit(): void {
  nameDraft.value = props.storedMeal.name;
  kcalDraft.value = String(props.storedMeal.kcal);
  proteinDraft.value = String(props.storedMeal.protein_g);
  carbDraft.value = String(props.storedMeal.carb_g);
  fatDraft.value = String(props.storedMeal.fat_g);
  confirmingDelete.value = false;
  isEditing.value = true;
}

function parseMacro(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Save requires a non-empty name (UNIQUE key) AND a valid non-negative integer
// kcal. The name-required gate is the key difference from MealRow.
const saveDisabled = computed(() => {
  const k = Number(kcalDraft.value.trim());
  const nameOk = nameDraft.value.trim().length > 0;
  const kcalOk = kcalDraft.value.trim() !== "" && Number.isInteger(k) && k >= 0;
  return props.pending || !(nameOk && kcalOk);
});

function onSave(): void {
  const k = Number(kcalDraft.value.trim());
  const name = nameDraft.value.trim();
  if (!(name.length > 0 && Number.isInteger(k) && k >= 0)) return;
  emit("save", {
    name,
    kcal: k,
    protein_g: parseMacro(proteinDraft.value),
    carb_g: parseMacro(carbDraft.value),
    fat_g: parseMacro(fatDraft.value),
  });
  isEditing.value = false;
}

function onCancel(): void {
  isEditing.value = false;
  if (props.startEditing) emit("cancel-add");
}
</script>

<template>
  <tr v-if="!isEditing" class="stored-row" data-test="stored-row">
    <td class="name" :title="storedMeal.name" data-test="stored-name">{{ storedMeal.name }}</td>
    <td class="m kcal"><b>{{ storedMeal.kcal }}</b><span class="lbl">kcal</span></td>
    <td class="m protein"><b>{{ formatMacroG(storedMeal.protein_g) }}</b><span class="lbl">p</span></td>
    <td class="m carb"><b>{{ formatMacroG(storedMeal.carb_g) }}</b><span class="lbl">c</span></td>
    <td class="m fat"><b>{{ formatMacroG(storedMeal.fat_g) }}</b><span class="lbl">f</span></td>
    <td class="acts">
      <span v-if="confirmingDelete" class="confirm" data-test="stored-delete-confirm">
        <span class="q">Delete?</span>
        <button type="button" class="yes" data-test="stored-delete-yes" :disabled="pending" @click="onConfirmYes">Yes</button>
        <button type="button" class="no" data-test="stored-delete-no" @click="confirmingDelete = false">No</button>
      </span>
      <template v-else>
        <button type="button" class="log" data-test="stored-row-log" aria-label="Log as eaten" :disabled="pending" @click="emit('log', storedMeal.id)">⊕</button>
        <button type="button" data-test="stored-row-edit" aria-label="Edit stored meal" @click="beginEdit">✎</button>
        <button type="button" class="del" data-test="stored-row-delete" aria-label="Delete stored meal" :disabled="pending" @click="confirmingDelete = true">✕</button>
      </template>
    </td>
  </tr>
  <tr v-else class="stored-edit-row" data-test="stored-edit-form">
    <td colspan="6">
      <div class="grid">
        <label>Name</label>
        <span class="field name"><input v-model="nameDraft" type="text" data-test="stored-edit-name" placeholder="required" @keydown.esc="onCancel" /></span>
        <label class="cal">Calories</label>
        <span class="field macro"><input v-model="kcalDraft" type="text" inputmode="numeric" data-test="stored-edit-kcal" @keydown.enter.prevent="!saveDisabled && onSave()" @keydown.esc="onCancel" /><span class="suffix">kcal</span></span>
        <label class="pro">Protein</label>
        <span class="field macro"><input v-model="proteinDraft" type="text" inputmode="numeric" data-test="stored-edit-protein" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
        <label class="carb">Carbs</label>
        <span class="field macro"><input v-model="carbDraft" type="text" inputmode="numeric" data-test="stored-edit-carb" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
        <label class="fat">Fat</label>
        <span class="field macro"><input v-model="fatDraft" type="text" inputmode="numeric" data-test="stored-edit-fat" @keydown.esc="onCancel" /><span class="suffix">g</span></span>
      </div>
      <div class="formfoot">
        <button type="button" class="save" data-test="stored-edit-save" :disabled="saveDisabled" @click="onSave">Save</button>
        <button type="button" class="cancel" data-test="stored-edit-cancel" aria-label="Cancel" @click="onCancel">×</button>
      </div>
    </td>
  </tr>
</template>

<style scoped>
.stored-row td { padding: 3px 0; vertical-align: baseline; font-size: 12px; font-variant-numeric: tabular-nums; }
.stored-row .name { color: var(--ink, #e6e8ee); max-width: 0; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stored-row .m { text-align: right; white-space: nowrap; }
.stored-row .m.kcal { min-width: 48px; padding-left: 16px; }
.stored-row .m.protein, .stored-row .m.carb, .stored-row .m.fat { min-width: 30px; }
.stored-row .m b { color: var(--ink, #e6e8ee); font-weight: 600; }
.stored-row .m .lbl { font-size: 10px; margin-left: 1px; font-weight: 600; text-transform: uppercase; }
.stored-row .m.kcal .lbl { color: var(--m-kcal); }
.stored-row .m.protein .lbl { color: var(--m-protein); }
.stored-row .m.carb .lbl { color: var(--m-carb); }
.stored-row .m.fat .lbl { color: var(--m-fat); }
.stored-row .acts { text-align: right; white-space: nowrap; padding-left: 8px; }
.stored-row .acts button {
  width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--line-2, #353a4a);
  background: var(--surface-2, #1f2330); color: var(--ink-dim, #9aa0ad); font-size: 11px;
  line-height: 1; cursor: pointer; margin-left: 4px; display: inline-flex; align-items: center;
  justify-content: center; padding: 0; vertical-align: middle;
}
.stored-row .acts button:hover { color: var(--ink, #e6e8ee); }
.stored-row .acts button.log { color: var(--accent, #4a7dff); }
.stored-row .acts button.log:hover { border-color: var(--accent, #4a7dff); }
.stored-row .acts button.del:hover { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.stored-row .acts .confirm { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; font-size: 11px; color: var(--bad, #f08a8a); white-space: nowrap; }
.stored-row .acts .confirm .q { margin-right: 4px; }
.stored-row .acts .confirm button {
  width: 22px; height: 22px; margin: 0; padding: 0; border-radius: 5px;
  border: 1px solid var(--line-2, #353a4a); background: var(--surface-2, #1f2330);
  color: var(--ink-dim, #9aa0ad); font: inherit; font-size: 11px; line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.stored-row .acts .confirm button.yes { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.stored-row .acts .confirm button.no { color: var(--ink-dim, #9aa0ad); }
.stored-edit-row td { padding: 6px 0; }
.stored-edit-row .grid { display: grid; grid-template-columns: max-content max-content; row-gap: 8px; column-gap: 12px; align-items: center; }
.stored-edit-row .grid > label { font-size: 11px; color: var(--ink-dim, #9aa0ad); justify-self: start; }
.stored-edit-row label.cal { color: var(--m-kcal); }
.stored-edit-row label.pro { color: var(--m-protein); }
.stored-edit-row label.carb { color: var(--m-carb); }
.stored-edit-row label.fat { color: var(--m-fat); }
.stored-edit-row .field { display: inline-flex; align-items: baseline; background: var(--surface-2, #1f2330); border: 1px solid var(--line-2, #353a4a); border-radius: 6px; padding: 5px 8px; }
.stored-edit-row .field:focus-within { border-color: var(--accent, #4a7dff); }
.stored-edit-row .field input { background: transparent; border: none; outline: none; font: inherit; font-size: 13px; color: var(--ink, #e6e8ee); font-variant-numeric: tabular-nums; text-align: left; padding: 0; }
.stored-edit-row .field .suffix { font-size: 10px; color: var(--ink-faint, #6b7180); margin-left: 5px; }
.stored-edit-row .field.macro { width: 74px; }
.stored-edit-row .field.macro input { width: 4ch; flex: none; }
.stored-edit-row .field.macro .suffix { margin-left: 6px; }
.stored-edit-row .field.name { width: 200px; }
.stored-edit-row .field.name input { width: 100%; }
.stored-edit-row .formfoot { display: flex; align-items: center; margin-top: 12px; gap: 10px; }
.stored-edit-row .save { margin-left: auto; background: var(--accent, #4a7dff); color: #fff; border: none; border-radius: 6px; padding: 6px 13px; font-size: 12px; font-weight: 500; cursor: pointer; }
.stored-edit-row .save:disabled { background: var(--line-2, #353a4a); color: var(--ink-faint, #6b7180); cursor: not-allowed; }
.stored-edit-row .cancel { background: transparent; border: none; color: var(--ink-dim, #9aa0ad); font-size: 17px; line-height: 1; cursor: pointer; padding: 0 2px; }
</style>
