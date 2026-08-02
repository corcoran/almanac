<script setup lang="ts">
// No props or state needed for this placeholder
</script>

<template>
  <div class="placeholder">
    <div class="placeholder-content">
      <h2>Welcome to Almanac</h2>
      <p>No profile found. Use an AI assistant connected to Almanac (e.g., Claude with the MCP server configured) to get started — the assistant will walk you through setup.</p>
    </div>
  </div>
</template>

<style scoped>
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  padding: 40px 20px;
}

.placeholder-content {
  text-align: center;
  max-width: 500px;
}

.placeholder-content h2 {
  margin: 0 0 16px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--ink, #e6e8ee);
}

.placeholder-content p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink-dim, #9aa0ad);
}

.placeholder-content code {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line, #262a36);
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 0.9em;
  color: var(--m-carb, #f5c25a);
  font-family: monospace;
}
</style>
