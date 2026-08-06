<script setup lang="ts">
import {
  BodyWeightResponseSchema,
  NutritionPhaseResponseSchema,
  PhaseEstimateResponseSchema,
  UserResponseSchema,
} from "@almanac/core/schemas";
import { computed, onMounted, ref, useId, watch } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { type PhaseType, usePhaseForm } from "../../composables/usePhaseForm.js";
import { displayWeightToKg, ftInToCm, type UnitSystem, weightUnitLabel } from "../../lib/units.js";

type NutritionPhase = z.infer<typeof NutritionPhaseResponseSchema>;
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

const props = withDefaults(
  defineProps<{
    client: ApiClient;
    mode: "create" | "edit";
    /** Present in edit mode — the phase being edited. */
    phase?: NutritionPhase | null;
    /** When false, render the inline current-weight field (cold start). */
    hasWeight: boolean;
    tdeeBasis: "profile_baseline" | "measured_intake";
    /** Logged days in the phase being edited — gates the "new phase?" hint. */
    loggedDays?: number;
    /** Display unit for the weight field. Defaults to metric. */
    weightUnit?: UnitSystem;
  }>(),
  { phase: null, loggedDays: 0, weightUnit: "metric" },
);

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "close"): void;
  (e: "request-create-from-current"): void;
}>();

// A11y: title id wired to aria-labelledby; focus the dialog root on mount so the
// Escape handler is reachable without a click first.
const titleId = useId();
const dialogRef = ref<HTMLDivElement | null>(null);
onMounted(() => dialogRef.value?.focus());

// --- shared invariant + band validation (do NOT reimplement) ---
const { phaseType, tdee, targetKcal, deficitKcal, bandError } = usePhaseForm();

// String-bound number inputs (native <input type="number"> binds strings;
// coerced on submit). usePhaseForm owns the numeric refs, so keep a small
// bridge: the inputs drive string refs, and a watch syncs them into the
// composable's numeric refs (empty -> null).
const tdeeStr = ref("");
const targetStr = ref("");
const proteinStr = ref("");
const carbStr = ref("");
const fatStr = ref("");
const nameStr = ref("");
const startedOn = ref("");
const plannedEndOn = ref("");
const notesStr = ref("");
const weightStr = ref("");
const activityLevel = ref<ActivityLevel>("moderate");

// --- in-form unit system (create mode) ---
// Initialized from the prop, then overridden by the fetched
// preferred_unit_system once /v1/users/me resolves; the toggle mutates it.
const unitSystem = ref<UnitSystem>(props.weightUnit);

// --- missing-profile-field state (create mode) ---
// Which profile fields are currently null on the fetched user (so we render an
// input for them). Defaults to "not missing" until the fetch resolves so the
// section doesn't flash for a fully-set-up user.
const heightMissing = ref(false);
const sexMissing = ref(false);
const dobMissing = ref(false);
// Saved unit system from the fetched user, to detect a toggle change on submit.
const savedUnitSystem = ref<UnitSystem>(props.weightUnit);

// Profile input refs (strings; coerced on submit).
const heightCmStr = ref("");
const heightFtStr = ref("");
const heightInStr = ref("");
const sexStr = ref<"" | "male" | "female">("");
const dobStr = ref("");

