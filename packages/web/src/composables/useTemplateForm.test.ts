import { describe, expect, it } from "vitest";
import { type AddableExercise, useTemplateForm } from "./useTemplateForm.js";

const ex = (id: number, name: string, group_id = 1, groupName = "Chest"): AddableExercise => ({
  exercise_id: id,
  name,
  group_id,
  groupName,
});

describe("useTemplateForm", () => {
  it("addRow appends a row with defaults (1 set, blank reps/weight)", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "Bench"));
    expect(f.rows.value).toHaveLength(1);
    const row = f.rows.value[0];
    if (!row) throw new Error("row missing");
    expect(row.exercise_id).toBe(10);
    expect(row.exerciseName).toBe("Bench");
    expect(row.default_sets).toBe(1);
    expect(row.default_reps).toBeNull();
    expect(row.default_weight).toBeNull();
  });

  it("removeRow drops by key", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "Bench"));
    f.addRow(ex(11, "OHP"));
    const firstKey = f.rows.value[0]?.key;
    if (!firstKey) throw new Error("key missing");
    f.removeRow(firstKey);
    expect(f.rows.value.map((r) => r.exercise_id)).toEqual([11]);
  });

  it("moveUp / moveDown reorder rows", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "A"));
    f.addRow(ex(11, "B"));
    f.addRow(ex(12, "C"));
    const cKey = f.rows.value[2]?.key;
    if (!cKey) throw new Error("key missing");
    f.moveUp(cKey);
    expect(f.rows.value.map((r) => r.exercise_id)).toEqual([10, 12, 11]);
    const aKey = f.rows.value[0]?.key;
    if (!aKey) throw new Error("key missing");
    f.moveDown(aKey);
    expect(f.rows.value.map((r) => r.exercise_id)).toEqual([12, 10, 11]);
  });

  it("moveUp on the first row and moveDown on the last are no-ops", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "A"));
    f.addRow(ex(11, "B"));
    const firstKey = f.rows.value[0]?.key;
    const lastKey = f.rows.value[1]?.key;
    if (!firstKey || !lastKey) throw new Error("key missing");
    f.moveUp(firstKey);
    f.moveDown(lastKey);
    expect(f.rows.value.map((r) => r.exercise_id)).toEqual([10, 11]);
  });

  it("buildPayload sets display_order by array index and passes through metric weight", () => {
    const f = useTemplateForm("metric");
    f.name.value = "Push";
    f.addRow(ex(10, "Bench"));
    f.addRow(ex(11, "OHP"));
    const r0 = f.rows.value[0];
    const r1 = f.rows.value[1];
    if (!r0 || !r1) throw new Error("rows missing");
    r0.default_sets = 3;
    r0.default_reps = 5;
    r0.default_weight = 60;
    r1.default_sets = 3;
    r1.default_reps = 8;
    const payload = f.buildPayload();
    expect(payload.name).toBe("Push");
    expect(payload.items).toEqual([
      {
        exercise_id: 10,
        display_order: 0,
        default_sets: 3,
        default_reps: 5,
        default_weight_kg: 60,
      },
      {
        exercise_id: 11,
        display_order: 1,
        default_sets: 3,
        default_reps: 8,
        default_weight_kg: null,
      },
    ]);
  });

  it("buildPayload converts imperial display weight back to kg", () => {
    const f = useTemplateForm("imperial");
    f.addRow(ex(10, "Bench"));
    const r0 = f.rows.value[0];
    if (!r0) throw new Error("row missing");
    r0.default_sets = 3;
    r0.default_weight = 135; // lb
    const item = f.buildPayload().items[0];
    if (!item) throw new Error("item missing");
    // 135 / 2.20462262 ≈ 61.235 kg
    expect(item.default_weight_kg).toBeCloseTo(61.235, 2);
  });

  it("setFromTemplate prefills rows from a template response (kg -> display)", () => {
    const f = useTemplateForm("imperial");
    f.setFromTemplate(
      {
        name: "Push",
        items: [
          {
            exercise_id: 10,
            display_order: 0,
            default_sets: 3,
            default_reps: 5,
            default_weight_kg: 61.235,
          },
        ],
      },
      (id) => (id === 10 ? { name: "Bench", groupName: "Chest" } : null),
    );
    expect(f.name.value).toBe("Push");
    const row = f.rows.value[0];
    if (!row) throw new Error("row missing");
    expect(row.exerciseName).toBe("Bench");
    expect(row.default_weight).toBe(135); // 61.235 kg -> 135 lb (round1)
  });

  it("hasEmptyPrescription flips when any row has 0 sets", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "Bench"));
    const row = f.rows.value[0];
    if (!row) throw new Error("row missing");
    row.default_sets = 3;
    expect(f.hasEmptyPrescription.value).toBe(false);
    row.default_sets = 0;
    expect(f.hasEmptyPrescription.value).toBe(true);
  });

  it("buildPayload coerces a cleared metric weight ('') to null", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "Bench"));
    const r0 = f.rows.value[0];
    if (!r0) throw new Error("row missing");
    r0.default_sets = 3;
    // v-model.number leaves the raw "" when the field is cleared
    (r0 as { default_weight: unknown }).default_weight = "";
    const item = f.buildPayload().items[0];
    if (!item) throw new Error("item missing");
    expect(item.default_weight_kg).toBeNull();
  });

  it("buildPayload coerces a cleared imperial weight ('') to null (not NaN)", () => {
    const f = useTemplateForm("imperial");
    f.addRow(ex(10, "Bench"));
    const r0 = f.rows.value[0];
    if (!r0) throw new Error("row missing");
    r0.default_sets = 3;
    (r0 as { default_weight: unknown }).default_weight = "";
    const item = f.buildPayload().items[0];
    if (!item) throw new Error("item missing");
    expect(item.default_weight_kg).toBeNull();
    expect(Number.isNaN(item.default_weight_kg)).toBe(false);
  });

  it("buildPayload coerces a cleared reps ('') to null and cleared sets ('') to 0", () => {
    const f = useTemplateForm("metric");
    f.addRow(ex(10, "Bench"));
    const r0 = f.rows.value[0];
    if (!r0) throw new Error("row missing");
    (r0 as { default_reps: unknown }).default_reps = "";
    (r0 as { default_sets: unknown }).default_sets = "";
    const item = f.buildPayload().items[0];
    if (!item) throw new Error("item missing");
    expect(item.default_reps).toBeNull();
    expect(item.default_sets).toBe(0);
    expect(f.hasEmptyPrescription.value).toBe(true);
  });
});
