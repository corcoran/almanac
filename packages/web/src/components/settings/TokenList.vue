<script setup lang="ts">
import { storeToRefs } from "pinia";
import { ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import { useAuthStore } from "../../stores/auth.js";

/**
 * Read-only list of the user's active personal-access tokens. The store
 * never returns the cleartext for an existing row — only the displayable
 * `prefix` and metadata. Revoke is destructive (re-issuing requires
 * re-minting), so we guard the action with an inline two-step confirm
 * rendered in the row itself.
 */
defineProps<{ client: ApiClient }>();

const auth = useAuthStore();
const { tokens, status } = storeToRefs(auth);

const confirmingId = ref<number | null>(null);

function askRevoke(id: number): void {
  confirmingId.value = id;
}

function cancelRevoke(): void {
  confirmingId.value = null;
}

async function confirmRevoke(client: ApiClient, id: number): Promise<void> {
  try {
    await auth.revokeToken(client, id);
  } finally {
    confirmingId.value = null;
  }
}

function formatDate(iso: string | null): string {
  if (iso === null) return "Never";
  // Use Intl with explicit UTC so jsdom (no system tz) doesn't roll the
  // date backward in tests.
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}
</script>

<template>
  <div class="token-list" data-test="token-list">
    <div
      v-if="status === 'loading' && tokens.length === 0"
      class="empty"
      data-test="token-list-loading"
    >
      Loading tokens…
    </div>
    <div
      v-else-if="tokens.length === 0"
      class="empty"
      data-test="token-list-empty"
    >
      No tokens yet — create one above to use MCP.
    </div>
    <ul v-else class="rows">
      <li
        v-for="t in tokens"
        :key="t.id"
        class="row"
        data-test="token-row"
      >
        <div class="meta">
          <code class="prefix" data-test="token-prefix">{{ t.prefix }}</code>
          <span class="name" data-test="token-name">{{ t.name }}</span>
        </div>
        <div class="dates">
          <span class="created">created {{ formatDate(t.created_at) }}</span>
          <span class="used">last used {{ formatDate(t.last_used_at) }}</span>
        </div>
        <div class="actions">
          <template v-if="confirmingId === t.id">
            <span class="confirm-text">Revoke?</span>
            <button
              type="button"
              class="revoke danger"
              data-test="confirm-revoke"
              @click="confirmRevoke(client, t.id)"
            >Revoke</button>
            <button
              type="button"
              class="revoke"
              data-test="cancel-revoke"
              @click="cancelRevoke"
            >Cancel</button>
          </template>
          <button
            v-else
            type="button"
            class="revoke"
            data-test="revoke-token"
            @click="askRevoke(t.id)"
          >
            Revoke
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.token-list {
  display: flex;
  flex-direction: column;
}
.empty {
  color: var(--ink-faint, #9aa0ad);
  font-size: 13px;
  padding: 16px 12px;
  border: 1px dashed var(--line-2, #353a4a);
  border-radius: 6px;
  text-align: center;
}
.rows {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--line-1, #262a36);
  border-radius: 6px;
  background: var(--surface-2, #1f2330);
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.prefix {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ink, #e6e8ee);
}
.name {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.dates {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.confirm-text {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.revoke {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: var(--warn, #e6b450);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
}
.revoke:hover {
  background: var(--surface-1, #161922);
}
.revoke.danger {
  color: var(--error, #f07178);
  border-color: var(--error, #f07178);
}
</style>
