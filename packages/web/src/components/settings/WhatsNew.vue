<script setup lang="ts">
import { computed } from "vue";
import { compareVersions } from "../../composables/useLastSeenVersion.js";
import type { ChangelogRelease } from "../../lib/parse-changelog.js";
import { parseInline } from "./inline-md.js";

/**
 * Presentational "What's new" list. Data defaults to the build-time-injected
 * __CHANGELOG__ global; tests inject a `releases` fixture instead. `lastSeen`
 * drives the "new" accent — null (first visit) lights nothing up.
 */
const props = withDefaults(
  defineProps<{ lastSeen: string | null; releases?: ChangelogRelease[] }>(),
  { releases: () => __CHANGELOG__ },
);

// Each release with a resolved isNew flag + per-item inline segments, so the
// template never indexes arrays by unprovable index (vue-tsc noUncheckedIndexedAccess).
const rows = computed(() =>
  props.releases.map((r) => ({
    version: r.version,
    date: r.date,
    isNew: props.lastSeen !== null && compareVersions(r.version, props.lastSeen) > 0,
    items: r.items.map((it) => ({ kind: it.kind, segs: parseInline(it.text) })),
  })),
);
</script>

<template>
  <div class="whats-new" data-test="whats-new">
    <p v-if="rows.length === 0" class="empty">No release notes available.</p>
    <article
      v-for="r in rows"
      :key="r.version"
      class="release"
      :class="{ 'is-new': r.isNew }"
      data-test="whats-new-release"
    >
      <header class="rel-head">
        <span class="ver">{{ r.version }}</span>
        <span v-if="r.date" class="date">{{ r.date }}</span>
        <span v-if="r.isNew" class="new-pill">new</span>
      </header>
      <ul class="items">
        <li v-for="(it, idx) in r.items" :key="idx" class="item">
          <span class="kind" :data-kind="it.kind">{{ it.kind }}</span>
          <span class="text">
            <template v-for="(seg, sidx) in it.segs" :key="sidx"
              ><strong v-if="seg.t === 'strong'">{{ seg.v }}</strong
              ><code v-else-if="seg.t === 'code'">{{ seg.v }}</code
              ><template v-else>{{ seg.v }}</template></template
            >
          </span>
        </li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.whats-new {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 320px;
  overflow-y: auto;
}
.empty {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0;
}
.release {
  padding-left: 10px;
  border-left: 2px solid transparent;
}
.release.is-new {
  border-left-color: var(--accent, #6ea8ff);
}
.rel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ver {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
  font-variant-numeric: tabular-nums;
}
.date {
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
  font-variant-numeric: tabular-nums;
}
.new-pill {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent, #6ea8ff);
  border: 1px solid var(--accent, #6ea8ff);
  border-radius: 999px;
  padding: 0 6px;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink, #e6e8ee);
}
.kind {
  flex-shrink: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-faint, #9aa0ad);
  min-width: 52px;
}
.text code {
  background: var(--panel-2, #11141a);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 11px;
}
</style>
