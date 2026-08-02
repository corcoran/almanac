import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { type ChangelogRelease, parseChangelog } from "./src/lib/parse-changelog.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// Read + parse CHANGELOG.md (repo root) at config time. In Docker the web build
// runs from /repo and the Dockerfile COPYs CHANGELOG.md there; locally moduleDir
// is packages/web so ../../ is the repo root. Returns [] (and warns) if
// unreadable; a release build asserts non-empty below so a missing COPY is
// caught in CI, not production.
function loadChangelog(): ChangelogRelease[] {
  try {
    const raw = readFileSync(resolve(moduleDir, "../../CHANGELOG.md"), "utf8");
    return parseChangelog(raw);
  } catch (err) {
    console.warn(`[vite] could not read CHANGELOG.md: ${String(err)}`);
    return [];
  }
}

// Resolve the current commit from git for local builds where GIT_SHA isn't
// passed in. Returns "unknown" if git isn't available or this isn't a repo
// (e.g. a Docker build context without .git — there GIT_SHA is set explicitly).
function gitShaFromRepo(): string {
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// In production this job is done by oauth2-proxy — it validates the Google
// session cookie and injects X-Forwarded-Email before forwarding to almanac-api.
// In dev there is no oauth2-proxy in the loop, so the Vite proxy injects the
// header itself using ALMANAC_DEV_EMAIL from the shell environment. The API
// runs with ALMANAC_TRUST_PROXY_HEADERS=true and auto-provisions a user row
// for that email on first request.
export default defineConfig(({ command }) => {
  let devEmail: string | undefined;
  let apiTarget = "http://127.0.0.1:3001";
  let devPort = 5173;
  if (command === "serve") {
    devEmail = process.env.ALMANAC_DEV_EMAIL;
    if (!devEmail) {
      throw new Error(
        "ALMANAC_DEV_EMAIL must be set in the shell when starting `pnpm dev:web`. " +
          "Mirrors what oauth2-proxy emits in prod. Source your .env or export directly.",
      );
    }
    // ALMANAC_API_URL lets you run side-by-side with another dev API
    // (e.g. prod on :3001 and this worktree on :3002). When set, the dev
    // proxy forwards /api/* to this target instead of the default.
    if (process.env.ALMANAC_API_URL) {
      apiTarget = process.env.ALMANAC_API_URL;
    }
    // ALMANAC_WEB_PORT lets you run side-by-side with another dev web
    // (e.g. prod on :5173 and this worktree on :5174). Falls back to 5173.
    if (process.env.ALMANAC_WEB_PORT) {
      devPort = Number.parseInt(process.env.ALMANAC_WEB_PORT, 10);
    }
  }

  // Commit the bundle was built from, surfaced so you can confirm exactly
  // which web build is being served. Passed as GIT_SHA (build arg →
  // Dockerfile env → here) in Docker; for local builds it falls back to the
  // working-tree HEAD via git. Compiled in via `define` as the global
  // __COMMIT__, then logged on boot + written to a <meta name="commit"> tag
  // (see main.ts).
  const gitSha = process.env.GIT_SHA ?? gitShaFromRepo();

  // Release tag (e.g. "v1.2.3") for the bundle. Passed as GIT_TAG (build arg →
  // Dockerfile env → here) only by the release workflow, which builds on a
  // v* tag; "dev" for every non-release build (local, CI, branch images).
  // Compiled in via `define` as the global __APP_VERSION__.
  const gitTag = process.env.GIT_TAG ?? "dev";

  const changelog = loadChangelog();
  // gitTag is "dev" for non-release builds. A real release (v*) must ship a
  // populated changelog — otherwise the Dockerfile COPY regressed. Fail loud.
  if (gitTag !== "dev" && changelog.length === 0) {
    throw new Error(
      "[vite] release build but parsed CHANGELOG is empty — is CHANGELOG.md " +
        "copied into the web build context? (packages/web/Dockerfile)",
    );
  }

  return {
    plugins: [vue()],
    define: {
      __COMMIT__: JSON.stringify(gitSha),
      __APP_VERSION__: JSON.stringify(gitTag),
      __CHANGELOG__: JSON.stringify(changelog),
    },
    server: {
      host: "0.0.0.0",
      port: devPort,
      proxy: {
        // No rewrite: the API now serves under /api/* server-side (Fastify
        // registers all routes inside an /api prefix scope) so that
        // oauth2-proxy's --upstream=...:3001/api/ — which does NOT strip
        // its own prefix — round-trips paths verbatim in production. The
        // dev proxy mirrors that behavior: forward /api/v1/foo as-is.
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (devEmail) {
                proxyReq.setHeader("x-forwarded-email", devEmail);
              }
            });
          },
        },
      },
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
  };
});
