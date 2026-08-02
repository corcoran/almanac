import { nthCall } from "@almanac/core/test-support";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../client.js";
import { ToolError } from "../tool.js";
import { makeUpdatePhaseTool } from "./update-phase.js";

function mockJsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

const updatedPhase = {
  id: 1,
  user_id: 1,
  name: "Renamed cut",
  intent: "cut",
  phase_type: "cut",
  tdee_at_phase_start: 2400,
  tdee_source: "user_asserted",
  deficit_kcal: -500,
  daily_kcal_target: 1900,
  base_protein_g: 180,
  base_carb_g: 170,
  base_fat_g: 60,
  started_on: "2026-05-01",
  planned_end_on: null,
  ended_on: null,
  notes: null,
  created_at: "2026-05-01T08:00:00Z",
};

describe("update_phase", () => {
  // ---- Pass-through cases --------------------------------------------------
  it("PATCHes /api/v1/nutrition-phases/:id with the body (rename only — none of the triple involved)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updatedPhase));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({ phase_id: 1, name: "Renamed cut" });
    const r = result as { phase: { name: string } };
    expect(r.phase.name).toBe("Renamed cut");
    const call = nthCall(fetchImpl, 0);
    expect(call[0]).toBe("http://x/api/v1/nutrition-phases/1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body)).toEqual({ name: "Renamed cut" });
  });

  it("coherent triple patch (tdee + deficit + target consistent) → PATCH passes through", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updatedPhase));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    const result = await tool.handler({
      phase_id: 1,
      tdee_at_phase_start: 2500,
      deficit_kcal: -600,
      daily_kcal_target: 1900, // 2500 - 600 = 1900 ✓
    });
    expect((result as { phase: unknown }).phase).toBeDefined();
    const body = JSON.parse(nthCall(fetchImpl, 0)[1].body);
    expect(body.tdee_at_phase_start).toBe(2500);
    expect(body.deficit_kcal).toBe(-600);
    expect(body.daily_kcal_target).toBe(1900);
  });

  it("auto-derives daily_kcal_target when only tdee + deficit are patched", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(200, updatedPhase));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    await tool.handler({
      phase_id: 1,
      tdee_at_phase_start: 2500,
      deficit_kcal: -600,
    });
    const body = JSON.parse(nthCall(fetchImpl, 0)[1].body);
    // Derived: 2500 + (-600) = 1900
    expect(body.daily_kcal_target).toBe(1900);
    expect(body.tdee_at_phase_start).toBe(2500);
    expect(body.deficit_kcal).toBe(-600);
  });

  // ---- Coherence-rule rejections (no API call) ---------------------------
  it("rejects single-field patch on deficit_kcal alone (ambiguous) — no API call", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    try {
      await tool.handler({ phase_id: 1, deficit_kcal: -700 });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const payload = (err as ToolError).payload as {
        error: string;
        field: string;
        message: string;
      };
      expect(payload.error).toBe("ambiguous_patch");
      expect(payload.field).toBe("deficit_kcal");
      expect(payload.message).toMatch(/internally inconsistent/i);
    }
    // Crucially, no API call was attempted.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects single-field patch on tdee_at_phase_start alone", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ phase_id: 1, tdee_at_phase_start: 2500 })).rejects.toBeInstanceOf(
      ToolError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects single-field patch on daily_kcal_target alone", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });
    await expect(tool.handler({ phase_id: 1, daily_kcal_target: 2000 })).rejects.toBeInstanceOf(
      ToolError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects two-field patch that isn't the auto-derivable pair (tdee + target without deficit)", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    try {
      await tool.handler({
        phase_id: 1,
        tdee_at_phase_start: 2500,
        daily_kcal_target: 1900,
      });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const payload = (err as ToolError).payload as { error: string; missing_field: string };
      expect(payload.error).toBe("ambiguous_patch");
      expect(payload.missing_field).toBe("deficit_kcal");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent three-field patch (tdee + deficit !== target)", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    try {
      await tool.handler({
        phase_id: 1,
        tdee_at_phase_start: 2500,
        deficit_kcal: -500,
        daily_kcal_target: 1800, // should be 2000
      });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const payload = (err as ToolError).payload as { error: string; message: string };
      expect(payload.error).toBe("inconsistent_patch");
      expect(payload.message).toMatch(/invariant/i);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ---- Phase-type / deficit invariant -----------------------------------
  it("rejects 'cut' with positive deficit_kcal (phase-invariant violation) before any API call", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    try {
      await tool.handler({
        phase_id: 1,
        phase_type: "cut",
        deficit_kcal: 500, // positive on a cut — invalid
        tdee_at_phase_start: 2400,
        daily_kcal_target: 2900, // consistent with the triple invariant
      });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const payload = (err as ToolError).payload as { error: string; message: string };
      expect(payload.error).toBe("validation_failed");
      expect(payload.message).toMatch(/cut/);
      expect(payload.message).toMatch(/deficit_kcal/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects 'maintenance' with deficit > 5% band (phase-invariant violation)", async () => {
    const fetchImpl = vi.fn();
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    // 5% of 2400 = 120. -500 exceeds the band → maintenance violation.
    await expect(
      tool.handler({
        phase_id: 1,
        phase_type: "maintenance",
        tdee_at_phase_start: 2400,
        deficit_kcal: -500,
        daily_kcal_target: 1900,
      }),
    ).rejects.toBeInstanceOf(ToolError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ---- API error pass-through -------------------------------------------
  it("forwards 400 validation_failed from the API as a ToolError", async () => {
    const errBody = { error: { code: "validation_failed", message: "some api-side rule" } };
    const fetchImpl = vi.fn().mockResolvedValueOnce(mockJsonResponse(400, errBody));
    const api = new ApiClient({ baseUrl: "http://x", fetchImpl });
    const tool = makeUpdatePhaseTool({
      api,
      currentUserId: async () => 1,
      currentToken: () => "alm_test",
    });

    try {
      // A patch with no triple fields → bypasses MCP-side checks, hits the API.
      await tool.handler({ phase_id: 1, name: "x" });
      throw new Error("expected ToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).payload).toEqual(errBody);
    }
  });
});
