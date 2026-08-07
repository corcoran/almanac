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
  themeConfig: {
    search: { provider: "local" },
    nav: [],
    sidebar: [],
    socialLinks: [{ icon: "github", link: "https://github.com/corcoran/almanac" }],
    editLink: {
      pattern: "https://github.com/corcoran/almanac/edit/master/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
