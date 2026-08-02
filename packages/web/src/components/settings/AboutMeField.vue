<script setup lang="ts">
import { UserResponseSchema } from "@almanac/core/schemas";
import { computed, onMounted, ref } from "vue";
import type { ApiClient } from "../../api/client.js";

/**
 * Settings control for the user's free-text "About Me" note. Loads on mount from
 * GET /v1/users/me, saves via PATCH /v1/users/me. The text is injected as ADVISORY
 * background context into the AI chats + MCP (server-side fencing treats it as
 * data, never instructions). No page reload on save — nothing unit/locale-derived
 * depends on it; the next chat turn reads the new value.
 */
const props = defineProps<{ client: ApiClient }>();

const MAX = 600;
const text = ref("");
const saved = ref("");
const pending = ref(false);
const error = ref<string | null>(null);
const loaded = ref(false);

const count = computed(() => text.value.length);
const over = computed(() => count.value > MAX);
const dirty = computed(() => text.value.trim() !== saved.value.trim());
const canSave = computed(() => loaded.value && !pending.value && !over.value && dirty.value);

onMounted(async () => {
  try {
    const user = await props.client.get("/v1/users/me", UserResponseSchema);
    text.value = user.about_me ?? "";
    saved.value = user.about_me ?? "";
  } catch {
    error.value = "Couldn't load your profile.";
  } finally {
    loaded.value = true;
  }
});

async function onSave() {
  if (!canSave.value) return;
  pending.value = true;
  error.value = null;
  const value = text.value.trim().length === 0 ? null : text.value.trim();
  try {
    const updated = await props.client.patch(
      "/v1/users/me",
      { about_me: value },
      UserResponseSchema,
    );
    saved.value = updated.about_me ?? "";
    text.value = updated.about_me ?? "";
  } catch {
    error.value = "Couldn't save. Please try again.";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="about-me">
    <div class="row">
      <label class="lbl" for="about-me-input">About me</label>
      <span class="counter" :class="{ over }" data-test="about-me-count">{{ count }} / {{ MAX }}</span>
    </div>
    <textarea
      id="about-me-input"
      v-model="text"
      class="input"
      rows="4"
      data-test="about-me-input"
      placeholder="Tell the coach about your body type, goals, and preferences — e.g. 'training for a fall century ride', 'trying to cut back on drinks', 'vegetarian'."
      :disabled="pending || !loaded"
    />
    <p class="caption">
      Personalizes the meal coach, insights coach, and connected assistants. Used as
      background context only — it never overrides your data or the app's rules.
    </p>
    <div class="actions">
      <button
        type="button"
        class="save"
        data-test="about-me-save"
        :disabled="!canSave"
        @click="onSave"
      >{{ pending ? "Saving…" : "Save" }}</button>
    </div>
    <p v-if="error !== null" class="error" data-test="about-me-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.about-me { display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; justify-content: space-between; }
.lbl {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--ink-faint, #9aa0ad);
}
.counter { font-size: 11px; color: var(--ink-faint, #9aa0ad); font-variant-numeric: tabular-nums; }
.counter.over { color: var(--danger, #ff6b6b); }
.input {
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px; padding: 8px 10px; font: inherit; font-size: 13px;
  color: var(--ink, #e6e8ee); resize: vertical; line-height: 1.5;
}
.input:disabled { opacity: 0.6; }
.caption { font-size: 12px; color: var(--ink-faint, #9aa0ad); margin: 0; line-height: 1.5; }
.actions { display: flex; justify-content: flex-end; }
.save {
  background: none; border: 1px solid var(--line-2, #353a4a);
  color: var(--ink, #e6e8ee); border-radius: 6px; padding: 6px 14px;
  font-size: 13px; cursor: pointer;
}
.save:disabled { opacity: 0.5; cursor: default; }
.error { font-size: 12px; color: var(--danger, #ff6b6b); margin: 0; }
</style>
