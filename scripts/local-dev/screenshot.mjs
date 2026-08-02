#!/usr/bin/env node
/**
 * screenshot.mjs — capture full-page screenshots of the running web UI.
 *
 * Solves the "my laptop screen isn't tall enough" problem: the page is rendered
 * in a headless browser at an arbitrary viewport, so the capture height is
 * independent of your physical display. A 4000px-tall dashboard shot works fine
 * on a 900px laptop.
 *
 * Uses playwright-core driving your SYSTEM Chrome (channel: "chrome") — no
 * ~150MB browser download. Requires google-chrome / chromium on PATH.
 *
 * Desktop captures default to 984px wide at 1x, so the PNG is literally 984px
 * across — matching screenshots/web.png and the width= the README embeds them
 * at. Use --scale 2 for a retina-density file (2x the pixels in each axis).
 *
 * Usage:
 *   node scripts/local-dev/screenshot.mjs                       # full page, desktop
 *   node scripts/local-dev/screenshot.mjs --url http://localhost:5199
 *   node scripts/local-dev/screenshot.mjs --preset mobile       # phone viewport
 *   node scripts/local-dev/screenshot.mjs --preset both         # desktop + mobile
 *   node scripts/local-dev/screenshot.mjs --out shots/dash.png
 *   node scripts/local-dev/screenshot.mjs --viewport 1440x900 --no-full-page
 *   node scripts/local-dev/screenshot.mjs --selector ".panel-dashboard"
 *   node scripts/local-dev/screenshot.mjs --dark                # force dark scheme
 *
 * Modal states (--scene) click the UI open before capturing:
 *   node scripts/local-dev/screenshot.mjs --scene meal-chat      # empty prompt
 *   node scripts/local-dev/screenshot.mjs --scene meal-lookup    # parsed proposal
 *   node scripts/local-dev/screenshot.mjs --scene insights-chat  # coach read
 *
 * NOTE: meal-lookup and insights-chat make REAL LLM requests (the former sends
 * a meal description and answers the follow-up; the latter auto-fires the
 * coach's "quick read" opener), so they cost tokens. All scenes need the API
 * running with an ANTHROPIC_API_KEY or the AI buttons won't render at all.
 *
 * Modal scenes default to a viewport-sized capture, since a full-page shot
 * renders the modal as a small overlay on a very tall page. Give them a taller
 * --viewport (e.g. 984x1200) if the modal content is being clipped.
 *
 * Exit codes: 0 ok, 1 capture/launch error, 2 bad usage.
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const PRESETS = {
  // 984px matches the existing screenshots/web.png width — keep it stable so
  // new captures diff cleanly against the committed reference shot.
  //
  // deviceScaleFactor 1 means the PNG is LITERALLY this many pixels wide. These
  // are embedded in README.md at width="984", so a 2x file would be downscaled
  // by the browser and waste ~4x the bytes in the repo. Pass --scale 2 for a
  // retina capture when you actually want one.
  desktop: { width: 984, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
};

/**
 * Named UI states reachable only by interaction. Each opens a modal that is
 * `v-if`-mounted, so the capture has to click and wait for it rather than just
 * loading a URL.
 *
 * `settleMs` is per-scene: the insights coach auto-fires a real LLM request on
 * open ("Give me a quick read on how I'm doing"), so it needs far longer to
 * paint a populated transcript than the meal chat's static empty prompt.
 */
const SCENES = {
  "meal-chat": {
    description: "Meal logging AI chat (empty prompt)",
    open: '[data-test="meals-log-with-ai"]',
    waitFor: '[data-test="meal-chat-panel"]',
    settleMs: 1500,
  },
  "meal-lookup": {
    description: "Meal AI mid-lookup, showing a parsed meal proposal (live LLM call)",
    open: '[data-test="meals-log-with-ai"]',
    waitFor: '[data-test="meal-chat-panel"]',
    // Send real messages so the panel shows a parsed proposal card rather than
    // the empty "tell me what you ate" prompt. The agent usually asks a sizing
    // clarification first (its `ask_clarification` tool), so answer it — that
    // second turn is what produces the actual macro proposal.
    type: {
      into: '[data-test="chat-input"]',
      submit: '[data-test="chat-send"]',
      // The reply is done when the pending indicator clears.
      until: '[data-test="chat-pending"]',
      texts: ["I had a chicken shawarma from liberty shawarma", "A standard wrap, in a pita."],
    },
    settleMs: 2500,
  },
  "insights-chat": {
    description: "AI insights coach (fires a live LLM call)",
    open: '[aria-label="AI insights"]',
    waitFor: ".insights-panel, [class*='insights']",
    settleMs: 12_000,
  },
};

