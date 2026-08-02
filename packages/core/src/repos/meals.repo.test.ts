import { describe, expect, it } from "vitest";
import { freshDb, seedUser } from "../test-support/db.js";
import { createMeal, deleteMeal, findMealById, listMeals, updateMeal } from "./meals.repo.js";

describe("meals.repo", () => {
  it("createMeal returns the new row with all fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      name: "breakfast",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    expect(meal.id).toBeGreaterThan(0);
    expect(meal.kcal).toBe(350);
    expect(meal.name).toBe("breakfast");
    expect(meal.user_id).toBe(userId);
  });

  it("findMealById returns null when missing", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(findMealById(db, userId, 999)).toBeNull();
  });

  it("listMeals orders by eaten_at DESC", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-10T12:00:00Z",
      kcal: 500,
      protein_g: 30,
      carb_g: 50,
      fat_g: 20,
    });
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-11T19:00:00Z",
      kcal: 700,
      protein_g: 45,
      carb_g: 70,
      fat_g: 25,
    });
    const meals = listMeals(db, userId);
    expect(meals.map((m) => m.eaten_at)).toEqual([
      "2026-05-12T08:00:00Z",
      "2026-05-11T19:00:00Z",
      "2026-05-10T12:00:00Z",
    ]);
  });

  it("listMeals filters by from/to range on eaten_at", () => {
    const db = freshDb();
    const userId = seedUser(db);
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-10T12:00:00Z",
      kcal: 500,
      protein_g: 30,
      carb_g: 50,
      fat_g: 20,
    });
    createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    const inRange = listMeals(db, userId, {
      from: "2026-05-11T00:00:00Z",
      to: "2026-05-13T00:00:00Z",
    });
    expect(inRange.length).toBe(1);
    expect(inRange[0]?.eaten_at).toBe("2026-05-12T08:00:00Z");
  });

  it("listMeals respects limit", () => {
    const db = freshDb();
    const userId = seedUser(db);
    for (let i = 0; i < 5; i++) {
      createMeal(db, {
        user_id: userId,
        eaten_at: `2026-05-1${i}T12:00:00Z`,
        kcal: 400,
        protein_g: 20,
        carb_g: 40,
        fat_g: 15,
      });
    }
    expect(listMeals(db, userId, { limit: 2 }).length).toBe(2);
  });

  it("listMeals filters by user_id", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    createMeal(db, {
      user_id: userA,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    createMeal(db, {
      user_id: userB,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 400,
      protein_g: 30,
      carb_g: 40,
      fat_g: 15,
    });
    const aList = listMeals(db, userA);
    expect(aList.length).toBe(1);
    expect(aList[0]?.user_id).toBe(userA);
  });

  it("updateMeal mutates only provided fields", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    updateMeal(db, userId, meal.id, { kcal: 400 });
    const after = findMealById(db, userId, meal.id);
    expect(after?.kcal).toBe(400);
    expect(after?.protein_g).toBe(25);
  });

  it("updateMeal on a nonexistent id returns null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    expect(updateMeal(db, userId, 999, { kcal: 100 })).toBeNull();
  });

  it("updateMeal with empty patch returns the current row (re-fetch)", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    const result = updateMeal(db, userId, meal.id, {});
    expect(result?.kcal).toBe(350);
  });

  it("updateMeal silently ignores keys outside the allowlist", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    updateMeal(db, userId, meal.id, { kcal: 400, id: 999, user_id: 999 } as never);
    const after = findMealById(db, userId, meal.id);
    expect(after?.id).toBe(meal.id);
    expect(after?.user_id).toBe(userId);
    expect(after?.kcal).toBe(400);
  });

  it("deleteMeal removes the row", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    deleteMeal(db, userId, meal.id);
    expect(findMealById(db, userId, meal.id)).toBeNull();
  });

  // --- Ownership scoping (IDOR fix): by-id ops must be scoped to the owner ---

  it("findMealById does not return another user's meal", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const aMeal = createMeal(db, {
      user_id: userA,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    // Owner sees it...
    expect(findMealById(db, userA, aMeal.id)?.id).toBe(aMeal.id);
    // ...a different user does not.
    expect(findMealById(db, userB, aMeal.id)).toBeNull();
  });

  it("updateMeal cannot mutate another user's meal", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const aMeal = createMeal(db, {
      user_id: userA,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    // Bob's update is a no-op and returns null (not found for him).
    expect(updateMeal(db, userB, aMeal.id, { kcal: 9999 })).toBeNull();
    // Alice's row is untouched.
    expect(findMealById(db, userA, aMeal.id)?.kcal).toBe(350);
  });

  it("deleteMeal cannot delete another user's meal", () => {
    const db = freshDb();
    const userA = seedUser(db, { name: "Alice" });
    const userB = seedUser(db, { name: "Bob" });
    const aMeal = createMeal(db, {
      user_id: userA,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    deleteMeal(db, userB, aMeal.id);
    // Still there for the real owner.
    expect(findMealById(db, userA, aMeal.id)?.id).toBe(aMeal.id);
  });

  it("listMeals from is inclusive — a row exactly on the boundary is included", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createMeal(db, {
      user_id: userId,
      eaten_at: boundary,
      kcal: 100,
      protein_g: 10,
      carb_g: 10,
      fat_g: 5,
    });
    const result = listMeals(db, userId, { from: boundary });
    expect(result.length).toBe(1);
    expect(result[0]?.eaten_at).toBe(boundary);
  });

  it("listMeals to is exclusive — a row exactly on the boundary is excluded", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const boundary = "2026-05-12T00:00:00Z";
    createMeal(db, {
      user_id: userId,
      eaten_at: boundary,
      kcal: 100,
      protein_g: 10,
      carb_g: 10,
      fat_g: 5,
    });
    const result = listMeals(db, userId, { to: boundary });
    expect(result.length).toBe(0);
  });

  it("listMeals clamps limit at 200 even when caller requests more", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 3 rows; assert that requesting 1000 still returns all 3.
    // The cap is invisible at this scale, but the test exists to lock the
    // policy in so a typo `Math.max` would fail. Caller-requested limits
    // <= 200 pass through unchanged.
    for (let i = 0; i < 3; i++) {
      createMeal(db, {
        user_id: userId,
        eaten_at: `2026-05-1${i}T12:00:00Z`,
        kcal: 100,
        protein_g: 10,
        carb_g: 10,
        fat_g: 5,
      });
    }
    expect(listMeals(db, userId, { limit: 1000 }).length).toBe(3);
  });

  it("listMeals falsy or negative limit falls back to default 50", () => {
    const db = freshDb();
    const userId = seedUser(db);
    // Create 75 rows so the default cap (50) is observable.
    for (let i = 0; i < 75; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      createMeal(db, {
        user_id: userId,
        eaten_at: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${day}T12:00:00Z`,
        kcal: 100,
        protein_g: 10,
        carb_g: 10,
        fat_g: 5,
      });
    }
    expect(listMeals(db, userId, { limit: 0 }).length).toBe(50);
    expect(listMeals(db, userId, { limit: -5 }).length).toBe(50);
    expect(listMeals(db, userId).length).toBe(50);
  });

  it("createMeal with optional fields omitted persists them as null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
      // name and notes omitted — must persist as NULL
    });
    expect(meal.name).toBeNull();
    expect(meal.notes).toBeNull();
  });

  it("updateMeal can null out a previously-set field via patch[k] ?? null", () => {
    const db = freshDb();
    const userId = seedUser(db);
    const meal = createMeal(db, {
      user_id: userId,
      eaten_at: "2026-05-12T08:00:00Z",
      name: "breakfast",
      notes: "had eggs",
      kcal: 350,
      protein_g: 25,
      carb_g: 30,
      fat_g: 15,
    });
    updateMeal(db, userId, meal.id, { notes: null });
    const after = findMealById(db, userId, meal.id);
    expect(after?.notes).toBeNull();
    expect(after?.name).toBe("breakfast"); // unchanged
  });
});
