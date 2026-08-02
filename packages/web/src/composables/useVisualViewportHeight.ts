import { onBeforeUnmount, ref } from "vue";

/**
 * Tracks the VISUAL viewport geometry — the region actually visible to the user,
 * which shrinks and/or shifts when the mobile soft keyboard opens. This is the
 * browser-agnostic answer to "keep a full-screen modal (and its bottom input)
 * above the keyboard".
 *
 * Two problems a `position: fixed; inset: 0` + `100dvh` modal hits on mobile:
 *  1. `100dvh` only shrinks on keyboard open in SOME browsers (Chrome Android,
 *     iOS partially); Firefox Android leaves the layout viewport full-height, so
 *     a `dvh`-sized panel's input bar ends up behind the keyboard.
 *  2. A `fixed; inset: 0` overlay is anchored to the LAYOUT viewport (full
 *     height, unaffected by the keyboard). A panel centered in it floats in the
 *     middle of the full-height overlay → big gaps above/below once the keyboard
 *     is up.
 *
 * Tracking `visualViewport.height` AND `offsetTop` lets the caller pin the
 * overlay exactly over the visible region (top = offsetTop, height = height),
 * fixing both uniformly. `offsetTop` is the visual viewport's top inset within
 * the layout viewport (non-zero when the browser shifts rather than shrinks).
 *
 * `supported` is false on SSR / ancient browsers — the caller then falls back to
 * its CSS `dvh`/`vh` rules. Mirrors the `useIsMobile` listener+cleanup shape.
 */
export function useVisualViewportHeight() {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const supported = vv !== null && vv !== undefined;
  const fallbackHeight = typeof window !== "undefined" ? window.innerHeight : 0;

  const height = ref(supported ? vv.height : fallbackHeight);
  const offsetTop = ref(supported ? vv.offsetTop : 0);

  function onChange(): void {
    if (!vv) return;
    height.value = vv.height;
    offsetTop.value = vv.offsetTop;
  }

  if (vv) {
    // `resize` fires on keyboard open/close + rotation; `scroll` fires when the
    // keyboard shifts the visual viewport offset without a height change.
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    onBeforeUnmount(() => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
    });
  }

  return { height, offsetTop, supported };
}
