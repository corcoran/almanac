<script setup lang="ts">
withDefaults(defineProps<{ label?: string }>(), { label: "Edit" });
defineEmits<(e: "click") => void>();
</script>

<template>
  <button
    type="button"
    class="block-edit"
    data-test="block-edit"
    :aria-label="label"
    @click="$emit('click')"
  >
    ✎
  </button>
</template>

<style scoped>
.block-edit {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--line-2, #353a4a);
  background: var(--surface-2, #1f2330);
  color: var(--ink-dim, #9aa0ad);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.block-edit:hover {
  color: var(--ink, #e6e8ee);
}
</style>
