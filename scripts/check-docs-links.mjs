#!/usr/bin/env node
//
// Dead-link check over the built docs site. Run after `pnpm docs:build`.
//
// VitePress already fails the build on a link to a page that doesn't exist, so
// this exists for the half it doesn't check: `#fragment` targets. A link to a
// real page with a heading anchor that was never written builds clean and ships
// broken. It also covers README.md, which isn't part of the site but links into
// it with absolute URLs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = "docs/.vitepress/dist";
const SITE = "https://almanac-fitness.com";

if (!existsSync(DIST)) {
  console.error(`no build at ${DIST} — run \`pnpm docs:build\` first.`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const pages = walk(DIST).filter((f) => f.endsWith(".html"));
const key = (f) => `/${relative(DIST, f).replace(/\\/g, "/")}`;

// Every element id on every built page, so fragments can be resolved.
const idsByPage = new Map(
  pages.map((f) => [
    key(f),
    new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
  ]),
);

// `cleanUrls: true` means /guide/deploy is served from guide/deploy.html.
function resolvePage(path) {
  const bare = path.replace(/\/$/, "");
  for (const candidate of [`${bare}.html`, `${bare}/index.html`, "/index.html"]) {
    if (idsByPage.has(candidate)) return candidate;
  }
  return null;
}

const problems = [];
let checked = 0;

function check(rawHref, source) {
  const href = rawHref.startsWith(SITE) ? rawHref.slice(SITE.length) || "/" : rawHref;
  if (/^(https?:|mailto:|#)/.test(href) || !href.startsWith("/")) return;
  const [path, fragment] = href.split("#");
  // Static assets are not pages.
  if (/\.[a-z0-9]+$/i.test(path) && !path.endsWith(".html")) return;
  checked++;
  const page = resolvePage(path || "/");
  if (!page) {
    problems.push(`dead page    ${source}  ->  ${rawHref}`);
  } else if (fragment && !idsByPage.get(page).has(fragment)) {
    problems.push(`dead anchor  ${source}  ->  ${rawHref}`);
  }
}

for (const f of pages) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/href="([^"]+)"/g)) check(m[1], key(f));
}

if (existsSync("README.md")) {
  const md = readFileSync("README.md", "utf8");
  for (const m of md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) check(m[1], "README.md");
}

if (problems.length > 0) {
  console.error(`${problems.length} dead link(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `OK: ${checked} internal links across ${pages.length} pages, no dead pages or anchors.`,
);
