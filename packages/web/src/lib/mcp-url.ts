/**
 * The MCP URL we show users is just `window.location.origin + "/mcp"` — i.e.
 * whatever they typed to reach the app. That works for Claude Code, which runs
 * on their machine, but NOT for Claude web/mobile or ChatGPT: those fetch the
 * URL from the vendor's servers, so `localhost` is the vendor's localhost and a
 * 192.168.x address isn't routable from outside the LAN at all.
 *
 * Telling every user "add this as a remote MCP server in Claude or ChatGPT"
 * therefore sends anyone on a local or LAN install down a path that cannot
 * work, with no error explaining why. We check reachability and adjust the
 * guidance instead.
 */

/** Hostnames that only ever resolve on the local machine or local network. */
const LOCAL_HOST_NAMES = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);

/** Suffixes used for local name resolution (mDNS / RFC 8375). */
const LOCAL_SUFFIXES = [".local", ".home.arpa", ".internal"];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — NOT all of 172.
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (Tailscale)
  return false;
}

/**
 * True when `origin` is an address a third-party server could actually reach.
 * Errs toward `false`: an unparseable origin is treated as not reachable, so
 * we show the more cautious guidance rather than promise something broken.
 */
export function isPubliclyReachable(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (LOCAL_HOST_NAMES.has(host)) return false;
  if (LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return false;
  if (isPrivateIpv4(host)) return false;
  return true;
}

/** The MCP endpoint for this deployment, derived from where the app is served. */
export function mcpUrlFor(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp`;
}