function parseArgs(argv) {
  const opts = {
    url: "http://localhost:5199",
    out: null,
    preset: "desktop",
    scene: null,
    help: false,
    viewport: null,
    scale: null,
    fullPage: true,
    fullPageExplicit: false,
    selector: null,
    colorScheme: null,
    waitMs: 1200,
    timeoutMs: 45_000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] === "-h" ? "--help" : argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`error: ${a} requires a value`);
        process.exit(2);
      }
      return v;
    };
    switch (a) {
      case "--url":
        opts.url = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--preset":
        opts.preset = next();
        break;
      case "--scene":
        opts.scene = next();
        break;
      case "--viewport":
        opts.viewport = next();
        break;
      case "--scale":
        opts.scale = Number(next());
        break;
      case "--selector":
        opts.selector = next();
        break;
      case "--wait":
        opts.waitMs = Number(next());
        break;
      case "--timeout":
        opts.timeoutMs = Number(next());
        break;
      case "--full-page":
        opts.fullPage = true;
        opts.fullPageExplicit = true;
        break;
      case "--no-full-page":
        opts.fullPage = false;
        opts.fullPageExplicit = true;
        break;
      case "--dark":
        opts.colorScheme = "dark";
        break;
      case "--light":
        opts.colorScheme = "light";
        break;
      // `-h` is normalized to `--help` before the switch, so both spellings work.
      case "--help":
        opts.help = true;
        break;
      default:
        console.error(`error: unknown flag ${a}`);
        process.exit(2);
    }
  }
  if (opts.help) {
    console.log(
      "usage: node scripts/local-dev/screenshot.mjs [--url U] [--out P]\n" +
        "       [--preset desktop|mobile|both] [--viewport WxH] [--scale N]\n" +
        "       [--selector CSS] [--scene NAME] [--no-full-page] [--dark|--light]\n" +
        "       [--wait MS] [--timeout MS]\n\n" +
        `scenes: ${Object.entries(SCENES)
          .map(([k, v]) => `${k} (${v.description})`)
          .join("\n        ")}`,
    );
    process.exit(0);
  }

  // Modals are fixed/viewport-anchored: a full-page shot renders them as a
  // small overlay floating on a very tall page. Default scenes to a viewport
  // capture so the modal fills the frame, unless the caller said otherwise.
  if (opts.scene && !opts.fullPageExplicit) opts.fullPage = false;

  return opts;
}

/**
 * Resolve a preset name (or an explicit WxH) into a viewport descriptor.
 * An explicit --scale overrides the preset's deviceScaleFactor.
 */
function resolveViewport(presetName, viewportArg, scaleArg) {
  let vp;
  if (viewportArg) {
    const m = /^(\d+)x(\d+)$/.exec(viewportArg);
    if (!m) {
      console.error(`error: --viewport must look like 1440x900 (got "${viewportArg}")`);
      process.exit(2);
    }
    vp = {
      width: Number(m[1]),
      height: Number(m[2]),
      deviceScaleFactor: 1,
      isMobile: false,
    };
  } else {
    const preset = PRESETS[presetName];
    if (!preset) {
      console.error(`error: --preset must be desktop|mobile|both (got "${presetName}")`);
      process.exit(2);
    }
    vp = preset;
  }
  if (scaleArg !== null) {
    if (!Number.isFinite(scaleArg) || scaleArg <= 0) {
      console.error(`error: --scale must be a positive number (got "${scaleArg}")`);
      process.exit(2);
    }
    vp = { ...vp, deviceScaleFactor: scaleArg };
  }
  return vp;
}

function defaultOut(presetName, sceneName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const label = sceneName ? `${sceneName}-${presetName}` : presetName;
  return `screenshots/${label}-${stamp}.png`;
}

