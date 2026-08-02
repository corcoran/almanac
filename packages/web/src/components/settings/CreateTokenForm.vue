<script setup lang="ts">
import { ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth.js";

/**
 * Inline form for minting a new personal-access token. On submit we call
 * `auth.createToken`, which stashes the cleartext on `auth.lastMintedToken`
 * — the parent SettingsPanel watches for that and shows the one-time reveal.
 *
 * `pending` guards against double-submits while the POST is in flight; the
 * input is cleared on success (whether or not the network call surfaced an
 * error on the store, since the store sets `error` rather than throwing).
 */
defineProps<{ client: ApiClient }>();

const auth = useAuthStore();
const name = ref("");
const pending = ref(false);

async function onSubmit(client: ApiClient) {
  const trimmed = name.value.trim();
  if (trimmed === "" || pending.value) return;
  pending.value = true;
  try {
    await auth.createToken(client, trimmed);
    // On a successful mint, lastMintedToken is set — the parent surfaces
    // the reveal. Always clear the input regardless of outcome; if the
    // store recorded an error, that's surfaced separately, but the user's
    // input shouldn't sit around as a perceived "still pending".
    name.value = "";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form class="create-token-form" data-test="create-token-form" @submit.prevent="onSubmit(client)">
    <label class="lbl" for="ct-name">New token name</label>
    <div class="row">
      <input
        id="ct-name"
        v-model="name"
        type="text"
        class="input"
        placeholder="e.g. MCP Laptop"
        data-test="create-token-name"
        :disabled="pending"
      />
      <button
        type="submit"
        class="primary"
        data-test="create-token-submit"
        :disabled="pending || name.trim() === ''"
      >
        Create token
      </button>
    </div>
  </form>
</template>

<style scoped>
.create-token-form {
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
.row {
  display: flex;
  gap: 8px;
}
.input {
  flex: 1;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
}
.input:disabled {
  opacity: 0.6;
}
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.primary:disabled {
  background: var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  cursor: not-allowed;
}
</style>
