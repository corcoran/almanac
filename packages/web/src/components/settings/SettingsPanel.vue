<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import { isPubliclyReachable, mcpUrlFor } from "../../lib/mcp-url.js";
import { useAuthStore } from "../../stores/auth.js";
import AboutMeField from "./AboutMeField.vue";
import ActivitySelector from "./ActivitySelector.vue";
import CreateTokenForm from "./CreateTokenForm.vue";
import NewTokenReveal from "./NewTokenReveal.vue";
import TimezoneSelector from "./TimezoneSelector.vue";
import TokenList from "./TokenList.vue";
import UnitSelector from "./UnitSelector.vue";
import WhatsNew from "./WhatsNew.vue";

/**
 * Modal container for the Settings panel. Mounts a backdrop+card overlay,
 * fires `auth.loadTokens` on first show, and emits `close` when the user
 * dismisses. The parent (App.vue) owns the visibility ref — this component
 * just emits.
 *
 * There's no router, so navigation to/from "Settings" is purely a v-if
 * toggle in App.vue. That keeps the SPA's two-pane layout intact and
 * avoids dragging in vue-router for a single sub-view.
 */
const props = defineProps<{
  client: ApiClient;
  tdeeBasis?: "profile_baseline" | "measured_intake" | null;
  lastSeen?: string | null;
}>();

const emit = defineEmits<(e: "close") => void>();

const auth = useAuthStore();
const { lastMintedToken } = storeToRefs(auth);

// MCP-connect details, mirrored from the welcome splash so a user who dismissed
// it (or never saw it) can still connect their assistant later.
const mcpUrl = mcpUrlFor(window.location.origin);
// See lib/mcp-url.ts: a localhost/LAN origin is unreachable from Claude's and
// ChatGPT's servers, so the connect instructions change shape.
const mcpReachable = isPubliclyReachable(window.location.origin);
const mcpCopied = ref(false);
function copyMcpUrl() {
  void navigator.clipboard.writeText(mcpUrl);
  mcpCopied.value = true;
  setTimeout(() => {
    mcpCopied.value = false;
  }, 2000);
}

// A11y: auto-focus the modal card on mount so the Escape keydown handler
// is reachable without a prior click on something inside the modal. The
// card holds the focus (tabindex="-1") rather than the backdrop so that
// clicking outside the card to dismiss feels distinct from interacting
// with focusable content inside.
const cardRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  // Token list isn't part of the initial app boot — it's only meaningful
  // when the Settings panel is open. Load on mount; the modal's lifetime
  // matches the user's interest in the data.
  void auth.loadTokens(props.client);
  cardRef.value?.focus();
});

function onBackdropClick(ev: MouseEvent) {
  // Only the backdrop itself dismisses — clicks bubbling up from the card
  // would otherwise close the modal mid-form-fill. The card stops propagation.
  if (ev.target === ev.currentTarget) emit("close");
}

function onClose() {
  emit("close");
}

// Build identity, baked in by Vite (see vite.config.ts). Prefer the release
// tag; fall back to the short commit SHA for non-release ("dev") builds so
// there's always something concrete to report.
const shortSha = __COMMIT__ === "unknown" ? "unknown" : __COMMIT__.slice(0, 7);
const buildVersion = __APP_VERSION__ === "dev" ? shortSha : __APP_VERSION__;
</script>

<template>
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
    data-test="settings-panel"
    @click="onBackdropClick"
  >
    <div
      ref="cardRef"
      class="modal"
      tabindex="-1"
      data-test="settings-card"
      @click.stop
      @keydown.esc="onClose"
    >
      <header class="header">
        <h2 id="settings-title" class="title">
          Settings · Personal Access Tokens
        </h2>
        <button
          type="button"
          class="close"
          aria-label="Close settings"
          data-test="settings-close"
          @click="onClose"
        >
          ×
        </button>
      </header>

      <section class="section">
        <h3 class="subhead">Profile</h3>
        <ActivitySelector :client="client" :tdee-basis="tdeeBasis" />
        <UnitSelector :client="client" />
        <TimezoneSelector :client="client" />
        <AboutMeField :client="client" />
      </section>

      <section class="section">
        <h3 class="subhead">Connect your assistant</h3>
        <p v-if="mcpReachable" class="mcp-lead">
          Add this as a remote MCP server in Claude or ChatGPT to log and review
          your data by chat. You'll sign in with Google when prompted.
        </p>
        <p v-else class="mcp-lead">
          Add this as an MCP server in Claude Code, or any assistant running on
          this machine, using a token from below.
        </p>
        <div class="mcp-url-row">
          <code class="mcp-url" data-test="settings-mcp-url">{{ mcpUrl }}</code>
          <button
            type="button"
            class="mcp-copy"
            :class="{ copied: mcpCopied }"
            data-test="settings-mcp-copy"
            @click="copyMcpUrl"
          >{{ mcpCopied ? "Copied" : "Copy" }}</button>
        </div>
        <p v-if="!mcpReachable" class="mcp-note" data-test="settings-mcp-local-note">
          This is a local address. Claude's and ChatGPT's web and mobile apps
          connect from their own servers and can't reach it — that needs Almanac
          published at a public HTTPS domain.
        </p>
      </section>

      <section class="section">
        <CreateTokenForm :client="client" />
      </section>

      <NewTokenReveal v-if="lastMintedToken !== null" :token="lastMintedToken" />

      <section class="section">
        <h3 class="subhead">Active tokens</h3>
        <TokenList :client="client" />
      </section>

      <p class="hint">
        Tokens authenticate the MCP server against your account. Use one
        per device or integration so you can revoke them independently.
      </p>

      <section class="section">
        <h3 class="subhead">What's new</h3>
        <WhatsNew :last-seen="props.lastSeen ?? null" />
      </section>

      <footer class="version" data-test="settings-version">
        Version {{ buildVersion }}
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 100;
  padding: 60px 16px;
  overflow-y: auto;
}
.modal {
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-1, #262a36);
  border-radius: 10px;
  padding: 18px 20px;
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
/* tabindex="-1" makes the card programmatically focusable so Esc reaches
 * the keydown handler, but we don't want a visible focus ring on the card
 * itself — the focus is structural, not interactive. */
.modal:focus {
  outline: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
}
.close {
  background: transparent;
  border: none;
  color: var(--ink-faint, #9aa0ad);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.close:hover {
  color: var(--ink, #e6e8ee);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subhead {
  margin: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint, #9aa0ad);
}
.hint {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0;
  line-height: 1.5;
}
.version {
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mcp-lead {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0 0 8px;
  line-height: 1.5;
}
.mcp-note {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 14px 0 0;
  line-height: 1.5;
}
.mcp-url-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.mcp-url {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
  background: var(--panel-2, #11141a);
  border: 1px solid var(--border, #2a2f3a);
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 12px;
}
.mcp-copy {
  background: none;
  border: 1px solid var(--border, #2a2f3a);
  color: var(--ink, #e6e8ee);
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
}
.mcp-copy.copied {
  border-color: var(--accent, #6ea8ff);
  color: var(--accent, #6ea8ff);
}

@media (max-width: 768px) {
  .modal-backdrop {
    padding: 0;
  }
  .modal {
    max-width: none;
    border-radius: 0;
    min-height: 100vh;
  }
}
</style>
