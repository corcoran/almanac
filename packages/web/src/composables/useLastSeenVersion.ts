import { type ComputedRef, computed, type Ref, ref } from "vue";
import type { ChangelogRelease } from "../lib/parse-changelog.js";

const STORAGE_KEY = "almanac.lastSeenVersion";

// Parse "x.y.z" into a numeric tuple; non-numeric parts become 0 so malformed
// input sorts as 0.0.0 rather than NaN-poisoning the comparison.
function toTuple(v: string): [number, number, number] {
  const parts = v.split(".");
  const n = (s: string | undefined) => {
    const x = Number(s);
    return Number.isFinite(x) ? x : 0;
  };
  return [n(parts[0]), n(parts[1]), n(parts[2])];
}

export function compareVersions(a: string, b: string): number {
  const ta = toTuple(a);
  const tb = toTuple(b);
  for (let i = 0; i < 3; i += 1) {
    const ai = ta[i] ?? 0;
    const bi = tb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

export function useLastSeenVersion(releases: ChangelogRelease[] = __CHANGELOG__): {
  lastSeen: Ref<string | null>;
  unseenCount: ComputedRef<number>;
  markAllSeen: () => void;
} {
  const lastSeen = ref<string | null>(localStorage.getItem(STORAGE_KEY));

  const latest = computed<string | null>(() => {
    if (releases.length === 0) return null;
    // releases are newest-first by construction, but don't rely on it — pick max.
    return releases.reduce(
      (best, r) => (best === null || compareVersions(r.version, best) > 0 ? r.version : best),
      null as string | null,
    );
  });

  const unseenCount = computed<number>(() => {
    const seen = lastSeen.value;
    if (seen === null) return 0; // first visit never badges
    return releases.filter((r) => compareVersions(r.version, seen) > 0).length;
  });

  function markAllSeen(): void {
    const v = latest.value;
    if (v === null) return;
    localStorage.setItem(STORAGE_KEY, v);
    lastSeen.value = v;
  }

  return { lastSeen, unseenCount, markAllSeen };
}
