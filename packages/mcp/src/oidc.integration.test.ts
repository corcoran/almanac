import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { generateKeyPair, errors as joseErrors, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOidcClient } from "./oidc.js";

// Real Keycloak fixture — no mocks. Boots scripts/local-dev/keycloak.sh (a
// single ephemeral-H2 container on :8085) and exercises createOidcClient
// against genuine discovery + JWKS + RS256-signed tokens.
const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const ISSUER = "http://localhost:8085/realms/almanac";
const CLIENT_ID = "almanac-mcp";
const SEEDED_EMAIL = "integration@example.com";
const SEEDED_PASSWORD = "integration-dev-password";

// keycloak.sh writes the per-run generated client secret here (never as a
// pre-set env var, and never committed) — see the script's header comment.
const SECRETS_FILE = "/tmp/almanac-keycloak/secrets.env";

function readClientSecret(): string {
  let contents: string;
  try {
    contents = readFileSync(SECRETS_FILE, "utf8");
  } catch (cause) {
    throw new Error(
      `Could not read the Keycloak fixture secrets file at ${SECRETS_FILE}: ${String(cause)}`,
    );
  }
  const match = contents.split("\n").find((line) => line.startsWith("ALMANAC_TEST_KC_MCP_SECRET="));
  if (match === undefined) {
    throw new Error(`${SECRETS_FILE} did not contain ALMANAC_TEST_KC_MCP_SECRET`);
  }
  const secret = match.slice("ALMANAC_TEST_KC_MCP_SECRET=".length).trim();
  if (secret === "") {
    throw new Error(`ALMANAC_TEST_KC_MCP_SECRET in ${SECRETS_FILE} was empty`);
  }
  return secret;
}

/** Password-grant against the real fixture, returning the raw id_token. */
async function passwordGrantIdToken(tokenEndpoint: string, secret: string): Promise<string> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      client_secret: secret,
      username: SEEDED_EMAIL,
      password: SEEDED_PASSWORD,
      scope: "openid email",
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak password grant failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { id_token?: string };
  if (body.id_token === undefined) throw new Error("Keycloak returned no id_token");
  return body.id_token;
}

/** Decode (NOT verify) a JWT's payload — used only to lift realistic claim
 *  values (e.g. `sub`) out of a genuine token for building forged tokens
 *  that are byte-for-byte plausible except for the signing key. */
function decodePayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  const segment = parts[1];
  if (segment === undefined) {
    throw new Error("JWT did not have a payload segment");
  }
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Fetch Keycloak's real signing-key `kid` from its JWKS — used to build the
 *  key-confusion adversarial case (real kid, wrong key material). */
async function realSigningKid(jwksUri: string): Promise<string> {
  const res = await fetch(jwksUri);
  const jwks = (await res.json()) as { keys: Array<{ kid?: string; alg?: string }> };
  const sigKey = jwks.keys.find((k) => k.alg === "RS256");
  if (sigKey?.kid === undefined) {
    throw new Error(`No RS256 signing key found in JWKS at ${jwksUri}`);
  }
  return sigKey.kid;
}

beforeAll(() => {
  execFileSync("scripts/local-dev/keycloak.sh", [SEEDED_EMAIL], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}, 120_000);

afterAll(() => {
  execFileSync("scripts/local-dev/keycloak.sh", ["--down"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}, 60_000);

describe("OIDC against a real Keycloak", () => {
  it("discovers the documented endpoints", async () => {
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID });
    const ep = await client.endpoints();
    expect(ep.issuer).toBe(ISSUER);
    expect(ep.tokenEndpoint).toContain("/protocol/openid-connect/token");
    expect(ep.jwksUri).toContain("/protocol/openid-connect/certs");
  });

  it("verifies a genuinely signed id_token from the direct grant", async () => {
    // Real key, real JWKS fetch, real signature — the assertion the unit
    // tests structurally cannot make.
    const secret = readClientSecret();
    const client = createOidcClient({
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: secret,
    });
    const ep = await client.endpoints();
    const idToken = await passwordGrantIdToken(ep.tokenEndpoint, secret);

    await expect(client.verifyIdToken(idToken)).resolves.toMatchObject({
      email: SEEDED_EMAIL,
    });
  });

  it("rejects a forged token with a complete, realistic claim set signed by an unrelated key", async () => {
    // The forged token below is indistinguishable from a genuine Keycloak
    // id_token in every respect EXCEPT the signing key: it carries a real
    // sub (lifted from an actual login), the real issuer/audience, and
    // email_verified: true. A weakened verifier that special-cases missing
    // claims (e.g. only checking the signature when `sub` is absent) would
    // pass this test only by actually checking the signature — that is the
    // property under test, and the earlier version of this test (bare
    // `.rejects.toThrow()`, no `sub` claim) did not exercise it.
    const secret = readClientSecret();
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID });
    const ep = await client.endpoints();

    const genuineToken = await passwordGrantIdToken(ep.tokenEndpoint, secret);
    const { sub: realSub } = decodePayload(genuineToken);
    if (typeof realSub !== "string" || realSub === "") {
      throw new Error("Genuine id_token had no usable sub claim to reuse in the forged token");
    }

    // Signed by a throwaway key Keycloak's JWKS does not contain.
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({
      sub: realSub,
      email: SEEDED_EMAIL,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(client.verifyIdToken(forged)).rejects.toThrow(
      joseErrors.JWSSignatureVerificationFailed,
    );
  });

  it("rejects a forged token whose header names a real kid from Keycloak's JWKS", async () => {
    // A stricter adversarial case than "unknown kid": copy the *real*
    // signing key's kid from the live JWKS into the forged token's header,
    // but sign with unrelated key material. This exercises key-lookup
    // SUCCEEDING (the kid resolves to Keycloak's actual key) followed by
    // signature verification FAILING against that resolved key — a
    // different path through jose's remote-JWKS matcher than an unknown
    // kid, which would fail at lookup instead of at signature check.
    const client = createOidcClient({ issuer: ISSUER, clientId: CLIENT_ID });
    const ep = await client.endpoints();
    const realKid = await realSigningKid(ep.jwksUri);

    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({
      sub: "forged-sub-with-real-kid",
      email: SEEDED_EMAIL,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: realKid })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(client.verifyIdToken(forged)).rejects.toThrow(
      joseErrors.JWSSignatureVerificationFailed,
    );
  });
});
