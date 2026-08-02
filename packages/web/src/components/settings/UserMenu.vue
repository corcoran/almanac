<script setup lang="ts">
import type { WhoamiResponseSchema } from "@almanac/core/schemas";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { z } from "zod";

type Whoami = z.infer<typeof WhoamiResponseSchema>;

/**
 * Top-bar user chip. Shows initials in an avatar circle; clicking opens a
 * small dropdown with the user's name+email, a Settings item, and a Logout
 * link. Closes on outside click and on Esc.
 *
 * Logout is a plain `<a>` to oauth2-proxy's signout endpoint (rather than a
 * JS handler) so the browser navigates and the proxy clears its session
 * cookie. No client-side state to tear down.
 */
const props = defineProps<{
  me: Whoami | null;
  hasUnseen?: boolean;
}>();

const emit = defineEmits<(e: "open-settings") => void>();

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);

// Initials: prefer the name (up to two words), fall back to the email's
// first letter, then "?" when we haven't loaded `me` yet. Uppercased for
// readability in the small avatar.
const initials = computed<string>(() => {
  if (!props.me) return "?";
  const name = props.me.name.trim();
  if (name.length > 0) {
    const parts = name.split(/\s+/).filter((p) => p.length > 0);
    const firstWord = parts[0];
    const lastWord = parts[parts.length - 1];
    if (firstWord !== undefined && lastWord !== undefined) {
      if (parts.length === 1) return firstWord.slice(0, 2).toUpperCase();
      return ((firstWord[0] ?? "") + (lastWord[0] ?? "")).toUpperCase();
    }
  }
  const email = props.me.email?.trim() ?? "";
  const emailFirst = email[0];
  if (emailFirst !== undefined) return emailFirst.toUpperCase();
  return "?";
});

const displayName = computed(() => props.me?.name ?? "Loading…");
const displayEmail = computed(() => props.me?.email ?? "");

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function onSettings() {
  close();
  emit("open-settings");
}

function onDocClick(ev: MouseEvent) {
  if (!open.value) return;
  const target = ev.target as Node | null;
  if (rootRef.value && target && !rootRef.value.contains(target)) close();
}

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootRef" class="user-menu" data-test="user-menu">
    <button
      type="button"
      class="avatar"
      data-test="user-menu-button"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="toggle"
    >
      <span class="initials">{{ initials }}</span>
      <span
        v-if="props.hasUnseen"
        class="badge"
        data-test="user-menu-badge"
        aria-label="New release notes available"
      />
    </button>
    <div v-if="open" class="dropdown" role="menu" data-test="user-menu-dropdown">
      <div class="identity">
        <div class="name">{{ displayName }}</div>
        <div v-if="displayEmail" class="email">{{ displayEmail }}</div>
      </div>
      <div class="divider" />
      <button
        type="button"
        class="item"
        role="menuitem"
        data-test="user-menu-settings"
        @click="onSettings"
      >
        Settings
      </button>
      <a
        class="item link"
        role="menuitem"
        href="/oauth2/sign_out?rd=/"
        data-test="user-menu-logout"
      >
        Logout
      </a>
    </div>
  </div>
</template>

<style scoped>
.user-menu {
  position: relative;
  display: inline-block;
}
.avatar {
  position: relative;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent, #4a7dff);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  padding: 0;
}
.avatar:hover {
  filter: brightness(1.1);
}
.initials {
  pointer-events: none;
}
.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent, #4a7dff);
  border: 2px solid var(--bg, #0f1115);
  pointer-events: none;
}
.dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  background: var(--surface-1, #161922);
  border: 1px solid var(--line-1, #262a36);
  border-radius: 8px;
  padding: 6px 0;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 90;
  display: flex;
  flex-direction: column;
}
.identity {
  padding: 8px 12px;
}
.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink, #e6e8ee);
}
.email {
  font-size: 11px;
  color: var(--ink-faint, #9aa0ad);
  margin-top: 2px;
}
.divider {
  height: 1px;
  background: var(--line-1, #262a36);
  margin: 4px 0;
}
.item {
  background: transparent;
  border: none;
  color: var(--ink, #e6e8ee);
  text-align: left;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  display: block;
}
.item:hover {
  background: var(--surface-2, #1f2330);
}
.item.link {
  /* anchors don't inherit cursor, and the default underline reads as a
     link in body copy — strip both so it matches the button row. */
  color: var(--ink, #e6e8ee);
}
</style>
