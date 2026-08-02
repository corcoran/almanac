<script setup lang="ts">
import { computed, ref } from "vue";

defineEmits<{
  (e: "open-settings"): void;
  (e: "dismiss"): void;
}>();

const mcpUrl = computed(() => {
  const origin = window.location.origin;
  return `${origin}/mcp`;
});

const copied = ref(false);
function copyUrl() {
  navigator.clipboard.writeText(mcpUrl.value);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}
</script>

<template>
  <div class="onboarding" data-test="onboarding-card">
    <h2 class="heading">Welcome to Almanac</h2>
    <p class="lead">
      Almanac is driven by your AI assistant. Connect it to start
      tracking nutrition, workouts, and body composition.
    </p>

    <div class="steps">
      <div class="step">
        <span class="num">1</span>
        <div>
          <strong>Add the MCP server</strong>
          <p>
            In Claude or ChatGPT, add this as a remote MCP server.
            You'll sign in with Google when prompted.
          </p>
          <div class="url-row">
            <code class="url">{{ mcpUrl }}</code>
            <button
              type="button"
              class="copy-btn"
              :class="{ copied }"
              @click="copyUrl"
            >{{ copied ? "Copied" : "Copy" }}</button>
          </div>
        </div>
      </div>
      <div class="step">
        <span class="num">2</span>
        <div>
          <strong>Start tracking</strong>
          <p>
            Ask your assistant to set up your profile. It will walk
            you through logging your weight, setting macro targets,
            and starting a nutrition phase.
          </p>
        </div>
      </div>
    </div>

    <div class="alt">
      <p>
        Using Claude Code or need a manual token?
        <button
          type="button"
          class="link-btn"
          @click="$emit('open-settings')"
        >Create a personal access token</button>
      </p>
    </div>

    <div class="skip">
      <button
        type="button"
        class="skip-btn"
        data-test="onboarding-dismiss"
        @click="$emit('dismiss')"
      >Skip the AI assistant for now</button>
      <p class="skip-note">You can connect your assistant anytime from Settings.</p>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.heading {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
  color: var(--ink, #e6e8ee);
}
.lead {
  margin: 0 0 32px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-dim, #9aa0ad);
  max-width: 440px;
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: left;
  width: 100%;
  max-width: 420px;
  margin-bottom: 32px;
}
.step {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.step strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
  margin-bottom: 4px;
}
.step p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-dim, #9aa0ad);
}
.num {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent, #4a7dff);
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}
.url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.url {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--line, #262a36);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--accent, #6ea8ff);
  font-family: monospace;
  flex: 1;
  user-select: all;
}
.copy-btn {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.copy-btn:hover {
  filter: brightness(1.1);
}
.copy-btn.copied {
  background: var(--ok, #6ec27c);
}
.alt {
  border-top: 1px solid var(--line, #262a36);
  padding-top: 16px;
  width: 100%;
  max-width: 420px;
}
.alt p {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint, #6b7180);
}
.link-btn {
  background: none;
  border: none;
  color: var(--accent, #6ea8ff);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.link-btn:hover {
  color: var(--ink, #e6e8ee);
}
.skip {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.skip-btn {
  background: none;
  border: 1px solid var(--border, #2a2f3a);
  color: var(--ink, #e6e8ee);
  font-size: 13px;
  cursor: pointer;
  border-radius: 8px;
  padding: 9px 16px;
}
.skip-btn:hover {
  border-color: var(--accent, #6ea8ff);
}
.skip-note {
  font-size: 11px;
  color: var(--muted, #8a93a6);
  margin: 0;
}
</style>
