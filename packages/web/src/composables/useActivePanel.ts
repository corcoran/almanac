import { onBeforeUnmount, type Ref, ref, watch } from "vue";

export type PanelName = "dashboard" | "workout";

/**
 * Tracks which panel is visible in a scroll-snap container.
 *
 * Uses a scroll event listener on the container — when scrolled past the
 * midpoint, the active panel flips. More reliable than IntersectionObserver
 * for a two-panel scroll-snap layout where the root geometry changes when
 * toggling between grid (desktop) and flex (mobile) modes.
 *
 * On desktop (both panels visible in a grid), `activePanel` defaults to
 * "dashboard" — the scroll listener only fires when there's actual
 * horizontal overflow (mobile mode).
 */
export function useActivePanel(
  containerRef: Ref<HTMLElement | null>,
  panelRefs: { dashboard: Ref<HTMLElement | null>; workout: Ref<HTMLElement | null> },
  isMobile: Ref<boolean>,
) {
  const activePanel = ref<PanelName>("dashboard");

  function onScroll() {
    const container = containerRef.value;
    if (!container) return;
    // Past the midpoint of the scroll range → workout panel is active.
    const scrollMid = container.scrollWidth / 2;
    const viewMid = container.scrollLeft + container.clientWidth / 2;
    activePanel.value = viewMid >= scrollMid ? "workout" : "dashboard";
  }

  function setup() {
    containerRef.value?.addEventListener("scroll", onScroll, { passive: true });
  }

  function teardown() {
    containerRef.value?.removeEventListener("scroll", onScroll);
  }

  // Reset to dashboard when switching to desktop (both panels visible).
  watch(isMobile, (mobile) => {
    if (!mobile) {
      activePanel.value = "dashboard";
    }
  });

  function scrollToPanel(panel: PanelName) {
    const el = panelRefs[panel].value;
    el?.scrollIntoView({ behavior: "smooth", inline: "start" });
  }

  onBeforeUnmount(teardown);

  return { activePanel, setup, scrollToPanel };
}
