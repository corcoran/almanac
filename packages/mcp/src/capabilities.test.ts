import { describe, expect, it, vi } from "vitest";
import { ALMANAC_CAPABILITIES } from "./capabilities.js";
import { ApiClient } from "./client.js";
import { buildMcpServer } from "./server.js";
import { connectTestClient } from "./test-support/mcp-harness.js";

/**
 * The capability catalog is hand-curated (NOT auto-derived from the
 * registry). That gives us editorial control over how entities and
 * workflows are presented — but it also means a new tool can land in
 * the registry without making it into the catalog. This file's purpose
 * is to fail loud when that happens, so the curated content stays in
 * sync with reality.
 */
describe("ALMANAC_CAPABILITIES", () => {
  async function getRegisteredToolNames(): Promise<string[]> {
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl: vi.fn() });
    const server = buildMcpServer({ api }, () => "alm_test");
    const client = await connectTestClient(server);
    const result = await client.listTools();
    return result.tools.map((t) => t.name);
  }

  it("every registered tool appears somewhere in the catalog", async () => {
    const registered = await getRegisteredToolNames();
    const catalogued = new Set<string>();
    for (const bucket of Object.values(ALMANAC_CAPABILITIES.tools_by_entity)) {
      for (const verb of Object.values(bucket ?? {})) {
        for (const name of verb as string[]) catalogued.add(name);
      }
    }
    for (const tool of ALMANAC_CAPABILITIES.tools_other) {
      catalogued.add(tool.name);
    }
    const missing = registered.filter((n) => !catalogued.has(n));
    expect(missing, `tools missing from capabilities.ts catalog: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("every tool in the catalog actually exists in the registry", async () => {
    const registered = new Set(await getRegisteredToolNames());
    const cataloguedNames: string[] = [];
    for (const bucket of Object.values(ALMANAC_CAPABILITIES.tools_by_entity)) {
      for (const verb of Object.values(bucket ?? {})) {
        for (const name of verb as string[]) cataloguedNames.push(name);
      }
    }
    for (const tool of ALMANAC_CAPABILITIES.tools_other) {
      cataloguedNames.push(tool.name);
    }
    const ghosts = cataloguedNames.filter((n) => !registered.has(n));
    expect(ghosts, `catalog references nonexistent tools: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("conventions section calls out timezone handling, units, and idempotency", () => {
    // Anchor the most important conventions — if a refactor trims one
    // accidentally, callers depending on it see broken guidance.
    expect(ALMANAC_CAPABILITIES.conventions.timezone_handling).toMatch(/naked-local/i);
    expect(ALMANAC_CAPABILITIES.conventions.weights_unit).toMatch(/kg/);
    expect(ALMANAC_CAPABILITIES.conventions.idempotency).toMatch(/log_workout/);
  });

  it("includes the dupe-workout cleanup recipe (the case that motivated this feature)", () => {
    const recipe = ALMANAC_CAPABILITIES.common_workflows.find((w) =>
      w.name.includes("duplicate workout"),
    );
    expect(recipe).toBeDefined();
    expect(recipe?.steps.join(" ")).toMatch(/delete_workout/);
  });

  it("names get_next_best_action as the recommended entrypoint", () => {
    expect(ALMANAC_CAPABILITIES.recommended_entrypoint).toBe("get_next_best_action");
  });

  it("includes the new_user_onboarding workflow recipe", () => {
    const recipe = ALMANAC_CAPABILITIES.common_workflows.find(
      (w) => w.name === "new_user_onboarding",
    );
    expect(recipe).toBeDefined();
    expect(recipe?.steps.join(" ")).toMatch(/start_nutrition_phase/);
  });
});
