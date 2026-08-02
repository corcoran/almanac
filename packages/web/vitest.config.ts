import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  // vite.config.ts injects these compile-time globals for dev/build, but
  // vitest doesn't load that config, so components referencing them crash
  // at setup. Supply stand-in values for the test environment.
  define: {
    __COMMIT__: JSON.stringify("test"),
    __APP_VERSION__: JSON.stringify("test"),
    __CHANGELOG__: JSON.stringify([]),
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
