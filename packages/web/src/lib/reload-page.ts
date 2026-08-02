/**
 * The single page-reload side-effect, isolated in its own module so component
 * tests can `vi.mock` it and assert it was called without touching jsdom's
 * unspyable `window.location`. Used by the Settings unit/timezone controls,
 * which reload the app on save so every unit- and timezone-derived surface
 * (weights, day bucketing) re-reads from the server.
 */
export function reloadPage(): void {
  window.location.reload();
}
