import { describe, expect, it } from "vitest";
import { spendByDay, spendByProject, totals } from "./analytics";
import type { SessionSummary } from "./discover";

function summary(partial: Partial<SessionSummary>): SessionSummary {
  return {
    id: "s",
    path: "p",
    project: "proj",
    costUsd: 0,
    models: [],
    userMessages: 0,
    toolCalls: 0,
    outputTokens: 0,
    activity: [],
    ...partial,
  };
}

describe("spendByProject", () => {
  it("sums per project and sorts by cost descending", () => {
    const rows = spendByProject([
      summary({ project: "a", costUsd: 1, toolCalls: 5 }),
      summary({ project: "b", costUsd: 10, toolCalls: 2 }),
      summary({ project: "a", costUsd: 2, toolCalls: 1 }),
    ]);
    expect(rows.map((r) => r.project)).toEqual(["b", "a"]);
    expect(rows[1]).toMatchObject({ costUsd: 3, sessions: 2, toolCalls: 6 });
  });

  it("counts unpriced sessions with zero cost but keeps their tallies", () => {
    const rows = spendByProject([summary({ project: "a", costUsd: null, toolCalls: 7 })]);
    expect(rows[0]).toMatchObject({ costUsd: 0, sessions: 1, toolCalls: 7 });
  });
});

describe("spendByDay", () => {
  it("zero-fills the requested window, oldest first", () => {
    const today = new Date();
    const iso = today.toISOString();
    const rows = spendByDay([summary({ costUsd: 5, endedAt: iso })], 3);
    expect(rows).toHaveLength(3);
    expect(rows[2].costUsd).toBe(5);
    expect(rows[0].costUsd).toBe(0);
    expect(rows[2].day > rows[0].day).toBe(true);
  });

  it("ignores sessions outside the window and without endedAt", () => {
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows = spendByDay([summary({ costUsd: 5, endedAt: old }), summary({ costUsd: 3 })], 7);
    expect(rows.every((r) => r.costUsd === 0)).toBe(true);
  });
});

describe("totals", () => {
  it("sums across sessions treating null cost as zero", () => {
    const t = totals([
      summary({ costUsd: 2, toolCalls: 3, outputTokens: 100 }),
      summary({ costUsd: null, toolCalls: 4, outputTokens: 50 }),
    ]);
    expect(t).toEqual({ costUsd: 2, sessions: 2, toolCalls: 7, outputTokens: 150 });
  });
});
