<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { ApiClient } from "../../api/client.js";
import { useWorkoutStore } from "../../stores/workout.js";
import ActiveView from "./ActiveView.vue";
import IdleView from "./IdleView.vue";

defineProps<{ client: ApiClient }>();

// Toggle on hasActiveSession — hydrate() runs in App.vue at module scope so
// this is correct on first paint (resumed sessions open straight into Active).
const { hasActiveSession } = storeToRefs(useWorkoutStore());
</script>

<template>
  <div class="workout-pane">
    <ActiveView v-if="hasActiveSession" :client="client" />
    <IdleView v-else :client="client" />
  </div>
</template>

<style scoped>
.workout-pane {
  padding: 18px 22px;
}
@media (max-width: 768px) {
  .workout-pane {
    padding: 12px 10px;
  }
}
</style>
