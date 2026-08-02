<script setup lang="ts">
import { UserResponseSchema } from "@almanac/core/schemas";
import { onMounted, ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import { reloadPage } from "../../lib/reload-page.js";

/**
 * Profile control for the user's preferred unit system (metric/imperial).
 * Mirrors ActivitySelector: load-on-mount from GET /v1/users/me, PATCH the
 * chosen value, optimistic-with-revert on failure. On a confirmed save it
 * reloads the page (via reloadPage) so every unit-derived surface — weights,
 * volumes — re-renders from the server in the new system. The displayed unit
 * is sourced from the today store (App.vue), not the auth store, so a bare
 * PATCH wouldn't visibly update the dashboard; the reload is the simplest
 * bulletproof path.
 */
const props = defineProps<{ client: ApiClient }>();

const OPTIONS = [
  { value: "metric", label: "Metric (kg)" },
  { value: "imperial", label: "Imperial (lb)" },
] as const;

type Unit = (typeof OPTIONS)[number]["value"];

const selected = ref<Unit>("metric");
const saved = ref<Unit>("metric");
const pending = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const user = await props.client.get("/v1/users/me", UserResponseSchema);
    selected.value = user.preferred_unit_system;
    saved.value = user.preferred_unit_system;
  } catch {
    error.value = "Couldn't load your profile.";
  }
});

async function onChange() {
  const chosen = selected.value;
  if (chosen === saved.value || pending.value) return;
  pending.value = true;
  error.value = null;
  try {
    await props.client.patch("/v1/users/me", { preferred_unit_system: chosen }, UserResponseSchema);
    saved.value = chosen;
    reloadPage();
  } catch {
    error.value = "Couldn't save. Please try again.";
    selected.value = saved.value;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="unit-selector">
    <label class="lbl" for="unit-select">Units</label>
    <select
      id="unit-select"
      v-model="selected"
      class="select"
      data-test="unit-select"
      :disabled="pending"
      @change="onChange"
    >
      <option v-for="opt in OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <p class="caption">Weights and volumes display in your chosen units.</p>

    <p v-if="error !== null" class="error" data-test="unit-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.unit-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint, #9aa0ad);
}
.select {
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
}
.select:disabled {
  opacity: 0.6;
}
.caption {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0;
  line-height: 1.5;
}
.error {
  font-size: 12px;
  color: var(--danger, #ff6b6b);
  margin: 0;
}
</style>
