<script setup lang="ts">
import type { TDEEResponseSchema, TodayContextResponseSchema } from "@almanac/core/schemas";
import { computed } from "vue";
import type { z } from "zod";
import { calibrationProgress } from "../../lib/tdee-calibration.js";
import PhaseOnboardingCard from "./PhaseOnboardingCard.vue";

type TodayContext = z.infer<typeof TodayContextResponseSchema>;
type Phase = TodayContext["phase"];
type Today = TodayContext["today"];
type TdeeBadge = Pick<
  z.infer<typeof TDEEResponseSchema>,
  "kcal" | "basis" | "days_of_data" | "components"
>;

const props = defineProps<{
  phase: Phase;
  today: Today;
  tdee?: TdeeBadge | null;
  profileComplete: boolean;
  phaseAdherence?: {
    logged_days: number;
    on_track_days: number;
    avg_delta_kcal: number | null;
  } | null;
}>();

const emit = defineEmits<{
  (e: "edit"): void;
  (e: "stop"): void;
  (e: "create"): void;
}>();

// --- Deficit / surplus / target box -----------------------------------------
// Sign convention: deficit_kcal < 0 cut, > 0 bulk, 0 maintenance.
const deficitBox = computed<{
  label: string;
  value: string;
  tone: "cut" | "bulk" | "neutral";
  sub: string;
} | null>(() => {
  if (!props.phase) return null;
  const d = props.phase.deficit_kcal;
  const target = props.today.target?.kcal ?? props.phase.daily_kcal_target;
  if (d == null) return null;
  if (d === 0) {
    return { label: "Daily target", value: `${target}`, tone: "neutral", sub: "maintenance" };
  }
  if (d < 0) {
    return {
      label: "Daily deficit",
      value: `−${Math.abs(d)}`,
      tone: "cut",
      sub: `target ${target}`,
    };
  }
  return { label: "Daily surplus", value: `+${d}`, tone: "bulk", sub: `target ${target}` };
});

// --- On Target box (phase-to-date adherence) --------------------------------
// count = X / N (on-target logged days / logged days). avgLabel adapts to the
// phase type: cut shows a deficit (−), bulk a surplus (+), maintenance the
// signed distance (±). Omitted (null) while there's no TDEE anchor.
const adherenceBox = computed<{ count: string; avgLabel: string | null } | null>(() => {
  const a = props.phaseAdherence;
  if (!a || !props.phase) return null;
  const count = `${a.on_track_days} / ${a.logged_days}`;
  let avgLabel: string | null = null;
  if (a.avg_delta_kcal != null) {
    const d = a.avg_delta_kcal;
    const type = props.phase.phase_type ?? props.phase.intent;
    if (d === 0) {
      // A dead-on average reads the same regardless of phase intent.
      avgLabel = "avg ±0 / day";
    } else if (type === "bulk") {
      avgLabel = `avg +${Math.abs(d)} / day`;
    } else if (type === "maintenance") {
      const sign = d > 0 ? "+" : "−";
      avgLabel = `avg ${sign}${Math.abs(d)} / day`;
    } else {
      // cut (and default): the delta is a deficit (expected negative)
      avgLabel = `avg −${Math.abs(d)} / day`;
    }
  }
  return { count, avgLabel };
});

// --- TDEE: calibrated box vs calibrating chip -------------------------------
const isCalibrating = computed(() => props.tdee?.basis === "profile_baseline");

const calibration = computed(() => {
  const t = props.tdee;
  // biome-ignore lint/complexity/useOptionalChain: `!t` narrows t to non-null for the t.components/t.days_of_data access below; t?.basis would not narrow.
  if (!t || t.basis !== "profile_baseline") return null;
  // The response carries whichever calibration gate is still outstanding —
  // weigh-in days OR meal days (never both). Pass both so the chip reports the
  // active one instead of "0 weigh-ins to go" while blocked on meals.
  return calibrationProgress(t.days_of_data, {
    daysRemaining: t.components.days_remaining_to_calibrate,
    mealDaysRemaining: t.components.meal_days_remaining_to_calibrate,
  });
});

// Show the calibrated Current-TDEE box whenever the basis is measured. The
// Phase TDEE box beside it is gated separately on having an anchor.
const showTdeeBox = computed(() => props.tdee != null && props.tdee.basis === "measured_intake");