async function capture(browser, opts, presetName) {
  const vp = resolveViewport(presetName, opts.viewport, opts.scale);
  const outPath = resolve(
    opts.out && opts.preset !== "both" ? opts.out : defaultOut(presetName, opts.scene),
  );
  await mkdir(dirname(outPath), { recursive: true });

  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
    ...(opts.colorScheme ? { colorScheme: opts.colorScheme } : {}),
  });
  const page = await context.newPage();

  // Surface page-side failures instead of silently shooting a broken page.
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const res = await page.goto(opts.url, {
    waitUntil: "networkidle",
    timeout: opts.timeoutMs,
  });
  if (res && !res.ok()) {
    throw new Error(`${opts.url} returned HTTP ${res.status()}`);
  }

  // Settle: let async stores resolve and charts finish their entry animation.
  await page.waitForTimeout(opts.waitMs);

  // Scene: drive the UI into a modal state before shooting.
  if (opts.scene) {
    const scene = SCENES[opts.scene];
    if (!scene) {
      throw new Error(`unknown --scene "${opts.scene}" (have: ${Object.keys(SCENES).join(", ")})`);
    }
    const opener = page.locator(scene.open).first();
    if ((await opener.count()) === 0) {
      throw new Error(
        `scene "${opts.scene}": trigger ${scene.open} not found. ` +
          `The AI buttons only render when whoami reports llm_logging_enabled=1 ` +
          `AND llm_available=true — check the API has an ANTHROPIC_API_KEY.`,
      );
    }
    await opener.click();
    await page
      .locator(scene.waitFor)
      .first()
      .waitFor({ state: "visible", timeout: opts.timeoutMs })
      .catch(() => {
        // Fall through: the modal may not match our guessed class hooks, but a
        // full-page shot still captures whatever opened.
      });

    // Optional: send one or more messages, waiting for each reply to land.
    if (scene.type) {
      const texts = scene.type.texts ?? [scene.type.text];
      for (const text of texts) {
        const input = page.locator(scene.type.into).first();
        await input.waitFor({ state: "visible", timeout: opts.timeoutMs });
        await input.fill(text);
        await page.locator(scene.type.submit).first().click();
        // The pending indicator appears then disappears; wait for it to clear
        // so the shot captures the finished response rather than a spinner.
        // Falls back to the settle timeout if the request is slow.
        await page
          .locator(scene.type.until)
          .first()
          .waitFor({ state: "hidden", timeout: opts.timeoutMs })
          .catch(() => {});
        await page.waitForTimeout(600);
      }
    }

    await page.waitForTimeout(scene.settleMs);
  }

  const target = opts.selector ? page.locator(opts.selector).first() : page;
  if (opts.selector) {
    await target.waitFor({ state: "visible", timeout: opts.timeoutMs });
  }

  await target.screenshot({
    path: outPath,
    ...(opts.selector ? {} : { fullPage: opts.fullPage }),
  });

  const dims = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
  }));
  await context.close();

  return { outPath, vp, dims, errors };
}

async function main() {
  const opts = parseArgs(process.argv);
  const presets = opts.preset === "both" ? ["desktop", "mobile"] : [opts.preset];

  let browser;
  try {
    // channel:"chrome" uses the system Chrome install — no bundled download.
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (err) {
    console.error("Failed to launch system Chrome via Playwright.");
    console.error(String(err && err.message ? err.message : err));
    console.error(
      "\nInstall Chrome/Chromium, or download Playwright's own browser with:\n" +
        "  pnpm exec playwright install chromium\n" +
        "then re-run with PW_USE_BUNDLED=1.",
    );
    process.exit(1);
  }

  try {
    for (const presetName of presets) {
      const { outPath, vp, dims, errors } = await capture(browser, opts, presetName);
      console.log(
        `✓ ${presetName}: ${outPath}\n` +
          `  viewport ${vp.width}x${vp.height} @${vp.deviceScaleFactor}x → page ${dims.w}x${dims.h}px` +
          `${opts.selector ? ` (element ${opts.selector})` : opts.fullPage ? " (full page)" : ""}`,
      );
      if (errors.length > 0) {
        console.warn(`  ⚠ ${errors.length} page error(s):`);
        for (const e of errors.slice(0, 5)) console.warn(`    ${e.slice(0, 160)}`);
      }
    }
  } catch (err) {
    console.error(`Capture failed: ${String(err && err.message ? err.message : err)}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
