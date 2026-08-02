<script setup lang="ts">
defineProps<{ show: boolean }>();
</script>

<template>
  <div v-if="show" data-test="offline-banner" class="offline-banner">
    Couldn't reach API — using cached data.
  </div>
</template>

<style scoped>
.offline-banner {
  background: #3a2a14;
  color: #e6b450;
  padding: 6px 14px;
  font-size: 12px;
  border-bottom: 1px solid #4a3818;
}
</style>
