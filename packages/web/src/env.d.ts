/// <reference types="vite/client" />

// Commit the bundle was built from, compiled in by Vite's `define` (see
// vite.config.ts). "unknown" for un-stamped local builds.
declare const __COMMIT__: string;

// Release tag the bundle was built from (e.g. "v1.2.3"), compiled in by Vite's
// `define` (see vite.config.ts). "dev" for non-release builds.
declare const __APP_VERSION__: string;

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  // biome-ignore lint/suspicious/noExplicitAny: Vue SFC ambient type per docs
  // biome-ignore lint/complexity/noBannedTypes: Vue SFC ambient type per docs
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
