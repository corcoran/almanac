<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  templateName: string;
  /** ISO datetime string from active.started_at. */
  startedAt: string;
  /** Exercises with at least one done set. */
  completedCount: number;
  totalCount: number;
}>();

const emit = defineEmits<(e: "cancel") => void>();

const startedAtLabel = computed(() => {
  const d = new Date(props.startedAt);
  if (Number.isNaN(d.getTime())) return props.startedAt;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
});

// Inline confirm state — clicking "Cancel session" swaps the button out for
// a Discard / Keep going prompt so an accidental click doesn't lose work.
// Matches the inline-confirm pattern used elsewhere (e.g. EndSessionDialog).
const confirming = ref(false);

function onDiscard() {
  emit("cancel");
  confirming.value = false;
}
</script>

<template>
  <header class="session-header">
    <div class="title-block">
      <h2 class="name">{{ templateName }}</h2>
      <p class="meta">
        started {{ startedAtLabel }} ·
        {{ completedCount }} of {{ totalCount }} exercises done
      </p>
    </div>
    <div class="header-actions">
      <template v-if="!confirming">
        <button
          type="button"
          data-test="cancel-session"
          class="cancel-btn"
          @click="confirming = true"
        >
          Cancel session
        </button>
      </template>
      <template v-else>
        <span class="cancel-prompt">Discard this session?</span>
        <button
          type="button"
          data-test="cancel-discard"
          class="discard-btn"
          @click="onDiscard"
        >
          Discard
        </button>
        <button
          type="button"
          data-test="cancel-keep"
          class="keep-btn"
          @click="confirming = false"
        >
          Keep going
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.session-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 4px;
}
.title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.meta {
  margin: 0;
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
}
.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.cancel-btn {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: var(--ink-faint, #9aa0ad);
  padding: 6px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cancel-btn:hover {
  color: var(--bad, #e26b6b);
  border-color: var(--bad, #e26b6b);
}
.cancel-prompt {
  color: var(--ink-faint, #9aa0ad);
  font-size: 12px;
}
.discard-btn {
  background: var(--bad, #e26b6b);
  color: #0c1018;
  border: 0;
  padding: 6px 12px;
  border-radius: 6px;
  font: inherit;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.keep-btn {
  background: transparent;
  border: 1px solid var(--line-2, #353a4a);
  color: inherit;
  padding: 6px 12px;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
</style>
