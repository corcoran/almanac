import { describe, expect, it } from "vitest";
import { useInlineEdit } from "./useInlineEdit.js";

describe("useInlineEdit", () => {
  it("starts not editing, not pending, no error", () => {
    const e = useInlineEdit();
    expect(e.isEditing.value).toBe(false);
    expect(e.pending.value).toBe(false);
    expect(e.error.value).toBeNull();
  });

  it("startEdit flips isEditing and clears any error", () => {
    const e = useInlineEdit();
    e.error.value = "stale";
    e.startEdit();
    expect(e.isEditing.value).toBe(true);
    expect(e.error.value).toBeNull();
  });

  it("cancel exits edit mode and clears error", () => {
    const e = useInlineEdit();
    e.startEdit();
    e.error.value = "x";
    e.cancel();
    expect(e.isEditing.value).toBe(false);
    expect(e.error.value).toBeNull();
  });

  it("save with a resolving fn exits edit mode and toggles pending", async () => {
    const e = useInlineEdit();
    e.startEdit();
    let seenPending = false;
    const p = e.save(async () => {
      seenPending = e.pending.value;
    });
    expect(e.pending.value).toBe(true);
    await p;
    expect(seenPending).toBe(true);
    expect(e.pending.value).toBe(false);
    expect(e.isEditing.value).toBe(false);
    expect(e.error.value).toBeNull();
  });

  it("save with a rejecting fn sets error and stays in edit mode", async () => {
    const e = useInlineEdit();
    e.startEdit();
    await e.save(async () => {
      throw new Error("boom");
    });
    expect(e.error.value).toBe("boom");
    expect(e.isEditing.value).toBe(true);
    expect(e.pending.value).toBe(false);
  });

  it("save is a no-op while pending (guards double-submit)", async () => {
    const e = useInlineEdit();
    e.startEdit();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = e.save(async () => {
      calls++;
      await gate;
    });
    await e.save(async () => {
      calls++;
    });
    expect(calls).toBe(1);
    release();
    await first;
    expect(calls).toBe(1);
  });

  it("uses a generic message when the thrown error has no message", async () => {
    const e = useInlineEdit();
    e.startEdit();
    await e.save(async () => {
      throw "string failure";
    });
    expect(e.error.value).toBe("Something went wrong. Please try again.");
    expect(e.isEditing.value).toBe(true);
  });
});