// Numeric inputs use `<input type="number">`, whose v-model coerces a numeric
// string to a number at runtime — so these refs can hold `string | number`.
// Normalize through String() before any string op, and use `blank()` for the
// empty check rather than `.trim() === ""`.
function blank(v: unknown): boolean {
  return String(v ?? "").trim() === "";
}
function parseIntOrNull(s: unknown): number | null {
  const t = String(s ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function parseMacro(s: unknown): number {
  const t = String(s ?? "").trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

watch(tdeeStr, (s) => {
  tdee.value = parseIntOrNull(s);
});
watch(targetStr, (s) => {
  targetKcal.value = parseIntOrNull(s);
});

// --- edit-mode tier-2 tracking ---
// Set true once the user changes any of {target, macros, tdee, started_on}.
// In edit mode this drives the "re-scores logged days" caption + the
// new-phase hint. Seeded false; only user edits flip it (the initial prefill
// assignment happens before the watchers are wired below).
const tier2Touched = ref(false);
function markTier2(): void {
  if (props.mode === "edit") tier2Touched.value = true;
}

// --- today date string for the started_on default (plain YYYY-MM-DD) ---
function todayLocalIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// --- prefill ---
if (props.mode === "edit" && props.phase) {
  const p = props.phase;
  nameStr.value = p.name;
  phaseType.value = (p.phase_type ?? "cut") as PhaseType;
  tdeeStr.value = p.tdee_at_phase_start === null ? "" : String(p.tdee_at_phase_start);
  targetStr.value = String(p.daily_kcal_target);
  proteinStr.value = String(p.base_protein_g);
  carbStr.value = String(p.base_carb_g);
  fatStr.value = String(p.base_fat_g);
  startedOn.value = p.started_on;
  plannedEndOn.value = p.planned_end_on ?? "";
  notesStr.value = p.notes ?? "";
} else {
  startedOn.value = todayLocalIso();
}

// Wire tier-2 touch tracking AFTER the prefill so seeding doesn't trip it.
// phaseType is included: switching Cut/Bulk/Maintain re-scores logged days
// against a different band, so it's the biggest "changing course" signal the
// new-phase hint exists to catch.
watch([phaseType, tdeeStr, targetStr, proteinStr, carbStr, fatStr, startedOn], markTier2);

// --- estimate fetch (create mode) ---
function estimateUrl(): string {
  const params = new URLSearchParams();
  if (props.tdeeBasis === "profile_baseline") params.set("activity", activityLevel.value);
  const t = parseIntOrNull(targetStr.value);
  if (t !== null) params.set("target_kcal", String(t));
  params.set("phase_type", phaseType.value);
  // In cold start (weight field shown), preview the typed weight so the estimate
  // can anchor TDEE + macros to it before the weigh-in is saved. Convert from
  // the chosen display unit to kg.
  if (showWeightField.value && !blank(weightStr.value)) {
    const display = Number(String(weightStr.value).trim());
    if (Number.isFinite(display) && display > 0) {
      params.set("weight_kg", String(displayWeightToKg(display, unitSystem.value)));
    }
  }
  // Preview the typed profile fields (height/sex/dob) too — they're Mifflin
  // inputs, so the estimate should reflect them live, not the stored defaults.
  // Only sent when the field is shown (i.e. was missing) and filled.
  if (showHeightField.value) {
    const cm = resolveHeightCm();
    if (cm !== null) params.set("height_cm", String(cm));
  }
  if (showSexField.value && sexStr.value !== "") params.set("sex", sexStr.value);
  if (showDobField.value && !blank(dobStr.value)) params.set("dob", dobStr.value);
  const q = params.toString();
  return q ? `/v1/phase-estimate?${q}` : "/v1/phase-estimate";
}

// Track which fields the USER has typed into. The estimate re-fetches when the
// activity level / target / phase type change, and should refresh its OWN
// previously-suggested values — but must never clobber a value the user typed.
// `blank()` can't distinguish "estimate filled this" from "user typed this"
// once a field is populated, so we track edits explicitly.
const tdeeUserEdited = ref(false);
const macrosUserEdited = ref(false);
function onTdeeInput(): void {
  tdeeUserEdited.value = true;
}
function onMacroInput(): void {
  macrosUserEdited.value = true;
}

async function fetchEstimate(): Promise<void> {
  try {
    const est = await props.client.get(estimateUrl(), PhaseEstimateResponseSchema);
    // Adopt the estimated TDEE unless the user has typed their own — so changing
    // the activity level visibly moves the number (the whole point of the
    // selector), while a hand-entered override is preserved.
    if (!tdeeUserEdited.value) tdeeStr.value = String(est.tdee);
    // Same for macros: refresh the suggestion as the target/weight change, but
    // never overwrite a user-edited split. suggested_macros is null until a
    // weight exists (cold start), so macros stay empty until then.
    if (est.suggested_macros && !macrosUserEdited.value) {
      const m = est.suggested_macros;
      proteinStr.value = String(m.protein_g);
      carbStr.value = String(m.carb_g);
      fatStr.value = String(m.fat_g);
    }
  } catch {
    // A failed estimate just leaves fields empty for manual entry; no crash.
  }
}

// --- profile fetch (create mode) ---
// Reads the current user to decide which profile fields are missing and to seed
// the unit toggle from the saved preference.
async function fetchProfile(): Promise<void> {
  try {
    const user = await props.client.get("/v1/users/me", UserResponseSchema);
    heightMissing.value = user.height_cm == null;
    sexMissing.value = user.sex == null;
    dobMissing.value = user.dob == null;
    savedUnitSystem.value = user.preferred_unit_system;
    unitSystem.value = user.preferred_unit_system;
  } catch {
    // A failed profile fetch leaves the section hidden (treat as not-missing);
    // the user can still create a phase — only the cold-start refinement is lost.
  }
}

onMounted(() => {
  if (props.mode === "create") {
    void fetchEstimate();
    void fetchProfile();
  }
});

// Re-fetch in create mode when any input that shapes the estimate changes —
// including the typed weight (it anchors macros + TDEE) and the unit toggle
// (it changes how that weight converts to kg).
if (props.mode === "create") {
  watch(
    [
      targetStr,
      phaseType,
      activityLevel,
      weightStr,
      unitSystem,
      heightCmStr,
      heightFtStr,
      heightInStr,
      sexStr,
      dobStr,
    ],
    () => {
      void fetchEstimate();
    },
  );
}

// --- derived display ---
const showWeightField = computed(() => !props.hasWeight);

// Profile section (create mode only): shown when any of height/sex/dob is
// missing. Each row is gated independently below.
const showHeightField = computed(() => props.mode === "create" && heightMissing.value);
const showSexField = computed(() => props.mode === "create" && sexMissing.value);
const showDobField = computed(() => props.mode === "create" && dobMissing.value);
const showProfileSection = computed(
  () => showHeightField.value || showSexField.value || showDobField.value,
);
// The unit toggle only governs cold-start weight/height entry, so it lives with
// the create flow (edit mode never re-collects either).
const showUnitToggle = computed(() => props.mode === "create");
const isImperial = computed(() => unitSystem.value === "imperial");
// Activity level only drives the cold-start ESTIMATE, which only the create
// flow fetches. In edit mode the user is directly overriding the snapshotted
// tdee_at_phase_start, so an activity selector there is misleading — hide it.
const showActivity = computed(
  () => props.mode === "create" && props.tdeeBasis === "profile_baseline",
);

const tdeeEstimated = computed(() => props.tdeeBasis === "profile_baseline");
const tdeeBadgeText = computed(() => (tdeeEstimated.value ? "estimated" : "measured"));
const tdeeCaption = computed(() =>
  tdeeEstimated.value
    ? "we'll refine this as you log"
    : "from your last 30 days · edit only if you disagree",
);

const deficitLine = computed<string>(() => {
  const d = deficitKcal.value;
  if (d === null) return "";
  if (d === 0) return "Deficit: 0 kcal/day (maintenance)";
  const verb = d < 0 ? "Deficit" : "Surplus";
  return `${verb}: ${Math.abs(d)} kcal/day`;
});

const showNewPhaseHint = computed(
  () => props.mode === "edit" && tier2Touched.value && (props.loggedDays ?? 0) >= 3,
);

const error = ref<string | null>(null);
const pending = ref(false);

// Required fields: name + target + tdee always; in cold start also a weight.
// Any SHOWN profile field (height/sex/dob) must also be filled.
const requiredMissing = computed(() => {
  if (nameStr.value.trim() === "") return true;
  if (parseIntOrNull(targetStr.value) === null) return true;
  if (parseIntOrNull(tdeeStr.value) === null) return true;
  if (showWeightField.value && blank(weightStr.value)) return true;
  // A shown height must resolve to a positive cm — this also blocks a 0/blank
  // imperial entry (ft=0/in=0) that would otherwise 400 server-side.
  if (showHeightField.value && resolveHeightCm() === null) return true;
  if (showSexField.value && sexStr.value === "") return true;
  if (showDobField.value && blank(dobStr.value)) return true;
  return false;
});

const submitDisabled = computed(
  () => pending.value || bandError.value !== null || requiredMissing.value,
);

const weightLabel = computed(() => `Current weight (${weightUnitLabel(unitSystem.value)})`);

const activityOptions: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary" },
  { value: "light", label: "Lightly active" },
  { value: "moderate", label: "Moderately active" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very active" },
];

// Resolve the supplied height (if the field was shown) to whole cm, honoring
// the chosen unit. Returns null when no height was collected — including a
// resolved 0 (e.g. ft=0/in=0), which the server would reject as non-positive.
function resolveHeightCm(): number | null {
  if (!showHeightField.value) return null;
  let cm: number | null;
  if (isImperial.value) {
    const ft = parseIntOrNull(heightFtStr.value) ?? 0;
    const inch = parseIntOrNull(heightInStr.value) ?? 0;
    cm = ftInToCm(ft, inch);
  } else {
    cm = parseIntOrNull(heightCmStr.value);
  }
  return cm !== null && cm > 0 ? cm : null;
}

// Build the user-profile PATCH body from ONLY the missing fields the user
// supplied, plus preferred_unit_system if the toggle changed. Returns null when
// there's nothing to update.
function buildProfilePatch(): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const heightCm = resolveHeightCm();
  if (heightCm !== null) patch.height_cm = heightCm;
  if (showSexField.value && sexStr.value !== "") patch.sex = sexStr.value;
  if (showDobField.value && !blank(dobStr.value)) patch.dob = dobStr.value;
  if (unitSystem.value !== savedUnitSystem.value) patch.preferred_unit_system = unitSystem.value;
  // Persist the activity level to the USER profile, not just the TDEE preview.
  // The activity field is only shown/used on a cold-start (profile_baseline)
  // phase; before this it seeded the TDEE estimate but was never saved, so the
  // Settings page showed "Not set" after onboarding.
  if (props.tdeeBasis === "profile_baseline") patch.activity_level = activityLevel.value;
  return Object.keys(patch).length === 0 ? null : patch;
}

async function onSubmit(): Promise<void> {
  if (submitDisabled.value || pending.value) return;
  let target = parseIntOrNull(targetStr.value);
  let tdeeVal = parseIntOrNull(tdeeStr.value);
  if (target === null || tdeeVal === null) return;

  pending.value = true;
  error.value = null;
  try {
    if (props.mode === "create") {
      // 1) Save any supplied profile fields FIRST so the weigh-in/phase use the
      //    corrected context. Re-fetch the estimate afterward so the snapshotted
      //    tdee_override reflects the real profile (not the cold-start defaults).
      const profilePatch = buildProfilePatch();
      if (profilePatch) {
        await props.client.patch("/v1/users/me", profilePatch, UserResponseSchema);
        // Re-derive TDEE from the corrected profile so the snapshotted override
        // reflects the real height/sex/dob — but ONLY when the user hasn't typed
        // their own TDEE (otherwise we'd silently discard their value).
        if (!tdeeUserEdited.value) {
          try {
            const est = await props.client.get(estimateUrl(), PhaseEstimateResponseSchema);
            tdeeStr.value = String(est.tdee);
            tdeeVal = est.tdee;
          } catch {
            // Re-fetch failure: keep the displayed TDEE as the override.
          }
        }
      }
      // 2) Weigh-in (cold start only).
      if (!props.hasWeight) {
        const kg = displayWeightToKg(Number(String(weightStr.value).trim()) || 0, unitSystem.value);
        await props.client.post(
          "/v1/body-weights",
          { measured_on: startedOn.value, weight_kg: kg },
          BodyWeightResponseSchema,
        );
      }
      // 3) Phase.
      // Send tdee_override ONLY when the user typed their own TDEE. When they
      // accept the displayed estimate, let the server compute it so the row
      // records tdee_source: "formula" instead of falsely claiming the user
      // asserted a number the server produced.
      const payload: Record<string, unknown> = {
        name: nameStr.value.trim(),
        intent: phaseType.value,
        phase_type: phaseType.value,
        daily_kcal_target: target,
        base_protein_g: parseMacro(proteinStr.value),
        base_carb_g: parseMacro(carbStr.value),
        base_fat_g: parseMacro(fatStr.value),
        started_on: startedOn.value,
      };
      if (tdeeUserEdited.value) payload.tdee_override = tdeeVal;
      if (plannedEndOn.value.trim() !== "") payload.planned_end_on = plannedEndOn.value.trim();
      if (notesStr.value.trim() !== "") payload.notes = notesStr.value.trim();
      await props.client.post("/v1/nutrition-phases", payload, NutritionPhaseResponseSchema);
    } else {
      const p = props.phase;
      if (!p) return;
      const patch: Record<string, unknown> = {};
      const name = nameStr.value.trim();
      if (name !== p.name) patch.name = name;
      if (phaseType.value !== p.phase_type) {
        patch.phase_type = phaseType.value;
        patch.intent = phaseType.value;
      }
      const targetChanged = target !== p.daily_kcal_target;
      const tdeeChanged = tdeeVal !== p.tdee_at_phase_start;
      // Keep the invariant consistent: a target change must carry the
      // recomputed deficit; a tdee change must carry tdee_at_phase_start.
      if (targetChanged) {
        patch.daily_kcal_target = target;
        patch.deficit_kcal = target - tdeeVal;
      }
      if (tdeeChanged) {
        patch.tdee_at_phase_start = tdeeVal;
        // If only tdee moved, the deficit shifts too — keep it consistent.
        if (!targetChanged) patch.deficit_kcal = target - tdeeVal;
      }
      const protein = parseMacro(proteinStr.value);
      const carb = parseMacro(carbStr.value);
      const fat = parseMacro(fatStr.value);
      if (protein !== p.base_protein_g) patch.base_protein_g = protein;
      if (carb !== p.base_carb_g) patch.base_carb_g = carb;
      if (fat !== p.base_fat_g) patch.base_fat_g = fat;
      if (startedOn.value !== p.started_on) patch.started_on = startedOn.value;
      const planned = plannedEndOn.value.trim() === "" ? null : plannedEndOn.value.trim();
      if (planned !== (p.planned_end_on ?? null)) patch.planned_end_on = planned;
      const notes = notesStr.value.trim() === "" ? null : notesStr.value.trim();
      if (notes !== (p.notes ?? null)) patch.notes = notes;
      await props.client.patch(`/v1/nutrition-phases/${p.id}`, patch, NutritionPhaseResponseSchema);
    }
    emit("saved");
    emit("close");
  } catch (e) {
    error.value =
      e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.";
  } finally {
    pending.value = false;
  }
}

function onCancel(): void {
  emit("close");
}

function onRequestCreateFromCurrent(): void {
  emit("request-create-from-current");
}
</script>

<template>
  <div
    ref="dialogRef"
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    tabindex="-1"
    data-test="phase-form-modal"
    @keydown.esc="onCancel"
  >
    <div class="modal">
      <h3 :id="titleId" class="title">
        {{ mode === "create" ? "Start a phase" : "Edit phase" }}
      </h3>

      <div class="grid">
        <label for="pf-name">Name</label>
        <span class="field">
          <input
            id="pf-name"
            v-model="nameStr"
            type="text"
            data-test="phase-name"
            placeholder="e.g. Spring cut"
            @keydown.esc="onCancel"
          />
        </span>

        <label for="pf-type">Type</label>
        <span class="field">
          <select id="pf-type" v-model="phaseType" data-test="phase-type">
            <option value="cut">Cut</option>
            <option value="bulk">Bulk</option>
            <option value="maintenance">Maintain</option>
          </select>
        </span>

        <template v-if="showUnitToggle">
          <label for="pf-units">Units</label>
          <span class="field">
            <select id="pf-units" v-model="unitSystem" data-test="unit-toggle">
              <option value="metric">Metric (kg / cm)</option>
              <option value="imperial">Imperial (lb / ft-in)</option>
            </select>
          </span>
        </template>

        <template v-if="showWeightField">
          <label for="pf-weight">{{ weightLabel }}</label>
          <span class="field">
            <input
              id="pf-weight"
              v-model="weightStr"
              type="number"
              inputmode="decimal"
              data-test="current-weight"
              @keydown.esc="onCancel"
            />
          </span>
        </template>

        <template v-if="showProfileSection">
          <h4 class="section-head" data-test="profile-details">Your details</h4>

          <template v-if="showHeightField">
            <label for="pf-height">Height ({{ isImperial ? "ft / in" : "cm" }})</label>
            <span v-if="isImperial" class="field height-imperial">
              <input
                id="pf-height"
                v-model="heightFtStr"
                type="number"
                inputmode="numeric"
                placeholder="ft"
                data-test="profile-height-ft"
                @keydown.esc="onCancel"
              />
              <input
                v-model="heightInStr"
                type="number"
                inputmode="numeric"
                placeholder="in"
                data-test="profile-height-in"
                @keydown.esc="onCancel"
              />
            </span>
            <span v-else class="field">
              <input
                id="pf-height"
                v-model="heightCmStr"
                type="number"
                inputmode="numeric"
                data-test="profile-height-cm"
                @keydown.esc="onCancel"
              />
            </span>
          </template>

          <template v-if="showSexField">
            <label for="pf-sex">Sex</label>
            <span class="field">
              <select id="pf-sex" v-model="sexStr" data-test="profile-sex">
                <option value="" disabled>Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </span>
          </template>

          <template v-if="showDobField">
            <label for="pf-dob">Date of birth</label>
            <span class="field">
              <input
                id="pf-dob"
                v-model="dobStr"
                type="date"
                data-test="profile-dob"
                @keydown.esc="onCancel"
              />
            </span>
          </template>
        </template>

        <template v-if="showActivity">
          <label for="pf-activity">Activity</label>
          <span class="field">
            <select id="pf-activity" v-model="activityLevel" data-test="activity-level">
              <option v-for="opt in activityOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </span>
        </template>

        <label for="pf-tdee">
          TDEE
          <span class="badge" :class="tdeeEstimated ? 'amber' : 'green'">{{ tdeeBadgeText }}</span>
        </label>
        <span class="field tdee-field">
          <input
            id="pf-tdee"
            v-model="tdeeStr"
            type="number"
            inputmode="numeric"
            data-test="tdee"
            @input="onTdeeInput"
            @keydown.esc="onCancel"
          />
          <span class="caption">{{ tdeeCaption }}</span>
        </span>

        <label for="pf-target">Daily target (kcal)</label>
        <span class="field">
          <input
            id="pf-target"
            v-model="targetStr"
            type="number"
            inputmode="numeric"
            data-test="target-kcal"
            @keydown.esc="onCancel"
          />
        </span>

        <span v-if="deficitLine" class="deficit-line" data-test="deficit-line">{{ deficitLine }}</span>

        <label class="m-pro">Protein (g)</label>
        <span class="field macro">
          <input v-model="proteinStr" type="number" inputmode="numeric" data-test="protein" @input="onMacroInput" @keydown.esc="onCancel" />
        </span>
        <label class="m-carb">Carbs (g)</label>
        <span class="field macro">
          <input v-model="carbStr" type="number" inputmode="numeric" data-test="carb" @input="onMacroInput" @keydown.esc="onCancel" />
        </span>
        <label class="m-fat">Fat (g)</label>
        <span class="field macro">
          <input v-model="fatStr" type="number" inputmode="numeric" data-test="fat" @input="onMacroInput" @keydown.esc="onCancel" />
        </span>

        <label for="pf-start">Start date</label>
        <span class="field">
          <input id="pf-start" v-model="startedOn" type="date" data-test="started-on" @keydown.esc="onCancel" />
        </span>

        <label for="pf-end">Planned end</label>
        <span class="field">
          <input id="pf-end" v-model="plannedEndOn" type="date" data-test="planned-end-on" @keydown.esc="onCancel" />
        </span>

        <label for="pf-notes">Notes</label>
        <span class="field">
          <input id="pf-notes" v-model="notesStr" type="text" data-test="notes" placeholder="optional" @keydown.esc="onCancel" />
        </span>
      </div>

      <p v-if="mode === 'edit' && tier2Touched" class="rescore" data-test="rescore-note">
        Changing these re-scores logged days in this phase.
      </p>

      <div v-if="showNewPhaseHint" class="new-phase-hint" data-test="new-phase-hint">
        <span>Big change? You can</span>
        <button type="button" class="linklike" @click="onRequestCreateFromCurrent">
          start a new phase instead
        </button>
        <span>and keep this one's history.</span>
      </div>

      <p v-if="bandError" class="band-error" data-test="band-error">{{ bandError }}</p>
      <p v-if="error" class="form-error" data-test="phase-form-error">{{ error }}</p>

      <div class="actions">
        <button
          type="button"
          class="primary"
          data-test="submit"
          :disabled="submitDisabled"
          @click="onSubmit"
        >
          {{ pending ? "Saving…" : mode === "create" ? "Start phase" : "Save changes" }}
        </button>
        <button type="button" class="ghost" data-test="cancel" :disabled="pending" @click="onCancel">
          Cancel
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
  gap: 14px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  row-gap: 10px;
  column-gap: 12px;
  align-items: center;
}
.grid > label {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.grid label.m-pro { color: var(--m-protein, #6fb3ff); }
.grid label.m-carb { color: var(--m-carb, #f0c36d); }
.grid label.m-fat { color: var(--m-fat, #f08a8a); }
.field {
  display: inline-flex;
  flex-direction: column;
  gap: 3px;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 5px 8px;
}
.field:focus-within {
  border-color: var(--accent, #4a7dff);
}
.field input,
.field select {
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
  color-scheme: dark;
  width: 100%;
}
.field.macro {
  max-width: 110px;
}
.section-head {
  /* Span both grid columns so the heading is a full-width row break — without
     this it sits in the label column and shifts every following label/input
     pair by one cell, staggering the two columns. */
  grid-column: 1 / -1;
  margin: 10px 0 2px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint, #9aa0ad);
}
.field.height-imperial {
  flex-direction: row;
  gap: 6px;
  max-width: 160px;
}
.field.height-imperial input {
  min-width: 0;
}
.tdee-field .caption {
  font-size: 10px;
  color: var(--ink-faint, #6b7180);
}
.badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}
.badge.amber {
  color: #f0c36d;
  background: rgba(240, 195, 109, 0.15);
}
.badge.green {
  color: #7fd18a;
  background: rgba(127, 209, 138, 0.15);
}
.deficit-line {
  /* Full-width row so appearing/disappearing as the target is typed never
     changes the grid's cell count (which would stagger the columns below). */
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.rescore {
  margin: 0;
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
}
.new-phase-hint {
  font-size: 12px;
  color: var(--ink-dim, #9aa0ad);
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 8px 10px;
}
.new-phase-hint .linklike {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent, #4a7dff);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
.band-error {
  margin: 0;
  font-size: 12px;
  color: var(--bad, #f08a8a);
}
.form-error {
  margin: 0;
  font-size: 12px;
  color: var(--bad, #f08a8a);
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
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
  font-size: 13px;
  cursor: pointer;
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
