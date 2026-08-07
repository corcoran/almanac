import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Almanac",
  description:
    "Self-hosted documentation for Almanac — a precise fitness record your own AI agent can read.",
  base: "/",
  lang: "en-US",
  cleanUrls: true,
  // VitePress only sitemaps rendered pages; the landing page is a static file
  // in public/ that it never renders, so the root URL needs adding by hand.
  sitemap: {
    hostname: "https://almanac-fitness.com",
    transformItems: (items) => [...items, { url: "/" }],
  },
  // Specs and plans under docs/superpowers/ are gitignored working notes, not
  // product docs. `_*.md` files are include-partials, not pages. VitePress
  // treats every .md under docs/ as a page, so without this a local build
  // renders both into the site.
  srcExclude: ["superpowers/**", "**/_*.md"],
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
  ],
  themeConfig: {
    search: { provider: "local" },
    // The landing page is deliberately a hand-authored static file in public/,
    // not a VitePress page. That keeps it outside the SPA route map, so links
    // to it need a real browser navigation. Note this link is used verbatim
    // (VPNavBarTitle skips normalizeLink when logoLink is set), so it carries
    // the `base` prefix itself.
    logoLink: { link: "/", target: "_self" },
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Deploy", link: "/guide/deploy" },
      // Same deliberate static landing page as logoLink above: not in the SPA
      // route map, so `target: "_self"` forces a real browser navigation. A
      // plain internal link 404s in the router without reaching the server.
      { text: "Overview", link: "/", target: "_self" },
    ],
    sidebar: [
      {
        text: "Setup",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Deploy", link: "/guide/deploy" },
          { text: "Authentication", link: "/guide/authentication" },
        ],
      },
      {
        text: "Using Almanac",
        items: [
          { text: "Connecting assistants", link: "/guide/connecting-assistants" },
          { text: "Configuration", link: "/guide/configuration" },
        ],
      },
      {
        text: "Running it",
        items: [
          { text: "Operations", link: "/guide/operations" },
          { text: "Architecture", link: "/guide/architecture" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/corcoran/almanac" }],
    editLink: {
      pattern: "https://github.com/corcoran/almanac/edit/master/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
