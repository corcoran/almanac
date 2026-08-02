<script setup lang="ts">
import { computed } from "vue";
import { formatAbsoluteDateTime, formatRelativeDate } from "../../lib/relative-date.js";
import type { UnitSystem } from "../../lib/units.js";
import type { TemplateLastSessionEntry } from "../../stores/template-last-sessions.js";
import LastSessionPanel from "./LastSessionPanel.vue";

type Template = { id: number; name: string };

const props = defineProps<{
  templates: Template[];
  recommendedId: number | null;
  // The template id of the user's most recently completed workout, or null
  // if there is none. Drives the "last session" badge on the matching row.
  // If this id matches recommendedId, the "recommended" badge wins and the
  // "last session" badge is suppressed (no double badge).
  lastSessionTemplateId: number | null;
  // Map of template_id → ISO date string of the most recent completed
  // session, or null when the store has discovered there's no history,
  // or the sentinel "?" when we haven't fetched yet (chevron renders
  // without a date label). Anything other than `null` shows the chevron.
  lastSessionDates: Record<number, string | null>;
  expandedTemplateId: number | null;
  lastSessionEntries: Record<number, TemplateLastSessionEntry>;
  unitSystem: UnitSystem;
}>();

const emit = defineEmits<{
  (event: "select", templateId: number): void;
  (event: "toggleLastSession", templateId: number): void;
  (event: "edit", templateId: number): void;
}>();

// Precomputed visibility/labels so the template stays readable. The "?"
// sentinel means the store hasn't fetched yet — render the chevron without
// a date label or tooltip. Real ISO strings get both: a relative label
// ("2 days ago") and a tooltip with the full date+time.
const rowState = computed(() =>
  props.templates.map((tpl) => {
    const date = props.lastSessionDates[tpl.id];
    const hasHistory = date !== null && date !== undefined;
    const hasRealDate = hasHistory && date !== "?";
    const dateLabel = hasRealDate ? formatRelativeDate(date as string) : "";
    const dateTooltip = hasRealDate ? formatAbsoluteDateTime(date as string) : undefined;
    const isRecommended = props.recommendedId === tpl.id;
    // "Recommended" wins on overlap — if the most-recent template IS the
    // recommended one we only show the recommended badge, never both.
    const isLastSession =
      props.lastSessionTemplateId !== null &&
      tpl.id === props.lastSessionTemplateId &&
      !isRecommended;
    return {
      id: tpl.id,
      name: tpl.name,
      isRecommended,
      isLastSession,
      hasHistory,
      dateLabel,
      dateTooltip,
      isExpanded: props.expandedTemplateId === tpl.id,
    };
  }),
);

function handleRowClick(id: number) {
  emit("select", id);
}

function handleChevronClick(id: number) {
  emit("toggleLastSession", id);
}

function handleEditClick(id: number) {
  emit("edit", id);
}
</script>

<template>
  <div class="template-picker" data-test="template-picker">
    <ul class="rows">
      <li
        v-for="row in rowState"
        :key="row.id"
        :data-test="'template-row'"
        :data-recommended="row.isRecommended ? 'true' : 'false'"
        class="row-wrapper"
      >
        <div
          class="row"
          :class="{ 'row--recommended': row.isRecommended }"
          :title="row.dateTooltip"
          @click="handleRowClick(row.id)"
        >
          <span class="name">{{ row.name }}</span>
          <div class="row-trail">
            <span v-if="row.isRecommended" class="badge">recommended</span>
            <span v-else-if="row.isLastSession" class="badge last-session"
              >last session</span
            >
            <button
              type="button"
              class="edit-template"
              :data-test="`edit-template-${row.id}`"
              :aria-label="`Edit ${row.name}`"
              @click.stop="handleEditClick(row.id)"
            >
              ✎
            </button>
            <button
              v-if="row.hasHistory"
              type="button"
              class="last-session-chevron"
              :class="{ expanded: row.isExpanded }"
              data-test="last-session-chevron"
              :aria-expanded="row.isExpanded"
              :aria-label="
                row.isExpanded ? 'Hide last session' : 'Show last session'
              "
              @click.stop="handleChevronClick(row.id)"
            >
              <span class="chevron-icon" aria-hidden="true">›</span>
              <span v-if="row.dateLabel" class="chevron-date">{{
                row.dateLabel
              }}</span>
            </button>
          </div>
        </div>
        <LastSessionPanel
          v-if="row.isExpanded"
          :entry="lastSessionEntries[row.id] ?? { status: 'idle' }"
          :unit-system="unitSystem"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.template-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rows {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row-wrapper {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #262a36;
  border-radius: 8px;
  background: #161922;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  border-color: #3a4051;
}
.row--recommended {
  border-color: #4a7dff;
}
.name {
  font-weight: 500;
}
.row-trail {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #4a7dff;
}
.badge.last-session {
  /* Muted ink so the bright "recommended" badge still pops harder when
     both are theoretically possible (the overlap rule already prevents
     both rendering on the same row, but rows can sit next to each other). */
  color: #6b7180;
}
.edit-template {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-dim, #9aa0ad);
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
  /* Stop the row's click handler from firing as well — also enforced via
     @click.stop in the template. */
  pointer-events: auto;
}
.edit-template:hover {
  color: var(--ink, #e6e8ee);
}
.last-session-chevron {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #262a36;
  border-radius: 999px;
  background: #12141c;
  color: #9aa0ad;
  font-size: 11px;
  cursor: pointer;
  /* Stop the row's click handler from firing as well — also enforced via
     @click.stop in the template, but defense-in-depth for pointer events. */
  pointer-events: auto;
}
.last-session-chevron:hover {
  border-color: #3a4051;
  color: #c8ccd6;
}
.chevron-icon {
  /* Rotate the same single glyph 90° for the "expanded" state rather than
     swapping characters — keeps the button's width stable as it toggles. */
  display: inline-block;
  transition: transform 120ms ease;
  font-size: 14px;
  line-height: 1;
}
.last-session-chevron.expanded .chevron-icon {
  transform: rotate(90deg);
}
.chevron-date {
  /* Slight muted tint — date is secondary information vs. the chevron. */
  color: #6b7180;
}
.last-session-chevron.expanded .chevron-date {
  color: #c8ccd6;
}
</style>
