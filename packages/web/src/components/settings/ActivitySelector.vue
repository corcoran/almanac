<script setup lang="ts">
import { UserResponseSchema } from "@almanac/core/schemas";
import { onMounted, ref } from "vue";
import type { ApiClient } from "../../api/client.js";

/**
 * The web's first profile control. Reads the current `activity_level` from
 * `GET /v1/users/me` on mount and PATCHes the chosen value back. Activity
 * level only seeds the *initial* maintenance estimate — once enough weigh-ins
 * exist the TDEE basis flips to `measured_intake` and this stops affecting the
 * displayed number, so we surface an honest caption in that case rather than
 * implying the control still moves anything.
 */
const props = defineProps<{
  client: ApiClient;
  tdeeBasis?: "profile_baseline" | "measured_intake" | null;
}>();

const OPTIONS = [
  { value: "sedentary", label: "Sedentary" },
  { value: "light", label: "Light" },
  { value: "moderate", label: "Moderate" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very active" },
] as const;

type Activity = (typeof OPTIONS)[number]["value"];

// `selected` drives the <select>; "" is the not-set sentinel (no activity
// level recorded yet). `saved` is the last value the server confirmed — we
// revert to it if a PATCH fails so the visible control never lies.
const selected = ref<Activity | "">("");
const saved = ref<Activity | "">("");
const pending = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const user = await props.client.get("/v1/users/me", UserResponseSchema);
    const level = user.activity_level ?? "";
    selected.value = level;
    saved.value = level;
  } catch {
    error.value = "Couldn't load your profile.";
  }
});

async function onChange() {
  const chosen = selected.value;
  // The "Not set" option isn't a value we can PATCH, and a no-op re-pick or an
  // in-flight save shouldn't fire a second request.
  if (chosen === "" || chosen === saved.value || pending.value) return;
  pending.value = true;
  error.value = null;
  try {
    await props.client.patch("/v1/users/me", { activity_level: chosen }, UserResponseSchema);
    saved.value = chosen;
  } catch {
    error.value = "Couldn't save. Please try again.";
    selected.value = saved.value;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="activity-selector">
    <label class="lbl" for="activity-select">Activity level</label>
    <select
      id="activity-select"
      v-model="selected"
      class="select"
      data-test="activity-select"
      :disabled="pending"
      @change="onChange"
    >
      <option value="" disabled>Not set</option>
      <option v-for="opt in OPTIONS" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>

    <p
      v-if="tdeeBasis === 'measured_intake'"
      class="caption"
      data-test="activity-measured-caption"
    >
      Used to estimate maintenance before you've logged ~2 weeks. You're past
      that, so it doesn't affect your current TDEE.
    </p>
    <p v-else class="caption" data-test="activity-helper">
      Sets your starting maintenance estimate. We refine it automatically as you
      log.
    </p>

    <p v-if="error !== null" class="error" data-test="activity-error">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.activity-selector {
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
