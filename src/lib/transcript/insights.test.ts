import { describe, expect, it } from "vitest";
import { detectInsights } from "./insights";
import type { SessionDetail, TimelineItem } from "./types";

const T0 = Date.parse("2026-08-17T10:00:00Z");
const ts = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

function tool(
  offsetSec: number,
  name: string,
  input: unknown,
  extra: Partial<Extract<TimelineItem, { kind: "tool" }>> = {},
): TimelineItem {
  return { kind: "tool", ts: ts(offsetSec), name, input, sidechain: false, ...extra };
}

function user(offsetSec: number, text: string): TimelineItem {
  return { kind: "user", ts: ts(offsetSec), text, sidechain: false };
}

function detail(items: TimelineItem[]): SessionDetail {
  const stamps = items.map((i) => i.ts).sort();
  return {
    id: "s",
    models: [],
    items,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0,
    startedAt: stamps[0],
    endedAt: stamps[stamps.length - 1],
    counts: { userMessages: 0, assistantTurns: 0, toolCalls: 0, sidechainItems: 0 },
  };
}

describe("detectInsights", () => {
  it("flags the same file read 4+ times", () => {
    const items = [0, 1, 2, 3].map((i) => tool(i, "Read", { file_path: "/a/b.ts" }));
    const insights = detectInsights(detail(items));
    const hit = insights.find((i) => i.title.includes("Re-read"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warn");
    expect(hit!.title).toContain("4×");
    expect(hit!.detail).toContain("/a/b.ts");
  });

  it("does not flag 3 reads of the same file", () => {
    const items = [0, 1, 2].map((i) => tool(i, "Read", { file_path: "/a/b.ts" }));
    expect(detectInsights(detail(items)).find((i) => i.title.includes("Re-read"))).toBeUndefined();
  });

  it("flags identical repeated tool calls and mentions retries when they errored", () => {
    const items = [0, 1, 2].map((i) =>
      tool(i, "Bash", { command: "npm test" }, { isError: true, result: "fail" }),
    );
    const insights = detectInsights(detail(items));
    const hit = insights.find((i) => i.title.includes("identical"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warn");
    expect(hit!.title).toContain("Bash");
    expect(hit!.detail.toLowerCase()).toContain("retry");
  });

  it("flags an error cluster naming the most common failing tool", () => {
    const items = [
      tool(0, "Bash", { command: "a" }, { isError: true }),
      tool(1, "Bash", { command: "b" }, { isError: true }),
      tool(2, "Read", { file_path: "/x" }, { isError: true }),
    ];
    const hit = detectInsights(detail(items)).find((i) => i.title.includes("failed"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("info");
    expect(hit!.title).toContain("3");
    expect(hit!.detail).toContain("Bash");
  });

  it("flags the longest tool call over 60s", () => {
    const items = [
      tool(0, "Bash", { command: "sleep" }, { durationMs: 95_000 }),
      tool(200, "Bash", { command: "quick" }, { durationMs: 300 }),
    ];
    const hit = detectInsights(detail(items)).find((i) => i.title.includes("ran for"));
    expect(hit).toBeDefined();
    expect(hit!.title).toContain("Bash");
    expect(hit!.title).toContain("1m 35s");
  });

  it("flags sessions that are mostly idle", () => {
    // two bursts separated by a 2h gap; wall clock ≈ 2h, active ≈ nothing
    const items = [user(0, "start"), user(7200, "and back")];
    const hit = detectInsights(detail(items)).find((i) => i.title.includes("waiting"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("info");
  });

  it("orders warns before infos", () => {
    const items = [
      ...[0, 1, 2, 3].map((i) => tool(i, "Read", { file_path: "/a" })),
      tool(10, "Bash", { command: "x" }, { durationMs: 70_000 }),
    ];
    const severities = detectInsights(detail(items)).map((i) => i.severity);
    expect(severities).toEqual([...severities].sort((a, b) => (a === b ? 0 : a === "warn" ? -1 : 1)));
  });

  it("returns empty for a clean session", () => {
    const items = [user(0, "hi"), tool(1, "Read", { file_path: "/a" }, { durationMs: 100 })];
    expect(detectInsights(detail(items))).toEqual([]);
  });
});
