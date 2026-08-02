<script setup lang="ts">
import { UserResponseSchema } from "@almanac/core/schemas";
import { computed, onMounted, ref } from "vue";
import type { ApiClient } from "../../api/client.js";
import { reloadPage } from "../../lib/reload-page.js";

/**
 * Searchable timezone combobox. The zone list is the browser's own
 * Intl.supportedValuesOf("timeZone"), so only valid IANA zones can be picked
 * (the server's strict validation is a backstop, not a reachable UX path).
 * Mirrors the load/PATCH/revert pattern of ActivitySelector; on a confirmed
 * save it reloads the page so all user-day bucketing re-derives from the new
 * timezone. List is capped to 50 matches to keep the DOM light — the user
 * narrows by typing, so the tail is reachable by refining the query.
 */
const props = defineProps<{ client: ApiClient }>();

// Captured once. `Intl.supportedValuesOf` is ES2023; the repo's TS lib is
// ES2022, so the symbol isn't in the type lib. Access it through a locally
// typed view of Intl rather than a blanket ts-expect-error, and fall back to a
// tiny list if the runtime lacks it so the control still renders. (Chrome/
// Firefox/Safari all ship it; the fallback is belt-and-suspenders for old
// jsdom in tests — modern jsdom/node 20+ provides it.)
const intlWithSupported = Intl as typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};
const zones: readonly string[] =
  typeof intlWithSupported.supportedValuesOf === "function"
    ? intlWithSupported.supportedValuesOf("timeZone")
    : ["UTC", "America/Toronto", "America/New_York", "Europe/London"];

const MAX_OPTIONS = 50;

const query = ref("");
const saved = ref("UTC");
const open = ref(false);
const activeIndex = ref(-1);
const pending = ref(false);
const error = ref<string | null>(null);

const filtered = computed<readonly string[]>(() => {
  const q = query.value.toLowerCase();
  const matches = q === "" ? zones : zones.filter((z) => z.toLowerCase().includes(q));
  return matches.slice(0, MAX_OPTIONS);
});

onMounted(async () => {
  try {
    const user = await props.client.get("/v1/users/me", UserResponseSchema);
    saved.value = user.timezone;
    query.value = user.timezone;
  } catch {
    error.value = "Couldn't load your profile.";
  }
});

function onFocus() {
  open.value = true;
  activeIndex.value = -1;
}

function onInput() {
  open.value = true;
  activeIndex.value = -1;
}

function closeAndRestore() {
  open.value = false;
  query.value = saved.value;
  activeIndex.value = -1;
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    open.value = true;
    const next = activeIndex.value + 1;
    activeIndex.value = next >= filtered.value.length ? filtered.value.length - 1 : next;
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    open.value = true;
    const prev = activeIndex.value - 1;
    activeIndex.value = prev < 0 ? 0 : prev;
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const zone = filtered.value[activeIndex.value];
    if (zone !== undefined) void commit(zone);
  } else if (ev.key === "Escape") {
    closeAndRestore();
  }
}

async function commit(zone: string) {
  if (zone === saved.value || pending.value) {
    open.value = false;
    query.value = saved.value;
    return;
  }
  pending.value = true;
  error.value = null;
  try {
    await props.client.patch("/v1/users/me", { timezone: zone }, UserResponseSchema);
    saved.value = zone;
    query.value = zone;
    open.value = false;
    reloadPage();
  } catch {
    error.value = "Couldn't save. Please try again.";
    query.value = saved.value;
    open.value = false;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="tz-selector">
    <label class="lbl" for="tz-input">Timezone</label>
    <div class="combo">
      <input
        id="tz-input"
        v-model="query"
        class="input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="tz-listbox"
        :aria-expanded="open"
        :aria-activedescendant="activeIndex >= 0 ? `tz-opt-${activeIndex}` : undefined"
        autocomplete="off"
        data-test="tz-input"
        :disabled="pending"
        @focus="onFocus"
        @input="onInput"
        @keydown="onKeydown"
        @blur="closeAndRestore"
      />
      <ul v-if="open && filtered.length > 0" id="tz-listbox" class="listbox" role="listbox">
        <li
          v-for="(zone, i) in filtered"
          :id="`tz-opt-${i}`"
          :key="zone"
          class="option"
          :class="{ active: i === activeIndex }"
          role="option"
          :aria-selected="zone === saved"
          data-test="tz-option"
          @mousedown.prevent="commit(zone)"
        >
          {{ zone }}
        </li>
      </ul>
    </div>

    <p class="caption">Your day boundary and all dates use this timezone.</p>

    <p v-if="error !== null" class="error" data-test="tz-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.tz-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lbl {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-faint, #9aa0ad);
}
.combo {
  position: relative;
}
.input {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-2, #1f2330);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
}
.input:disabled {
  opacity: 0.6;
}
.listbox {
  position: absolute;
  z-index: 10;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 4px;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-2, #353a4a);
  border-radius: 6px;
}
.option {
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--ink, #e6e8ee);
  cursor: pointer;
}
.option.active,
.option:hover {
  background: var(--surface-2, #1f2330);
}
.caption {
  font-size: 12px;
  color: var(--ink-faint, #9aa0ad);
  margin: 0;
  line-height: 1.5;
}
.error {
  font-size: 12px;
  color: var(--danger, #ff6b6b);
  margin: 0;
}
</style>
