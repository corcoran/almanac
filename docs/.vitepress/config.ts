import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Almanac",
  description:
    "Self-hosted documentation for Almanac — a precise fitness record your own AI agent can read.",
  base: "/",
  lang: "en-US",
  cleanUrls: true,
  // Specs and plans under docs/superpowers/ are gitignored working notes, not
  // product docs. VitePress treats every .md under docs/ as a page, so without
  // this a local build renders them into the site.
  srcExclude: ["superpowers/**"],
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
    // The nav-bar title links to the landing page, which is a static file in
    // public/ rather than a VitePress page — so it needs a real browser
    // navigation, same as the "Overview" entry below. Note this link is used
    // verbatim (VPNavBarTitle skips normalizeLink when logoLink is set), so it
    // carries the `base` prefix itself.
    logoLink: { link: "/", target: "_self" },
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "Deploy", link: "/guide/deploy" },
      // The landing page is a static file in public/, NOT a VitePress page, so
      // it isn't in the SPA route map. `target: "_self"` forces a real browser
      // navigation — a plain internal link 404s in the router without ever
      // reaching the server.
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
