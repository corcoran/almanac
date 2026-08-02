<script setup lang="ts">
defineProps<{ question: string }>();
</script>

<template>
  <div class="question-bubble" data-test="chat-question">
    <span class="q-icon" aria-hidden="true">?</span>
    <p class="q-text">{{ question }}</p>
  </div>
</template>

<style scoped>
.question-bubble {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: var(--panel-2, #1b1f2a);
  border: 1px solid var(--accent-line, #3a4660);
  border-radius: 10px;
  padding: 10px 12px;
  max-width: 85%;
}
.q-icon {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent, #5b7cfa);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.q-text { margin: 0; font-size: 13px; color: var(--ink, #e6e8ee); line-height: 1.4; }
</style>
