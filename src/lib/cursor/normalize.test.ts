import { describe, expect, it } from "vitest";
import { normalizeCursorConversation, type CursorHeader } from "./normalize";

const header: CursorHeader = {
  composer_id: "abc-123",
  workspace_folder: "file:///Users/me/Projects/myapp",
  created_at: Date.parse("2026-08-17T10:00:00Z"),
  last_updated_at: Date.parse("2026-08-17T11:00:00Z"),
  is_subagent: false,
};

const composerData = JSON.stringify({
  name: "Fix the login bug",
  fullConversationHeadersOnly: [{ bubbleId: "b1" }, { bubbleId: "b2" }, { bubbleId: "b3" }],
});

const bubbles = [
  // stored out of order on purpose — ordering must come from the headers list
  JSON.stringify({
    bubbleId: "b3",
    type: 2,
    createdAt: Date.parse("2026-08-17T10:02:00Z"),
    toolFormerData: {
      name: "read_file_v2",
      status: "error",
      rawArgs: '{"path":"/gone.ts"}',
      result: "{}",
      error: '{"clientVisibleErrorMessage":"Path does not exist"}',
    },
    tokenCount: { inputTokens: 5, outputTokens: 7 },
  }),
  JSON.stringify({
    bubbleId: "b1",
    type: 1,
    createdAt: Date.parse("2026-08-17T10:00:30Z"),
    text: "please fix login",
  }),
  JSON.stringify({
    bubbleId: "b2",
    type: 2,
    createdAt: Date.parse("2026-08-17T10:01:00Z"),
    text: "Looking at the auth flow now.",
    tokenCount: { inputTokens: 100, outputTokens: 40 },
  }),
];

describe("normalizeCursorConversation", () => {
  it("orders items by the conversation header list, not storage order", () => {
    const d = normalizeCursorConversation(header, composerData, bubbles);
    expect(d.items.map((i) => i.kind)).toEqual(["user", "assistant_text", "tool"]);
  });

  it("maps fields: title, timestamps, tool error, usage sum, unpriced cost", () => {
    const d = normalizeCursorConversation(header, composerData, bubbles);
    expect(d.title).toBe("Fix the login bug");
    expect(d.items[0]).toMatchObject({ text: "please fix login", ts: "2026-08-17T10:00:30.000Z" });
    const tool = d.items[2];
    expect(tool).toMatchObject({ kind: "tool", name: "read_file_v2", isError: true });
    expect((tool as { input: unknown }).input).toEqual({ path: "/gone.ts" });
    expect(d.usage.inputTokens).toBe(105);
    expect(d.usage.outputTokens).toBe(47);
    expect(d.costUsd).toBeNull();
    expect(d.startedAt).toBe("2026-08-17T10:00:30.000Z");
    expect(d.endedAt).toBe("2026-08-17T10:02:00.000Z");
  });

  it("survives missing composerData and malformed bubbles", () => {
    const d = normalizeCursorConversation(header, null, ["{not json", bubbles[1]]);
    expect(d.items).toHaveLength(1);
    expect(d.title).toBeUndefined();
    // falls back to header timestamps for the span
    expect(d.startedAt).toBe("2026-08-17T10:00:30.000Z");
  });

  it("skips empty assistant bubbles and counts correctly", () => {
    const empty = JSON.stringify({ bubbleId: "b4", type: 2 });
    const d = normalizeCursorConversation(header, null, [...bubbles, empty]);
    expect(d.counts.userMessages).toBe(1);
    expect(d.counts.toolCalls).toBe(1);
  });
});
