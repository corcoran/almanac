<script setup lang="ts">
import type { WebSource } from "@almanac/core/schemas";
import { ref } from "vue";

const props = defineProps<{ sources: WebSource[] }>();
const expanded = ref(false);

// Track which favicons failed to load so we can swap in a monogram. Keyed by
// source url (stable + unique within a turn).
const failed = ref<Set<string>>(new Set());
function onFaviconError(url: string) {
  failed.value = new Set(failed.value).add(url);
}

function faviconSrc(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

// Deterministic monogram color from the domain (stable across renders, no RNG).
function monogramColor(domain: string): string {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) % 360;
  return `hsl(${h} 45% 45%)`;
}
function monogramLetter(domain: string): string {
  return (domain[0] ?? "?").toUpperCase();
}
</script>

<template>
  <div v-if="props.sources.length > 0" class="web-sources" data-test="web-sources">
    <button
      type="button"
      class="ws-toggle"
      data-test="web-sources-toggle"
      @click="expanded = !expanded"
    >
      <span class="ws-stack">
        <template v-for="s in props.sources.slice(0, 4)" :key="s.url">
          <span
            v-if="failed.has(s.url)"
            class="ws-fav ws-mono"
            data-test="web-source-monogram"
            :style="{ background: monogramColor(s.domain) }"
          >{{ monogramLetter(s.domain) }}</span>
          <img
            v-else
            class="ws-fav"
            data-test="web-source-favicon"
            :src="faviconSrc(s.domain)"
            :alt="s.domain"
            @error="onFaviconError(s.url)"
          />
        </template>
      </span>
      <span class="ws-label">
        Searched {{ props.sources.length }}
        {{ props.sources.length === 1 ? "source" : "sources" }}
        <span class="ws-caret">{{ expanded ? "▾" : "▸" }}</span>
      </span>
    </button>

    <ul v-if="expanded" class="ws-list" data-test="web-sources-list">
      <li v-for="s in props.sources" :key="s.url" class="ws-row">
        <span
          v-if="failed.has(s.url)"
          class="ws-fav ws-mono"
          :style="{ background: monogramColor(s.domain) }"
        >{{ monogramLetter(s.domain) }}</span>
        <img
          v-else
          class="ws-fav"
          :src="faviconSrc(s.domain)"
          :alt="s.domain"
          @error="onFaviconError(s.url)"
        />
        <a
          :href="s.url"
          target="_blank"
          rel="noopener noreferrer"
          class="ws-link"
          data-test="web-source-link"
        >
          <span class="ws-title">{{ s.title }}</span>
          <span class="ws-domain">{{ s.domain }}</span>
        </a>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.web-sources { margin-top: 8px; }
.ws-toggle {
  display: inline-flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 0; cursor: pointer;
  font-size: 12px; color: var(--ink-dim, #9aa0ad);
}
.ws-stack { display: inline-flex; align-items: center; }
.ws-fav {
  width: 18px; height: 18px; border-radius: 4px; flex: 0 0 auto;
  object-fit: cover; background: var(--surface-2, #1f2330);
}
.ws-stack .ws-fav { margin-left: -5px; border: 2px solid var(--panel, #161922); }
.ws-stack .ws-fav:first-child { margin-left: 0; }
.ws-mono {
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 10px; font-weight: 700;
}
.ws-caret { margin-left: 2px; }
.ws-list { list-style: none; margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line, #262a36); }
.ws-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.ws-link { display: flex; align-items: baseline; gap: 8px; text-decoration: none; min-width: 0; }
.ws-title { font-size: 12px; color: var(--ink, #c2cad6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-domain { color: var(--ink-faint, #6b7180); font-size: 11px; flex: 0 0 auto; }
</style>
