import { normalizePoint } from "./insights.js";
import { type AgentUsage, type CreateMessage, normalizeUsage } from "./run-agent.js";

const MAX_NOTES = 2;

export const NOTE_TOOL = {
  name: "save_notes",
  description: "Save 1 or 2 short notes capturing the reusable points in the coach reply.",
  input_schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          properties: { topic: { type: "string" }, gist: { type: "string" } },
          required: ["topic", "gist"],
        },
      },
    },
    required: ["notes"],
  },
};

const SYSTEM =
  "You write private notes for a fitness coach about what it already told this user, so it won't repeat itself. " +
  "Each note: topic = short kebab-case key (max 60 chars); gist = one line (max 200 chars) stating the specific point and the user's figures. " +
  "Capture what the user is likely to have found valuable.";

/**
 * One forced-tool call that distills a coach reply into at most two notes.
 * Forced tool_choice is rejected by the insights model, so callers pass the
 * cheap model and no thinking.
 */
export async function notesFromReply(args: {
  createMessage: CreateMessage;
  model: string;
  reply: string;
  priorUserMessage: string | null;
}): Promise<{ notes: Array<{ topic: string; gist: string }>; usage: AgentUsage }> {
  const parts = [
    ...(args.priorUserMessage === null ? [] : [`User message:\n${args.priorUserMessage}`]),
    `Coach reply:\n${args.reply}`,
  ];
  const resp = await args.createMessage({
    model: args.model,
    max_tokens: 400,
    system: [{ type: "text", text: SYSTEM }],
    tools: [NOTE_TOOL],
    tool_choice: { type: "tool", name: NOTE_TOOL.name },
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  const block = resp.content.find((b) => b.type === "tool_use" && b.name === NOTE_TOOL.name);
  const raw = (block?.input as { notes?: unknown } | undefined)?.notes;
  const notes = (Array.isArray(raw) ? raw : [])
    .map((n) => {
      const o = (n ?? {}) as { topic?: unknown; gist?: unknown };
      return normalizePoint(o.topic, o.gist);
    })
    .filter((n): n is { topic: string; gist: string } => n !== null)
    .slice(0, MAX_NOTES);
  return { notes, usage: normalizeUsage(resp.usage) };
}
