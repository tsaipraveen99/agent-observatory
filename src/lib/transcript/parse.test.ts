import { describe, expect, it } from "vitest";
import { parseTranscript } from "./parse";

const line = (obj: unknown) => JSON.stringify(obj);

function fixture(lines: unknown[]): string {
  return lines.map(line).join("\n") + "\n";
}

const base = {
  sessionId: "sess-1",
  cwd: "/Users/me/proj",
  gitBranch: "main",
  version: "2.1.0",
  isSidechain: false,
};

describe("parseTranscript", () => {
  it("parses user and assistant turns in order with metadata", () => {
    const detail = parseTranscript(
      fixture([
        { ...base, type: "user", uuid: "u1", timestamp: "2026-08-17T10:00:00Z", message: { role: "user", content: "hello" } },
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "req1",
          timestamp: "2026-08-17T10:00:05Z",
          message: {
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "text", text: "hi there" }],
            usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        },
      ]),
      "sess-1",
    );
    expect(detail.items.map((i) => i.kind)).toEqual(["user", "assistant_text"]);
    expect(detail.items[0]).toMatchObject({ text: "hello", ts: "2026-08-17T10:00:00Z" });
    expect(detail.items[1]).toMatchObject({ text: "hi there", model: "claude-haiku-4-5-20251001" });
    expect(detail.cwd).toBe("/Users/me/proj");
    expect(detail.gitBranch).toBe("main");
    expect(detail.startedAt).toBe("2026-08-17T10:00:00Z");
    expect(detail.endedAt).toBe("2026-08-17T10:00:05Z");
    expect(detail.counts.userMessages).toBe(1);
    expect(detail.counts.assistantTurns).toBe(1);
  });

  it("extracts the session title from ai-title lines", () => {
    const detail = parseTranscript(
      fixture([
        { type: "ai-title", sessionId: "sess-1", aiTitle: "Fixing the deploy bug" },
        { ...base, type: "user", uuid: "u1", timestamp: "2026-08-17T10:00:00Z", message: { role: "user", content: "hi" } },
      ]),
      "sess-1",
    );
    expect(detail.title).toBe("Fixing the deploy bug");
  });

  it("pairs tool_use with its tool_result and computes duration", () => {
    const detail = parseTranscript(
      fixture([
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "req1",
          timestamp: "2026-08-17T10:00:00Z",
          message: {
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }],
            usage: { input_tokens: 5, output_tokens: 5 },
          },
        },
        {
          ...base,
          type: "user",
          uuid: "u2",
          timestamp: "2026-08-17T10:00:03Z",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file-a\nfile-b" }],
          },
        },
      ]),
      "sess-1",
    );
    const tool = detail.items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ name: "Bash", result: "file-a\nfile-b", durationMs: 3000 });
    expect(detail.counts.toolCalls).toBe(1);
    // tool_result-only user lines are not user messages
    expect(detail.counts.userMessages).toBe(0);
  });

  it("extracts text from block-array tool results and flags errors", () => {
    const detail = parseTranscript(
      fixture([
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "r1",
          timestamp: "2026-08-17T10:00:00Z",
          message: {
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        {
          ...base,
          type: "user",
          uuid: "u2",
          timestamp: "2026-08-17T10:00:01Z",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "no such file" }] },
            ],
          },
        },
      ]),
      "sess-1",
    );
    const tool = detail.items.find((i) => i.kind === "tool");
    expect(tool).toMatchObject({ result: "no such file", isError: true });
  });

  it("dedupes usage across streamed lines sharing a requestId", () => {
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    const mk = (uuid: string, text: string) => ({
      ...base,
      type: "assistant",
      uuid,
      requestId: "req-shared",
      timestamp: "2026-08-17T10:00:00Z",
      message: { role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text }], usage },
    });
    const detail = parseTranscript(fixture([mk("a1", "part one"), mk("a2", "part two")]), "sess-1");
    expect(detail.usage.inputTokens).toBe(100);
    expect(detail.usage.outputTokens).toBe(50);
    expect(detail.usage.cacheReadTokens).toBe(1000);
    expect(detail.usage.cacheWriteTokens).toBe(200);
    // both text items still appear
    expect(detail.items.filter((i) => i.kind === "assistant_text")).toHaveLength(2);
  });

  it("estimates cost from the pricing table (haiku: $1/$5 per MTok)", () => {
    const detail = parseTranscript(
      fixture([
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "r1",
          timestamp: "2026-08-17T10:00:00Z",
          message: {
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "text", text: "x" }],
            usage: {
              input_tokens: 1_000_000,
              output_tokens: 1_000_000,
              cache_read_input_tokens: 1_000_000,
              cache_creation_input_tokens: 1_000_000,
            },
          },
        },
      ]),
      "sess-1",
    );
    // 1*1 + 1*5 + 1*0.1 + 1*1.25
    expect(detail.costUsd).toBeCloseTo(7.35, 2);
    expect(detail.models).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("returns null cost when a model is unpriced", () => {
    const detail = parseTranscript(
      fixture([
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "r1",
          timestamp: "2026-08-17T10:00:00Z",
          message: {
            role: "assistant",
            model: "mystery-model-9",
            content: [{ type: "text", text: "x" }],
            usage: { input_tokens: 10, output_tokens: 10 },
          },
        },
      ]),
      "sess-1",
    );
    expect(detail.costUsd).toBeNull();
  });

  it("skips noise lines, meta user lines, and malformed JSON without crashing", () => {
    const detail = parseTranscript(
      [
        line({ type: "mode", sessionId: "sess-1" }),
        line({ type: "attachment", sessionId: "sess-1" }),
        line({ type: "file-history-snapshot" }),
        "{this is not json",
        line({ ...base, type: "user", uuid: "u0", isMeta: true, timestamp: "2026-08-17T09:59:59Z", message: { role: "user", content: "meta context" } }),
        line({ ...base, type: "user", uuid: "u1", timestamp: "2026-08-17T10:00:00Z", message: { role: "user", content: "real question" } }),
      ].join("\n"),
      "sess-1",
    );
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ kind: "user", text: "real question" });
  });

  it("flags sidechain items and counts them", () => {
    const detail = parseTranscript(
      fixture([
        { ...base, type: "user", uuid: "u1", timestamp: "2026-08-17T10:00:00Z", message: { role: "user", content: "main" } },
        {
          ...base,
          isSidechain: true,
          type: "assistant",
          uuid: "a1",
          requestId: "r1",
          timestamp: "2026-08-17T10:00:01Z",
          message: { role: "assistant", model: "claude-haiku-4-5-20251001", content: [{ type: "text", text: "subagent work" }], usage: { input_tokens: 1, output_tokens: 1 } },
        },
      ]),
      "sess-1",
    );
    expect(detail.counts.sidechainItems).toBe(1);
    const side = detail.items.find((i) => i.sidechain);
    expect(side).toMatchObject({ kind: "assistant_text", text: "subagent work" });
  });

  it("captures thinking blocks as summaries", () => {
    const detail = parseTranscript(
      fixture([
        {
          ...base,
          type: "assistant",
          uuid: "a1",
          requestId: "r1",
          timestamp: "2026-08-17T10:00:00Z",
          message: {
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [
              { type: "thinking", thinking: "let me reason about this" },
              { type: "text", text: "answer" },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ]),
      "sess-1",
    );
    expect(detail.items.map((i) => i.kind)).toEqual(["thinking", "assistant_text"]);
  });
});
