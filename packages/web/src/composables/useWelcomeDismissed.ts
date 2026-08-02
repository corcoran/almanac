import { ref } from "vue";

const STORAGE_KEY = "almanac_welcome_dismissed";

/**
 * Tracks whether the user dismissed the full-page "Welcome to Almanac" splash
 * (the MCP-connect first-run guidance). Persisted in localStorage so a returning
 * user who chose the manual route lands on the dashboard instead of the splash.
 *
 * Single-user app, single shared flag — the ref is module-level so every caller
 * (App.vue's layout gate and TodayPane's render gate) sees the same value and
 * dismissing in one place updates both without prop threading.
 */
function readFlag(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // localStorage can throw (private mode, disabled). Treat as not-dismissed.
    return false;
  }
}

const dismissed = ref(readFlag());

export function useWelcomeDismissed() {
  function dismiss(): void {
    dismissed.value = true;
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Best-effort persistence; the in-memory ref still hides the splash for
      // this session even if storage is unavailable.
    }
  }

  return { dismissed, dismiss };
}
