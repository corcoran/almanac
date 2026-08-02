<script setup lang="ts">
import { computed } from "vue";
import { formatRelativeDate } from "../../lib/relative-date.js";

const props = defineProps<{ selectedDate: string; today: string }>();
defineEmits<{
  (e: "prev"): void;
  (e: "next"): void;
  (e: "go-today"): void;
}>();

const absoluteLabel = computed(() =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${props.selectedDate}T12:00:00Z`)),
);

const relativeLabel = computed(() =>
  formatRelativeDate(`${props.selectedDate}T12:00:00Z`, new Date(`${props.today}T12:00:00Z`)),
);

const nextDisabled = computed(() => props.selectedDate >= props.today);
</script>

<template>
  <div class="past-day-banner" data-test="past-day-banner" role="status">
    <span class="left">
      <span class="ico" aria-hidden="true">🕓</span>
      Viewing <span class="date">{{ absoluteLabel }}</span>
      <span class="rel">· {{ relativeLabel }}</span>
    </span>
    <span class="nav">
      <button
        type="button"
        class="step"
        data-test="past-day-prev"
        aria-label="Previous day"
        @click="$emit('prev')"
      >‹</button>
      <button
        type="button"
        class="step"
        data-test="past-day-next"
        aria-label="Next day"
        :disabled="nextDisabled"
        @click="$emit('next')"
      >›</button>
      <button
        type="button"
        class="today-btn"
        data-test="past-day-today"
        @click="$emit('go-today')"
      >Today</button>
    </span>
  </div>
</template>

<style scoped>
.past-day-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #2e2614;
  border: 1px solid #4a3d18;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--amber, #e6b450);
}
.left { display: flex; align-items: center; gap: 6px; min-width: 0; }
.left .date { font-weight: 600; color: #f0d28a; }
.left .rel { color: var(--amber, #e6b450); }
.nav { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.step {
  background: transparent;
  border: 1px solid #5a4a1e;
  color: var(--amber, #e6b450);
  border-radius: 6px;
  padding: 4px 9px;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.step:disabled { opacity: 0.4; cursor: not-allowed; }
.today-btn {
  background: transparent;
  border: 1px solid var(--amber, #e6b450);
  color: var(--amber, #e6b450);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.today-btn:hover { background: rgba(230, 180, 80, 0.1); }
</style>
