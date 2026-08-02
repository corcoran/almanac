<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../../stores/auth.js";

/**
 * One-time reveal of a freshly-minted cleartext token. The cleartext is held
 * only in the auth store's `lastMintedToken` and disappears after dismiss —
 * the server stores only the hash, so there's no recovering it later.
 *
 * Rendered inline as a callout, not a separate modal layer, because it sits
 * inside the already-modal SettingsPanel. Stacking two modals just to ferry
 * a single string is more chrome than the value warrants.
 */
const props = defineProps<{ token: string }>();
const auth = useAuthStore();
const copied = ref(false);

async function onCopy() {
  // navigator.clipboard isn't available in jsdom by default. Tests stub it
  // on `navigator`; on a real browser it's a Promise-returning API and we
  // surface a one-shot "Copied" affordance so the user gets feedback.
  try {
    await navigator.clipboard.writeText(props.token);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // Silently no-op if the API is unavailable — the user can still
    // long-press / select the displayed token to copy manually.
  }
}

function onDismiss() {
  auth.dismissMintedToken();
}
</script>

<template>
  <div class="reveal" data-test="new-token-reveal">
    <div class="header">
      <strong>New token created</strong>
    </div>
    <p class="warning" data-test="new-token-warning">
      This is the only time you'll see this token. Copy it now — you won't
      be able to retrieve it again.
    </p>
    <code class="token" data-test="new-token-cleartext">{{ token }}</code>
    <div class="actions">
      <button
        type="button"
        class="ghost"
        data-test="new-token-copy"
        @click="onCopy"
      >
        {{ copied ? "Copied" : "Copy" }}
      </button>
      <button
        type="button"
        class="primary"
        data-test="new-token-dismiss"
        @click="onDismiss"
      >
        I've saved it
      </button>
    </div>
  </div>
</template>

<style scoped>
.reveal {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--warn, #e6b450);
  background: #2a2114;
  border-radius: 8px;
  margin: 8px 0 16px;
}
.header {
  font-size: 13px;
  color: var(--warn, #e6b450);
}
.warning {
  font-size: 12px;
  color: var(--ink, #e6e8ee);
  margin: 0;
  line-height: 1.4;
}
.token {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-1, #262a36);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--ink, #e6e8ee);
  word-break: break-all;
  user-select: all;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
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
.ghost {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  cursor: pointer;
}
</style>
