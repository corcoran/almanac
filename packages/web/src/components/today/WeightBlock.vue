<script setup lang="ts">
import { BodyWeightResponseSchema, type TodayContextResponseSchema } from "@almanac/core/schemas";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { z } from "zod";
import type { ApiClient } from "../../api/client.js";
import { useInlineEdit } from "../../composables/useInlineEdit.js";
import { sparklinePoints } from "../../lib/sparkline.js";
import {
  displayWeightToKg,
  kgToDisplayWeight,
  type UnitSystem,
  weightUnitLabel,
} from "../../lib/units.js";
import BlockEditButton from "./BlockEditButton.vue";

type TodayBlock = z.infer<typeof TodayContextResponseSchema>["today"];
type TrendWeight = z.infer<typeof TodayContextResponseSchema>["trend_weight"];
type BodyWeight = z.infer<typeof BodyWeightResponseSchema>;

const props = defineProps<{
  todayBody: TodayBlock;
  trend: TrendWeight;
  series: BodyWeight[];
  unitSystem: UnitSystem;
  client: ApiClient;
  timezone: string;
  date: string;
}>();

const emit = defineEmits<(e: "saved") => void>();

/**
 * Sparkline geometry. The viewBox width tracks the container's rendered
 * width via ResizeObserver so the SVG coordinate system matches the
 * actual pixel dimensions. This lets us use preserveAspectRatio="none"
 * to fill the container without distorting text labels — the viewBox
 * and container have the same aspect ratio so "none" is effectively a
 * 1:1 mapping.
 *
 * The rendered height is fixed at 80px (CSS). The viewBox height is
 * set to match so labels render at their true font-size.
 */
const RENDERED_H = 80;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 8;
const PADDING_LEFT = 12;
const PADDING_RIGHT = 12;

const sparklineRef = ref<HTMLDivElement | null>(null);
const containerWidth = ref(280);

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (sparklineRef.value) {
    containerWidth.value = sparklineRef.value.clientWidth;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth.value = entry.contentRect.width;
      }
    });
    resizeObserver.observe(sparklineRef.value);
  }
});
onBeforeUnmount(() => resizeObserver?.disconnect());

const svgW = computed(() => containerWidth.value);
const svgH = RENDERED_H;
const chartW = computed(() => svgW.value - PADDING_LEFT - PADDING_RIGHT);
const chartH = svgH - PADDING_TOP - PADDING_BOTTOM;
const sparklineDims = computed(() => ({ width: chartW.value, height: chartH }));

const unitLabel = computed(() => weightUnitLabel(props.unitSystem));

// Label sizing in viewBox units. Since the viewBox matches the container's
// pixel width, we need to express a constant ~9px visual size in viewBox
// coords. At 375px container width 9 viewBox-units = 9px; at 500px it
// would be 9px too because viewBox = container. So just use 9.
// The stroke-width halo scales similarly.
const labelFontSize = 11;
const labelStrokeWidth = 2;

/**
 * Today's weight kg — prefer `body_weight_kg` (today's measurement) and fall
 * back to `most_recent_weight.value_kg` so the block still shows useful info
 * if the user hasn't weighed in yet today.
 */
const todayKg = computed<number | null>(() => {
  if (props.todayBody.body_weight_kg !== null) {
    return props.todayBody.body_weight_kg;
  }
  return props.todayBody.most_recent_weight?.value_kg ?? null;
});

const todayDisplay = computed(() => kgToDisplayWeight(todayKg.value, props.unitSystem));

const trendDisplay = computed(() => kgToDisplayWeight(props.trend.current_kg, props.unitSystem));

/**
 * Today − trend in the user's display unit. The sign mirrors the API's
 * weight_change convention (negative = lost).
 */
const vsTrend = computed<number | null>(() => {
  if (todayKg.value === null || props.trend.current_kg === null) return null;
  const deltaKg = todayKg.value - props.trend.current_kg;
  const display = kgToDisplayWeight(deltaKg, props.unitSystem);
  return display === null ? null : round2(display);
});

const change = computed(() => props.trend.weight_change);
const changeDisplay = computed(() => {
  if (!change.value) return null;
  return kgToDisplayWeight(change.value.value_kg, props.unitSystem);
});

const polylinePoints = computed(() => {
  if (props.series.length === 0) return "";
  return sparklinePoints(
    props.series.map((p) => ({ value: p.weight_kg })),
    sparklineDims.value,
  );
});

/**
 * Parsed (x, y) coordinates for each series point, in the SVG viewBox space.
 * Drives both the per-point circle markers and the value labels.
 */
