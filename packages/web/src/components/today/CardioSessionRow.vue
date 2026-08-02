<script setup lang="ts">
import { computed, ref } from "vue";

type CardioSession = {
  id: number;
  modality: string | null;
  duration_min: number | null;
  est_kcal: number;
};

type CardioEdit = { modality: string | null; duration_min: number | null; est_kcal: number };

const props = withDefaults(defineProps<{ session: CardioSession; pending?: boolean }>(), {
  pending: false,
});
const emit = defineEmits<{
  (e: "save", value: CardioEdit): void;
  (e: "delete", id: number): void;
}>();

const isEditing = ref(false);
const confirmingDelete = ref(false);

const modalityDraft = ref("");
const durationDraft = ref("");
const kcalDraft = ref("");

const displayModality = computed<string>(() => {
  const m = props.session.modality;
  return m && m.trim().length > 0 ? m : "Cardio";
});

function beginEdit(): void {
  modalityDraft.value = props.session.modality ?? "";
  durationDraft.value =
    props.session.duration_min === null ? "" : String(props.session.duration_min);
  kcalDraft.value = String(props.session.est_kcal);
  confirmingDelete.value = false;
  isEditing.value = true;
}

const saveDisabled = computed(() => {
  const k = Number(kcalDraft.value.trim());
  return !(kcalDraft.value.trim() !== "" && Number.isInteger(k) && k >= 0);
});

function onSave(): void {
  const k = Number(kcalDraft.value.trim());
  if (!(Number.isInteger(k) && k >= 0)) return;
  const modality = modalityDraft.value.trim();
  const durStr = durationDraft.value.trim();
  const durNum = Number(durStr);
  const duration_min = durStr !== "" && Number.isInteger(durNum) && durNum > 0 ? durNum : null;
  emit("save", {
    modality: modality.length > 0 ? modality : null,
    duration_min,
    est_kcal: k,
  });
  isEditing.value = false;
}

function onCancel(): void {
  isEditing.value = false;
}

function onConfirmYes(): void {
  confirmingDelete.value = false;
  emit("delete", props.session.id);
}
</script>

<template>
  <li v-if="!isEditing" class="cardio-row" data-test="cardio-row">
    <span class="modality" data-test="cardio-modality">{{ displayModality }}</span>
    <span
      v-if="session.duration_min !== null"
      class="duration"
      data-test="cardio-duration"
    >{{ session.duration_min }}<span class="lbl">min</span></span>
    <span class="kcal" data-test="cardio-kcal">
      <b>{{ session.est_kcal }}</b><span class="lbl">kcal</span>
    </span>
    <span v-if="confirmingDelete" class="confirm" data-test="cardio-delete-confirm">
      Delete?
      <button type="button" class="yes" data-test="cardio-delete-yes" :disabled="pending" @click="onConfirmYes">Yes</button>
      <button type="button" class="no" data-test="cardio-delete-no" @click="confirmingDelete = false">No</button>
    </span>
    <span v-else class="row-actions">
      <button
        type="button"
        data-test="cardio-row-edit"
        aria-label="Edit cardio"
        @click="beginEdit"
      >✎</button>
      <button
        type="button"
        class="del"
        data-test="cardio-row-delete"
        aria-label="Delete cardio"
        :disabled="pending"
        @click="confirmingDelete = true"
      >✕</button>
    </span>
  </li>

  <li v-else class="form-row" data-test="cardio-edit-form">
    <input
      v-model="modalityDraft"
      type="text"
      class="modality-input"
      data-test="cardio-modality-input"
      placeholder="modality"
      @keydown.esc="onCancel"
    />
    <input
      v-model="durationDraft"
      type="text"
      inputmode="numeric"
      class="dur-input"
      data-test="cardio-duration-input"
      placeholder="—"
      @keydown.esc="onCancel"
    /><span class="u">min</span>
    <input
      v-model="kcalDraft"
      type="text"
      inputmode="numeric"
      class="kcal-input"
      data-test="cardio-kcal-input"
      placeholder="kcal"
      @keydown.enter.prevent="!saveDisabled && onSave()"
      @keydown.esc="onCancel"
    /><span class="u">kcal</span>
    <button
      type="button"
      class="save"
      data-test="cardio-row-save"
      :disabled="saveDisabled || pending"
      @click="onSave"
    >Save</button>
    <button
      type="button"
      class="cancel"
      data-test="cardio-row-cancel"
      aria-label="Cancel"
      @click="onCancel"
    >×</button>
  </li>
</template>

<style scoped>
.cardio-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cardio-row .modality {
  color: var(--ink, #e6e8ee);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cardio-row .duration { color: var(--ink-faint, #6b7180); }
.cardio-row .duration .lbl { font-size: 10px; margin-left: 1px; color: var(--ink-faint, #6b7180); }
.cardio-row .kcal b { color: var(--ink, #e6e8ee); font-weight: 600; }
.cardio-row .kcal .lbl { font-size: 10px; margin-left: 1px; font-weight: 600; color: var(--m-kcal); }
.row-actions { display: inline-flex; gap: 4px; margin-left: 6px; }
.row-actions button {
  width: 22px; height: 22px; border-radius: 5px;
  border: 1px solid var(--line-2, #353a4a);
  background: var(--surface-2, #1f2330);
  color: var(--ink-dim, #9aa0ad);
  font-size: 11px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center; padding: 0;
}
.row-actions button:hover { color: var(--ink, #e6e8ee); }
.row-actions button.del:hover { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.confirm { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; font-size: 11px; color: var(--bad, #f08a8a); }
.confirm button { border-radius: 5px; border: 1px solid var(--line-2, #353a4a); background: var(--surface-2, #1f2330); font: inherit; font-size: 11px; padding: 2px 7px; cursor: pointer; }
.confirm button.yes { color: var(--bad, #f08a8a); border-color: var(--bad, #f08a8a); }
.confirm button.no { color: var(--ink-dim, #9aa0ad); }

.form-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; padding: 2px 0; }
.form-row input {
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 5px 7px;
  font: inherit; font-size: 13px;
  color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
}
.form-row input:focus { outline: none; border-color: var(--accent, #4a7dff); }
.form-row .modality-input { width: 92px; }
.form-row .dur-input { width: 48px; }
.form-row .kcal-input { width: 60px; }
.form-row .u { color: var(--ink-faint, #6b7180); font-size: 10px; }
.form-row .save {
  margin-left: auto;
  background: var(--accent, #4a7dff); color: #fff;
  border: none; border-radius: 6px; padding: 5px 10px;
  font-size: 12px; font-weight: 500; cursor: pointer;
}
.form-row .save:disabled { background: var(--line-2, #353a4a); color: var(--ink-faint, #6b7180); cursor: not-allowed; }
.form-row .cancel { background: transparent; border: none; color: var(--ink-dim, #9aa0ad); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
</style>