function formatStartedOn(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

const showTitle = computed(() => {
  if (!props.phase) return false;
  const name = props.phase.name.trim();
  if (name === "") return false;
  return name.toLowerCase() !== props.phase.intent.toLowerCase();
});

const phaseTypeLabel = computed<string>(() => {
  if (!props.phase) return "";
  return props.phase.phase_type ?? props.phase.intent;
});

const phasePillTone = computed<"cut" | "bulk" | "neutral">(() => {
  const t = props.phase?.phase_type ?? props.phase?.intent;
  if (t === "bulk") return "bulk";
  if (t === "maintenance") return "neutral";
  return "cut";
});

const emptyState = computed<"none" | "onboarding">(() => (props.phase ? "none" : "onboarding"));
</script>

<template>
  <PhaseOnboardingCard
    v-if="emptyState === 'onboarding'"
    :profile-complete="profileComplete"
    @create="emit('create')"
  />
  <div v-else-if="phase" class="block phase-header" data-test="phase-header">
    <div class="phase-row">
      <div class="left">
        <span class="pill" :class="`pill--${phasePillTone}`">● {{ phaseTypeLabel }}</span>
        <div v-if="showTitle" class="name">{{ phase.name }}</div>
        <div class="meta" data-test="phase-meta">
          day {{ phase.days_in }}<template v-if="phaseAdherence"> ({{ phaseAdherence.logged_days }} tracked)</template>
          <template v-if="showTitle && phase.started_on"> · started {{ formatStartedOn(phase.started_on) }}</template>
        </div>
        <div v-if="phase" class="phase-controls">
          <button type="button" class="ctrl" data-test="phase-edit" @click="emit('edit')">
            ✎ Edit
          </button>
          <button type="button" class="ctrl" data-test="phase-stop" @click="emit('stop')">
            Stop
          </button>
        </div>
      </div>

      <div class="right">
        <!-- Phase TDEE: the snapshot anchored at phase start. Shown in the
             calibrated state beside Current TDEE so drift reads at a glance. -->
        <div v-if="showTdeeBox && phase.tdee_at_phase_start != null" class="box" data-test="phase-tdee-box">
          <div class="cap">Phase TDEE</div>
          <div class="v now">{{ phase.tdee_at_phase_start }}</div>
        </div>

        <!-- Calibrating: progress chip replaces the Current-TDEE box -->
        <div v-if="isCalibrating && calibration" class="calib" data-test="calib-chip">
          <div class="cap">TDEE calibrating</div>
          <div class="v">
            {{ phase.tdee_at_phase_start ?? tdee?.kcal }} <span class="est">est</span>
          </div>
          <div class="prog">
            <div class="track"><i :style="{ width: `${calibration.fraction * 100}%` }" /></div>
            <div class="pcap"><b>{{ calibration.caption }}</b></div>
          </div>
        </div>

        <!-- Calibrated: Current TDEE box (live measured value, no drift line —
             the Phase TDEE box beside it makes any drift self-evident). -->
        <div v-else-if="showTdeeBox" class="box" data-test="tdee-box">
          <div class="cap">Current TDEE</div>
          <div class="v now">{{ tdee?.kcal }}</div>
        </div>

        <!-- Deficit / surplus / target box (always when we know the plan) -->
        <div v-if="deficitBox" class="box" data-test="deficit-box">
          <div class="cap">{{ deficitBox.label }}</div>
          <div class="v" :class="`tone--${deficitBox.tone}`">{{ deficitBox.value }}</div>
          <div class="sub">{{ deficitBox.sub }}</div>
        </div>

        <!-- On Target: phase-to-date adherence (X / N + avg deficit/surplus) -->
        <div v-if="adherenceBox" class="box" data-test="adherence-box">
          <div class="cap">On target</div>
          <div class="v now">{{ adherenceBox.count }}</div>
          <div v-if="adherenceBox.avgLabel" class="sub">{{ adherenceBox.avgLabel }}</div>
        </div>
      </div>
    </div>

    <div class="phase-base">
      <span class="lbl">Target</span>
      <span class="macro kcal"><b>{{ today.target?.kcal ?? phase.daily_kcal_target }}</b> <span class="tag">kcal</span></span>
      <span class="macro protein"><b>{{ today.target?.protein_g ?? phase.base_protein_g }}</b> <span class="tag"><span class="g">g</span>P</span></span>
      <span class="macro carb"><b>{{ today.target?.carb_g ?? phase.base_carb_g }}</b> <span class="tag"><span class="g">g</span>C</span></span>
      <span class="macro fat"><b>{{ today.target?.fat_g ?? phase.base_fat_g }}</b> <span class="tag"><span class="g">g</span>F</span></span>
    </div>
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
.phase-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
.left { min-width: 0; }
.pill {
  display: inline-flex; gap: 6px; align-items: center;
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
  padding: 3px 8px; border-radius: 999px; text-transform: uppercase;
}
.pill--cut { background: rgba(230, 180, 80, 0.12); color: var(--warn, #e6b450); }
.pill--bulk { background: rgba(110, 194, 124, 0.14); color: var(--ok, #6ec27c); }
.pill--neutral { background: rgba(154, 160, 173, 0.14); color: var(--ink-dim, #9aa0ad); }
.name { font-size: 16px; font-weight: 600; color: var(--ink, #e6e8ee); margin-top: 8px; }
.meta { font-size: 11px; color: var(--ink-faint, #6b7180); margin-top: 2px; font-variant-numeric: tabular-nums; }
.phase-controls { display: flex; gap: 6px; margin-top: 8px; }
.ctrl {
  background: transparent;
  border: 1px solid var(--line, #262a36);
  color: var(--ink-dim, #9aa0ad);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.ctrl:hover { color: var(--ink, #e6e8ee); border-color: var(--line-2, #353a4a); }

.right { display: flex; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }
.box, .calib {
  background: #1b1f29; border: 1px solid var(--line, #262a36); border-radius: 8px;
  padding: 8px 11px; min-width: 96px;
}
.box { text-align: center; }
.cap {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--ink-faint, #6b7180); margin-bottom: 5px;
}
.box .v { font-size: clamp(13px, 4.2vw, 17px); font-weight: 700; font-variant-numeric: tabular-nums; }
.box .v.now { color: var(--ink, #e6e8ee); }
.tone--cut { color: var(--warn, #e6b450); }
.tone--bulk { color: var(--ok, #6ec27c); }
.tone--neutral { color: var(--ink-dim, #9aa0ad); }
.box .sub { font-size: 10px; color: var(--ink-dim, #9aa0ad); margin-top: 3px; font-variant-numeric: tabular-nums; }

.calib .cap { color: var(--accent, #6ea8ff); opacity: 0.9; }
.calib .v { font-size: 17px; font-weight: 700; color: var(--ink-dim, #9aa0ad); font-variant-numeric: tabular-nums; }
.calib .v .est {
  font-size: 9px; color: var(--ink-faint, #6b7180); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px; margin-left: 4px;
}
.calib .prog { margin-top: 7px; }
.calib .track { height: 5px; background: #22262f; border-radius: 3px; overflow: hidden; }
.calib .track i { display: block; height: 100%; background: var(--accent, #6ea8ff); border-radius: 3px; }
.calib .pcap { font-size: 10px; color: var(--ink-dim, #9aa0ad); margin-top: 4px; }
.calib .pcap b { color: var(--ink, #e6e8ee); font-weight: 700; }

.phase-base {
  color: var(--ink-dim, #9aa0ad); font-size: 12px; font-variant-numeric: tabular-nums;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line, #262a36);
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
}
.phase-base .lbl {
  color: var(--ink-faint, #6b7180); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.6px;
}
.macro b { color: var(--ink, #e6e8ee); font-weight: 600; }
.macro .tag { font-size: 10px; margin-left: 2px; font-weight: 600; }
.macro .tag .g { color: var(--ink, #e6e8ee); font-weight: 600; }
.macro.kcal { color: var(--m-kcal); }
.macro.protein { color: var(--m-protein); }
.macro.carb { color: var(--m-carb); }
.macro.fat { color: var(--m-fat); }

@media (max-width: 768px) {
  .phase-row { flex-direction: column; }
  /* Stacked under the title, the boxes lay out on an explicit grid. We drive
     the column count by width rather than `auto-fit` so the count steps 2 -> 4
     and never lands on 3 (which orphaned the 4th box on its own row, the gap
     that read as wasted whitespace). Phones get a clean 2x2; once there's room
     for four full-width boxes (~620px), they go 4-across in one row. Equal 1fr
     tracks keep box values vertically aligned, the grid's left edge lines up
     with the title above it, and fonts stay full-size since boxes wrap instead
     of cramming. */
  .right {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    width: 100%;
  }
  .box, .calib { min-width: 0; padding: 7px 8px; }
}

/* Wide-but-still-mobile (tablet portrait, large phones landscape): enough room
   for all four boxes across in a single row — skip the 3-up stage entirely. */
@media (min-width: 620px) and (max-width: 768px) {
  .right { grid-template-columns: repeat(4, 1fr); }
}
</style>