const sparklineCoords = computed<Array<{ x: number; y: number }>>(() => {
  const raw = polylinePoints.value;
  if (!raw) return [];
  return raw.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x ?? 0, y: y ?? 0 };
  });
});

/**
 * Resolved label data for the sparkline. To avoid clutter on a 14-point
 * series in a 280px-wide chart, we label only the first, last, min, and max
 * points. The set of indices is deduped (a coincidence like first == min
 * mustn't stack two `<text>` elements on the same coordinate), then each
 * surviving index is resolved to its coordinate + weight here rather than
 * re-indexed in the template — so the template never indexes by a number the
 * compiler can't prove is in range.
 */
const labeledPoints = computed<Array<{ i: number; x: number; y: number; weight_kg: number }>>(
  () => {
    const series = props.series;
    const coords = sparklineCoords.value;
    if (series.length === 0) return [];

    let minIdx = 0;
    let maxIdx = 0;
    let minWeight = series[0]?.weight_kg ?? 0;
    let maxWeight = minWeight;
    for (let i = 1; i < series.length; i++) {
      const w = series[i]?.weight_kg;
      if (w === undefined) continue;
      if (w < minWeight) {
        minWeight = w;
        minIdx = i;
      }
      if (w > maxWeight) {
        maxWeight = w;
        maxIdx = i;
      }
    }
    const set = new Set<number>([0, series.length - 1, minIdx, maxIdx]);
    return [...set]
      .sort((a, b) => a - b)
      .flatMap((i) => {
        const point = series[i];
        const coord = coords[i];
        if (point === undefined || coord === undefined) return [];
        return [{ i, x: coord.x, y: coord.y, weight_kg: point.weight_kg }];
      });
  },
);

/** Format a kg value for the sparkline label, respecting the user's unit. */
function formatPointLabel(kg: number): string {
  const display = kgToDisplayWeight(kg, props.unitSystem);
  if (display === null) return "";
  // One decimal place; the SVG text element has limited room.
  return (Math.round(display * 10) / 10).toFixed(1);
}

/**
 * Pick a text-anchor that keeps labels inside the chart at the edges:
 * left-anchor the first point so its label doesn't bleed left of x=0,
 * right-anchor the last so its label doesn't run off the right edge.
 */
function labelAnchor(index: number): "start" | "middle" | "end" {
  if (index === 0) return "start";
  if (index === props.series.length - 1) return "end";
  return "middle";
}

const xAxisLabels = computed<{ left: string; right: string } | null>(() => {
  const series = props.series;
  const first = series[0];
  const last = series[series.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    left: formatShortDate(first.measured_on),
    right: `${formatShortDate(last.measured_on)} (today)`,
  };
});

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDelta(n: number): string {
  // One decimal place — consistent with the sparkline/EMA labels.
  const fixed = n.toFixed(1);
  return n > 0 ? `+${fixed}` : fixed;
}

// --- Inline edit ---

const edit = useInlineEdit();
const draft = ref("");
const weightInputRef = ref<HTMLInputElement | null>(null);

function beginEdit(): void {
  const display = kgToDisplayWeight(todayKg.value, props.unitSystem);
  draft.value = display === null ? "" : String(display);
  edit.startEdit();
  void nextTick(() => weightInputRef.value?.focus());
}

const isInputValid = computed(() => {
  const n = Number.parseFloat(draft.value);
  return draft.value.trim() !== "" && Number.isFinite(n) && n > 0;
});
const saveDisabled = computed(() => edit.pending.value || !isInputValid.value);

async function onSave(): Promise<void> {
  const n = Number.parseFloat(draft.value);
  if (!(Number.isFinite(n) && n > 0)) return;
  const weightKg = displayWeightToKg(n, props.unitSystem);
  const measuredOn = props.date;
  await edit.save(async () => {
    await props.client.post(
      "/v1/body-weights",
      { measured_on: measuredOn, weight_kg: weightKg },
      BodyWeightResponseSchema,
    );
    emit("saved");
  });
}
</script>

