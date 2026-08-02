<script setup lang="ts">
import type {
  CalendarPastSessionSchema,
  CalendarPillEntrySchema,
  CalendarResponseSchema,
} from "@almanac/core/schemas";
import { computed } from "vue";
import type { z } from "zod";
import PillSegment from "./PillSegment.vue";
import SessionChip from "./SessionChip.vue";

type PastSession = z.infer<typeof CalendarPastSessionSchema>;
type PillEntry = z.infer<typeof CalendarPillEntrySchema>;
type UntrackedBand = z.infer<typeof CalendarResponseSchema>["untracked_bands"][number];
type Reason = UntrackedBand["reason"];
type Phase = "too_soon" | "acceptable" | "prime" | "in_window";

const props = defineProps<{
  month: string; // YYYY-MM
  pastSessions: PastSession[];
  pillSegments: PillEntry[];
  today: string; // YYYY-MM-DD — for the highlight outline
  untrackedBands: UntrackedBand[];
  selectedDate?: string; // YYYY-MM-DD — optional selected day highlight
}>();

const emit = defineEmits<(e: "select", date: string) => void>();

function onCellClick(date: string): void {
  if (date <= props.today) emit("select", date);
}

function reasonLabel(reason: Reason): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** A single grid cell's render-ready bundle. */
type CellInfo = {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  isInMonth: boolean;
  isToday: boolean;
  chips: PastSession[];
  pills: Array<{ templateName: string; phase: Phase; isProposed: boolean }>;
  offReason: Reason | null;
};

/**
 * The grid always renders exactly 42 cells (6 weeks × 7 cols). The first
 * cell is the Sunday on-or-before the month's first day; the last cell is
 * the Saturday on-or-after the month's last day, padded out to fill 6 rows.
 * Days from the previous/next month render dimmed.
 *
 * Date math runs in UTC noon to avoid DST surprises. We never derive day
 * boundaries from the user's local clock here — the API already bucketed
 * sessions to the user's timezone, so all dates flowing through this
 * component are pre-resolved YYYY-MM-DD strings.
 */
const cells = computed<CellInfo[]>(() => {
  const [yearStr, monthStr] = props.month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  // First day of the requested month, UTC noon.
  const firstOfMonth = new Date(Date.UTC(year, monthNum - 1, 1, 12, 0, 0));
  // Walk back to the Sunday on-or-before. getUTCDay(): 0 = Sunday.
  const firstCell = new Date(firstOfMonth);
  firstCell.setUTCDate(firstCell.getUTCDate() - firstCell.getUTCDay());

  // Pre-index past sessions and pill segments by date for O(1) cell lookup.
  const chipsByDate = new Map<string, PastSession[]>();
  for (const s of props.pastSessions) {
    const arr = chipsByDate.get(s.date) ?? [];
    arr.push(s);
    chipsByDate.set(s.date, arr);
  }

  // For pills, fan out each template's segments to a per-date list. Each
  // entry in the per-date list carries the templateName so PillSegment can
  // resolve its color independently of the parent entry.
  const pillsByDate = new Map<
    string,
    Array<{ templateName: string; phase: Phase; isProposed: boolean }>
  >();
  for (const entry of props.pillSegments) {
    for (const seg of entry.segments) {
      const arr = pillsByDate.get(seg.date) ?? [];
      arr.push({
        templateName: entry.template_name,
        phase: seg.phase as Phase,
        isProposed: seg.is_proposed,
      });
      pillsByDate.set(seg.date, arr);
    }
  }

  // Expand each untracked band inclusively into a date→reason lookup so each
  // cell can resolve its tint in O(1). Same UTC-noon idiom as the cell walk.
  const offByDate = new Map<string, Reason>();
  for (const band of props.untrackedBands) {
    const fy = Number(band.from.slice(0, 4));
    const fm = Number(band.from.slice(5, 7));
    const fd = Number(band.from.slice(8, 10));
    const cursor = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
    while (cursor.toISOString().slice(0, 10) <= band.to) {
      offByDate.set(cursor.toISOString().slice(0, 10), band.reason);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const out: CellInfo[] = [];
  const cursor = new Date(firstCell);
  for (let i = 0; i < 42; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    const inMonth = iso.startsWith(`${props.month}-`);
    out.push({
      date: iso,
      dayNumber: cursor.getUTCDate(),
      isInMonth: inMonth,
      isToday: iso === props.today,
      chips: chipsByDate.get(iso) ?? [],
      pills: pillsByDate.get(iso) ?? [],
      offReason: offByDate.get(iso) ?? null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
});
</script>

<template>
  <div class="cal" data-test="calendar-grid">
    <div v-for="(lbl, i) in DOW_LABELS" :key="`dow-${i}`" class="dow">{{ lbl }}</div>
    <div
      v-for="cell in cells"
      :key="cell.date"
      class="cell"
      :class="{
        dim: !cell.isInMonth,
        today: cell.isToday,
        selected: cell.date === selectedDate,
        clickable: cell.date <= today,
        [`off-${cell.offReason}`]: cell.offReason,
      }"
      :data-date="cell.date"
      :title="cell.offReason ? reasonLabel(cell.offReason) : undefined"
      @click="onCellClick(cell.date)"
    >
      <span class="dnum">{{ cell.dayNumber }}</span>
      <SessionChip
        v-for="chip in cell.chips"
        :key="`${cell.date}-${chip.workout_id}`"
        :template-name="chip.template_name"
      />
      <div v-if="cell.pills.length > 0" class="pill-stack">
        <PillSegment
          v-for="(pill, idx) in cell.pills"
          :key="`${cell.date}-${pill.templateName}-${idx}`"
          :template-name="pill.templateName"
          :phase="pill.phase"
          :is-proposed="pill.isProposed"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: var(--cal-gap, 2px);
  font-variant-numeric: tabular-nums;
}
.cal .dow {
  color: var(--ink-faint, #6b7180);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  text-align: center;
  padding-bottom: 4px;
}
.cal .cell {
  position: relative;
  height: var(--cal-cell-h, 60px);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 5px 0;
  background: rgba(255, 255, 255, 0.015);
  color: var(--ink-dim, #9aa0ad);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cal .cell.dim {
  color: var(--ink-faint, #6b7180);
  background: transparent;
}
.cal .cell.today {
  border-color: var(--accent, #f1c453);
  color: var(--ink, #e6e8ee);
}
.cal .cell.off-vacation { background: rgba(91, 141, 239, 0.16); }
.cal .cell.off-sick { background: rgba(224, 112, 122, 0.16); }
.cal .cell.off-deload { background: rgba(217, 164, 65, 0.16); }
.cal .cell.clickable { cursor: pointer; }
.cal .cell.selected {
  outline: 2px solid var(--accent, #4a7dff);
  outline-offset: -2px;
  border-radius: 4px;
}
.cal .cell .dnum {
  font-size: 11px;
}
.cal .cell .pill-stack {
  display: flex;
  flex-direction: column;
  gap: var(--pill-gap, 2px);
  /* margin-top:auto pushes the stack to the bottom of the cell so day-number
     and chips stay top-anchored regardless of how many pills the cell has. */
  margin-top: auto;
  padding-bottom: 3px;
}
</style>
