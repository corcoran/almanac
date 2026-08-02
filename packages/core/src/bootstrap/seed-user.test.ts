import { describe, expect, it } from "vitest";
import { findActivePhase } from "../repos/nutrition-phases.repo.js";
import { findUserById } from "../repos/users.repo.js";
import { freshDb } from "../test-support/db.js";
import { seedUser } from "./seed-user.js";

describe("seedUser", () => {
  it("creates a user with no phase", () => {
    const db = freshDb();
    const out = seedUser(db, {
      name: "Jeff",
      dob: "1990-01-01",
      height_cm: 180,
      sex: "male",
    });
    expect(out.user_id).toBeGreaterThan(0);
    const user = findUserById(db, out.user_id);
    expect(user?.name).toBe("Jeff");
    expect(findActivePhase(db, out.user_id)).toBeNull();
  });

  it("works with missing demographics", () => {
    const db = freshDb();
    const out = seedUser(db, { name: "Anon", dob: null, height_cm: null, sex: null });
    const user = findUserById(db, out.user_id);
    expect(user?.name).toBe("Anon");
    expect(user?.dob).toBeNull();
  });

  it("refuses when a user already exists", () => {
    const db = freshDb();
    seedUser(db, { name: "Jeff", dob: null, height_cm: null, sex: null });
    expect(() => seedUser(db, { name: "Other", dob: null, height_cm: null, sex: null })).toThrow(
      /already exists/i,
    );
  });

  it("makes the seeded (first) user an admin", () => {
    // seedUser only ever creates the FIRST user (it throws otherwise), so the
    // seeded user owns the instance and is bootstrapped as admin.
    const db = freshDb();
    const out = seedUser(db, { name: "Jeff", dob: null, height_cm: null, sex: null });
    expect(findUserById(db, out.user_id)?.is_admin).toBe(1);
  });
});
