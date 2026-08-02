import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import {
  createStoredMeal,
  deleteStoredMeal,
  findStoredMealById,
  findStoredMealByName,
  listStoredMeals,
  updateStoredMeal,
} from "./stored-meals.repo.js";

function sampleInput(userId: number, name = "breakfast") {
  return {
    user_id: userId,
    name,
    kcal: 350,
    protein_g: 25,
    carb_g: 30,
    fat_g: 15,
    description: "2 eggs, toast, coffee",
  };
}

describe("stored-meals.repo", () => {
  it("createStoredMeal returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createStoredMeal(db, sampleInput(userId));
    expect(meal.id).toBeGreaterThan(0);
    expect(meal.name).toBe("breakfast");
    expect(meal.kcal).toBe(350);
    expect(meal.description).toBe("2 eggs, toast, coffee");
  });

  it("createStoredMeal upserts on (user_id, name) — same id, updated macros", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const first = createStoredMeal(db, sampleInput(userId));
    const second = createStoredMeal(db, {
      ...sampleInput(userId),
      kcal: 500,
      protein_g: 40,
      description: "bigger portion",
    });
    expect(second.id).toBe(first.id);
    expect(second.kcal).toBe(500);
    expect(second.protein_g).toBe(40);
    expect(second.description).toBe("bigger portion");
    expect(listStoredMeals(db, userId)).toHaveLength(1);
  });

  it("listStoredMeals returns a user's meals ordered by name", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createStoredMeal(db, sampleInput(userId, "zucchini bowl"));
    createStoredMeal(db, sampleInput(userId, "apple snack"));
    const list = listStoredMeals(db, userId);
    expect(list.map((m) => m.name)).toEqual(["apple snack", "zucchini bowl"]);
  });

  it("findStoredMealById is user-scoped (no cross-user read)", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "A" });
    const userB = seedUser(db, { name: "B" });
    const meal = createStoredMeal(db, sampleInput(userA));
    expect(findStoredMealById(db, userA, meal.id)?.id).toBe(meal.id);
    expect(findStoredMealById(db, userB, meal.id)).toBeNull();
  });

  it("findStoredMealByName is user-scoped and case-sensitive-exact", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createStoredMeal(db, sampleInput(userId, "breakfast"));
    expect(findStoredMealByName(db, userId, "breakfast")?.name).toBe("breakfast");
    expect(findStoredMealByName(db, userId, "lunch")).toBeNull();
  });

  it("updateStoredMeal patches macros and description", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createStoredMeal(db, sampleInput(userId));
    const updated = updateStoredMeal(db, userId, meal.id, { kcal: 400, description: null });
    expect(updated?.kcal).toBe(400);
    expect(updated?.description).toBeNull();
  });

  it("updateStoredMeal can rename", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createStoredMeal(db, sampleInput(userId, "breakfast"));
    const updated = updateStoredMeal(db, userId, meal.id, { name: "weekday breakfast" });
    expect(updated?.name).toBe("weekday breakfast");
  });

  it("updateStoredMeal returns null for an unknown id / wrong user", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "A" });
    const userB = seedUser(db, { name: "B" });
    const meal = createStoredMeal(db, sampleInput(userA));
    expect(updateStoredMeal(db, userB, meal.id, { kcal: 1 })).toBeNull();
    expect(updateStoredMeal(db, userA, 99999, { kcal: 1 })).toBeNull();
  });

  it("updateStoredMeal rename collision throws (UNIQUE constraint)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createStoredMeal(db, sampleInput(userId, "breakfast"));
    const lunch = createStoredMeal(db, sampleInput(userId, "lunch"));
    expect(() => updateStoredMeal(db, userId, lunch.id, { name: "breakfast" })).toThrow();
  });

  it("deleteStoredMeal hard-deletes, user-scoped", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "A" });
    const userB = seedUser(db, { name: "B" });
    const meal = createStoredMeal(db, sampleInput(userA));
    // Wrong-user delete is a no-op — the row survives.
    deleteStoredMeal(db, userB, meal.id);
    expect(findStoredMealById(db, userA, meal.id)?.id).toBe(meal.id);
    // Owner delete removes it.
    deleteStoredMeal(db, userA, meal.id);
    expect(findStoredMealById(db, userA, meal.id)).toBeNull();
  });
});