<template>
  <div class="block" data-test="weight-block">
    <BlockEditButton v-if="!edit.isEditing.value" label="Edit weight" @click="beginEdit" />

    <div v-if="!edit.isEditing.value" class="stat-row">
      <span class="label">Weight</span>
      <template v-if="todayDisplay !== null">
        <span class="val">{{ todayDisplay }} {{ unitLabel }}</span>
        <span v-if="vsTrend !== null" class="delta" :class="vsTrend < 0 ? 'dn' : 'up'">
          {{ formatDelta(vsTrend) }} vs trend
        </span>
      </template>
      <span v-else class="val placeholder">— no data</span>
    </div>

    <div v-else class="stat-row edit-row">
      <span class="label">Weight</span>
      <input
        ref="weightInputRef"
        v-model="draft"
        type="text"
        inputmode="decimal"
        class="weight-edit-input"
        data-test="weight-edit-input"
        @keydown.esc="edit.cancel()"
        @keydown.enter.prevent="!saveDisabled && onSave()"
      />
      <span class="unit-label">{{ unitLabel }}</span>
      <button
        type="button"
        class="save"
        data-test="weight-edit-save"
        :disabled="saveDisabled"
        @click="onSave"
      >
        Save
      </button>
      <button
        type="button"
        class="cancel"
        data-test="weight-edit-cancel"
        aria-label="Cancel"
        :disabled="edit.pending.value"
        @click="edit.cancel()"
      >
        ×
      </button>
    </div>
    <div v-if="edit.error.value" class="edit-error" data-test="weight-edit-error">
      {{ edit.error.value }}
    </div>

    <div v-if="trendDisplay !== null" class="stat-row">
      <span class="label" title="10-day exponential moving average">EMA (10d)</span>
      <span class="val ema">{{ trendDisplay }} {{ unitLabel }}</span>
      <span
        v-if="change && changeDisplay !== null"
        class="delta"
        :class="changeDisplay < 0 ? 'dn' : 'up'"
      >
        {{ formatDelta(changeDisplay) }} / {{ change.over_days }}d
      </span>
    </div>

    <div v-if="series.length > 0" ref="sparklineRef" class="sparkline-wrap">
    <svg
      class="sparkline"
      :viewBox="`0 0 ${svgW} ${svgH}`"
    >
      <g :transform="`translate(${PADDING_LEFT}, ${PADDING_TOP})`">
        <polyline
          fill="none"
          stroke="var(--accent, #6ea8ff)"
          stroke-width="1.5"
          :points="polylinePoints"
        />
        <circle
          v-for="(pt, i) in sparklineCoords"
          :key="`pt-${i}`"
          :cx="pt.x"
          :cy="pt.y"
          r="2"
          fill="var(--accent, #6ea8ff)"
          data-test="weight-point"
        />
        <text
          v-for="pt in labeledPoints"
          :key="`lbl-${pt.i}`"
          :x="pt.x"
          :y="pt.y - 6"
          :text-anchor="labelAnchor(pt.i)"
          class="weight-point-label"
          :font-size="labelFontSize"
          :stroke-width="labelStrokeWidth"
          data-test="weight-point-label"
        >{{ formatPointLabel(pt.weight_kg) }}</text>
      </g>
    </svg>
    </div>
    <div v-if="xAxisLabels" class="x-axis">
      <span>{{ xAxisLabels.left }}</span>
      <span>{{ xAxisLabels.right }}</span>
    </div>
  </div>
</template>

<style scoped>
.block {
  position: relative;
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.stat-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.stat-row .label {
  color: var(--ink-faint, #6b7180);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stat-row .val {
  font-variant-numeric: tabular-nums;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
}
.stat-row .val.ema {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-dim, #9aa0ad);
}
.stat-row .val.placeholder {
  font-style: italic;
  font-weight: 400;
  color: var(--ink-faint, #6b7180);
}
.stat-row .delta {
  color: var(--ink-dim, #9aa0ad);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.stat-row .delta.up { color: var(--bad, #f08a8a); }
.stat-row .delta.dn { color: var(--good, #6ee7a8); }
.sparkline-wrap {
  width: 100%;
}
.sparkline {
  width: 100%;
  height: auto;
  display: block;
}
.sparkline .weight-point-label {
  fill: var(--ink, #e6e8ee);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  paint-order: stroke;
  stroke: var(--panel, #161922);
}
.x-axis {
  font-size: 10px;
  color: var(--ink-faint, #6b7180);
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
}
.edit-row {
  align-items: center;
}
.weight-edit-input {
  width: 80px;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  color: var(--ink, #e6e8ee);
}
.weight-edit-input:focus {
  outline: none;
  border-color: var(--accent, #4a7dff);
}
.unit-label {
  color: var(--ink-dim, #9aa0ad);
  font-size: 12px;
}
.edit-row .save {
  margin-left: auto;
  background: var(--accent, #4a7dff);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.edit-row .save:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #6b7180);
  cursor: not-allowed;
}
.edit-row .cancel {
  background: transparent;
  border: none;
  color: var(--ink-dim, #9aa0ad);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.edit-error {
  font-size: 11px;
  color: var(--bad, #f08a8a);
  margin-bottom: 6px;
}
</style>
