import { describe, expect, it } from "vitest";
import { AdminUserSummarySchema, AdminUserUpdateSchema } from "./admin.js";

describe("AdminUserUpdateSchema", () => {
  it("accepts a partial update of the three admin-settable fields", () => {
    expect(AdminUserUpdateSchema.parse({ llm_logging_enabled: 1 })).toEqual({
      llm_logging_enabled: 1,
    });
    expect(AdminUserUpdateSchema.parse({ llm_daily_token_limit: 50000 })).toEqual({
      llm_daily_token_limit: 50000,
    });
    expect(AdminUserUpdateSchema.parse({ llm_daily_token_limit: null })).toEqual({
      llm_daily_token_limit: null,
    });
    expect(AdminUserUpdateSchema.parse({ is_admin: 0 })).toEqual({ is_admin: 0 });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() => AdminUserUpdateSchema.parse({ name: "hacker" })).toThrow();
  });

  it("coerces llm_logging_enabled / is_admin to 0|1 only", () => {
    expect(() => AdminUserUpdateSchema.parse({ is_admin: 2 })).toThrow();
    expect(() => AdminUserUpdateSchema.parse({ llm_logging_enabled: -1 })).toThrow();
  });

  it("rejects a negative daily limit", () => {
    expect(() => AdminUserUpdateSchema.parse({ llm_daily_token_limit: -5 })).toThrow();
  });
});

describe("AdminUserSummarySchema", () => {
  it("shapes a user row for the admin list", () => {
    const row = AdminUserSummarySchema.parse({
      id: 1,
      name: "Jeff",
      email: "j@x.com",
      llm_logging_enabled: 1,
      is_admin: 1,
      llm_daily_token_limit: 50000,
    });
    expect(row.id).toBe(1);
    expect(row.llm_daily_token_limit).toBe(50000);
  });

  it("allows null email + null limit", () => {
    const row = AdminUserSummarySchema.parse({
      id: 2,
      name: "Sam",
      email: null,
      llm_logging_enabled: 0,
      is_admin: 0,
      llm_daily_token_limit: null,
    });
    expect(row.email).toBeNull();
    expect(row.llm_daily_token_limit).toBeNull();
  });
});
