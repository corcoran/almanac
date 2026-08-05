import { describe, expect, it } from "vitest";
import { isPubliclyReachable } from "./mcp-url.js";

describe("isPubliclyReachable", () => {
  it("rejects localhost in every spelling", () => {
    for (const o of [
      "http://localhost:4180",
      "https://localhost",
      "http://127.0.0.1:5199",
      "http://127.1.2.3",
      "http://[::1]:4180",
    ]) {
      expect(isPubliclyReachable(o), o).toBe(false);
    }
  });

  it("rejects RFC1918 private ranges", () => {
    for (const o of [
      "http://10.0.0.5:3001",
      "http://192.168.1.42:5199",
      "http://172.16.0.1",
      "http://172.31.255.254",
    ]) {
      expect(isPubliclyReachable(o), o).toBe(false);
    }
  });

  it("does NOT mistake 172.32.x / 172.15.x for private space", () => {
    // The private block is 172.16.0.0–172.31.255.255. Naive `172.` prefix
    // matching would wrongly flag these public addresses.
    expect(isPubliclyReachable("http://172.32.0.1")).toBe(true);
    expect(isPubliclyReachable("http://172.15.0.1")).toBe(true);
  });

  it("rejects link-local, CGNAT, and .local mDNS names", () => {
    for (const o of [
      "http://169.254.1.1",
      "http://100.64.0.1",
      "http://almanac.local:5199",
      "http://nas.home.arpa",
    ]) {
      expect(isPubliclyReachable(o), o).toBe(false);
    }
  });

  it("accepts a real public domain", () => {
    for (const o of ["https://almanac.example.com", "https://almanac.example.com:8443"]) {
      expect(isPubliclyReachable(o), o).toBe(true);
    }
  });

  it("treats a Tailscale 100.x address as not publicly reachable", () => {
    // 100.64.0.0/10 is CGNAT space; a tailnet peer can reach it but
    // Anthropic's or OpenAI's servers cannot.
    expect(isPubliclyReachable("http://100.101.102.103:4180")).toBe(false);
  });

  it("returns false rather than throwing on an unparseable origin", () => {
    expect(isPubliclyReachable("not a url")).toBe(false);
    expect(isPubliclyReachable("")).toBe(false);
  });
});
