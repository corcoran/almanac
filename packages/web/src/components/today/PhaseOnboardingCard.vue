<script setup lang="ts">
import { computed } from "vue";

// `profileComplete` is the existing gate: false → no weight logged yet (State
// A), true → weight present, between/awaiting phases (State B).
const props = defineProps<{ profileComplete: boolean }>();

const emit = defineEmits<(e: "create") => void>();

const isNewUser = computed(() => !props.profileComplete);
</script>

<template>
  <div class="block onboarding-card" data-test="onboarding-card">
    <span class="pill">{{ isNewUser ? "● Getting started" : "● No active phase" }}</span>
    <div class="title">{{ isNewUser ? "Let's set up your targets" : "Start your next phase" }}</div>
    <p class="lead">
      <template v-if="isNewUser">
        You can log meals and weigh-ins right away — but to get daily calorie &amp;
        macro goals, you'll start a nutrition phase. The form below sets it all up
        in one go.
      </template>
      <template v-else>
        You're still logging — TDEE, net, and your trends keep updating. Start a
        phase whenever you're ready to aim at a target again.
      </template>
    </p>

    <div class="steps">
      <!-- New user: ONE step. The phase form collects the starting weight inline,
           so there's no separate "log a weight first" prerequisite — flagging one
           was what sent users hunting for a weight input that lives in the modal. -->
      <div v-if="isNewUser" class="step">
        <span class="mark now">1</span>
        <span class="body">
          <span class="h">Start a nutrition phase</span>
          <span class="d">
            Pick a cut, bulk, or maintenance and a daily target — the form asks for
            your current weight and suggests macros as you go.
          </span>
        </span>
      </div>
      <template v-else>
        <div class="step done">
          <span class="mark done">✓</span>
          <span class="body">
            <span class="h">Weight logged</span>
            <span class="d">Your TDEE estimate is current and ready to anchor a new phase.</span>
          </span>
        </div>
        <div class="step">
          <span class="mark now">2</span>
          <span class="body">
            <span class="h">Start a nutrition phase</span>
            <span class="d">Pick a cut, bulk, or maintenance with a daily target.</span>
          </span>
        </div>
      </template>
    </div>

    <div class="unlock">
      <div class="cap">{{ isNewUser ? "A phase unlocks" : "Resumes when you start" }}</div>
      <!-- State A educates a first-timer with the full list; State B is a concise
           "here's what comes back" for a returning user (matches the spec). -->
      <div v-if="isNewUser" class="grid">
        <span class="it"><span class="dot" />Daily targets — kcal + P/C/F</span>
        <span class="it"><span class="dot" />Remaining today — what's left</span>
        <span class="it"><span class="dot" />On-track status — under / over</span>
        <span class="it"><span class="dot" />TDEE drift — vs phase start</span>
        <span class="it"><span class="dot" />Phase wins — milestones</span>
        <span class="it"><span class="dot" />Deficit / surplus — your daily gap</span>
      </div>
      <div v-else class="grid">
        <span class="it"><span class="dot" />Daily targets + remaining</span>
        <span class="it"><span class="dot" />On-track status in week grid</span>
        <span class="it"><span class="dot" />TDEE drift vs phase start</span>
        <span class="it"><span class="dot" />Phase wins for the new block</span>
      </div>
    </div>

    <div class="cta">
      <button
        type="button"
        class="primary"
        data-test="onboarding-create-phase"
        @click="emit('create')"
      >
        Start a nutrition phase
      </button>
    </div>
  </div>
</template>

<style scoped>
.block {
  background: var(--panel, #161922);
  border: 1px solid var(--line, #262a36);
  border-radius: 8px;
  padding: 16px 18px;
  margin-bottom: 12px;
}
.pill {
  display: inline-flex; gap: 6px; align-items: center;
  background: rgba(110, 168, 255, 0.12); color: var(--accent, #6ea8ff);
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
  padding: 3px 9px; border-radius: 999px; text-transform: uppercase;
}
.title { font-size: 17px; font-weight: 600; color: var(--ink, #e6e8ee); margin-top: 9px; }
.lead { font-size: 12px; color: var(--ink-dim, #9aa0ad); margin: 4px 0 0; line-height: 1.5; max-width: 54ch; }

.steps { margin-top: 13px; display: flex; flex-direction: column; gap: 9px; }
.step { display: flex; gap: 10px; align-items: flex-start; }
.step .body { display: flex; flex-direction: column; }
.mark {
  flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; margin-top: 1px;
}
.mark.done { background: var(--ok, #6ec27c); color: #0f1115; }
.mark.now { background: var(--accent, #6ea8ff); color: #0f1115; }
.mark.todo { background: #22262f; color: var(--ink-faint, #6b7180); border: 1px solid var(--line, #262a36); }
.step .h { font-size: 13px; font-weight: 600; color: var(--ink, #e6e8ee); }
.step.done .h { color: var(--ink-dim, #9aa0ad); }
.step .d { font-size: 11px; color: var(--ink-faint, #6b7180); margin-top: 1px; line-height: 1.4; }
.step code {
  background: rgba(0, 0, 0, 0.2); border: 1px solid var(--line, #262a36);
  border-radius: 3px; padding: 1px 4px; font-size: 0.9em; color: var(--m-carb, #f5c25a);
}

.unlock { margin-top: 13px; padding-top: 12px; border-top: 1px solid var(--line, #262a36); }
.unlock .cap {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--ink-faint, #6b7180); margin-bottom: 8px;
}
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 16px; }
.it { display: flex; gap: 7px; align-items: baseline; font-size: 11.5px; color: var(--ink-dim, #9aa0ad); }
.dot { flex: 0 0 auto; width: 5px; height: 5px; border-radius: 50%; background: var(--m-kcal, #d8b4fe); margin-top: 5px; }

.cta { margin-top: 14px; }
.primary {
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary:hover { filter: brightness(1.1); }

@media (max-width: 768px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
