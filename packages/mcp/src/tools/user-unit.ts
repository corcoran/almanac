import type { UnitSystem } from "@almanac/core/types";
import type { ToolDeps } from "../tool.js";

/**
 * Fetch the current user's preferred display unit. Used by the accomplishment
 * tools to render their summary prose (prior_best / "most down") in the right
 * unit — the structured `value` fields stay kg by contract. Falls back to
 * metric if the profile is missing the field.
 */
export async function fetchUnitSystem(deps: ToolDeps): Promise<UnitSystem> {
  const user = await deps.api.request<{ preferred_unit_system?: UnitSystem }>(
    "GET",
    "/api/v1/users/me",
    undefined,
    { bearer: deps.currentToken() },
  );
  return user.preferred_unit_system === "imperial" ? "imperial" : "metric";
}
