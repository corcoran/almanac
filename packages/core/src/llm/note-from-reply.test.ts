import { describe, expect, it, vi } from "vitest";
import { defined, nthCall } from "../test-support/index.js";
import { NOTE_TOOL, notesFromReply } from "./note-from-reply.js";
import type { CreateMessage } from "./run-agent.js";

const usage = { input_tokens: 100, output_tokens: 20 };
const stub = (input: unknown): CreateMessage =>
  vi.fn(async () => ({
    content: [{ type: "tool_use", id: "t1", name: "save_notes", input }],
    usage,
    stop_reason: "tool_use",
  }));
const run = (
  createMessage: CreateMessage,
  priorUserMessage: string | null = "why is my TDEE up?",
) =>
  notesFromReply({
    createMessage,
    model: "claude-haiku-4-5",
    reply: "Because...",
    priorUserMessage,
  });

describe("notesFromReply", () => {
  it("forces save_notes with no thinking and includes both messages", async () => {
    const cm = vi.fn(stub({ notes: [{ topic: "tdee-up", gist: "TDEE rose to 2727" }] }));
    await run(cm);
    const args = defined(nthCall(cm, 0)[0], "call");
    expect(args.model).toBe("claude-haiku-4-5");
    expect(args.max_tokens).toBe(400);
    expect(args.tool_choice).toEqual({ type: "tool", name: "save_notes" });
    expect(args.tools).toEqual([NOTE_TOOL]);
    expect(args.thinking).toBeUndefined();
    const content = String(defined(args.messages[0], "msg").content);
    expect(content).toContain("why is my TDEE up?");
    expect(content).toContain("Because...");
  });

  it("omits the user message when there is none", async () => {
    const cm = vi.fn(stub({ notes: [] }));
    await run(cm, null);
    const content = String(defined(nthCall(cm, 0)[0]?.messages[0], "msg").content);
    expect(content).not.toContain("User message");
  });

  it("parses a tool_use input and normalizes usage", async () => {
    const r = await run(stub({ notes: [{ topic: " tdee-up ", gist: "line one\nline two" }] }));
    expect(r.notes).toEqual([{ topic: "tdee-up", gist: "line one line two" }]);
    expect(r.usage).toMatchObject({ input_tokens: 100, output_tokens: 20 });
  });

  it("drops invalid and over-long notes", async () => {
    const r = await run(
      stub({
        notes: [
          { topic: "", gist: "x" },
          { topic: "t".repeat(61), gist: "x" },
          { topic: "ok", gist: "g".repeat(201) },
          { topic: "ok", gist: 5 },
          { topic: "good", gist: "fine" },
        ],
      }),
    );
    expect(r.notes).toEqual([{ topic: "good", gist: "fine" }]);
  });

  it("caps at two notes", async () => {
    const notes = [1, 2, 3].map((n) => ({ topic: `t${n}`, gist: "g" }));
    expect((await run(stub({ notes }))).notes.map((n) => n.topic)).toEqual(["t1", "t2"]);
  });

  it("returns no notes when the response has no tool_use", async () => {
    const cm: CreateMessage = async () => ({
      content: [{ type: "text", text: "sorry" }],
      usage,
      stop_reason: "end_turn",
    });
    expect((await run(cm)).notes).toEqual([]);
  });
});
