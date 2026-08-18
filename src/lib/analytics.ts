import type { SessionSummary } from "./discover";

export interface ProjectSpend {
  project: string;
  costUsd: number;
  sessions: number;
  toolCalls: number;
}

export function spendByProject(sessions: SessionSummary[]): ProjectSpend[] {
  const byProject = new Map<string, ProjectSpend>();
  for (const s of sessions) {
    const row = byProject.get(s.project) ?? { project: s.project, costUsd: 0, sessions: 0, toolCalls: 0 };
    row.costUsd += s.costUsd ?? 0;
    row.sessions += 1;
    row.toolCalls += s.toolCalls;
    byProject.set(s.project, row);
  }
  return [...byProject.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export interface DaySpend {
  day: string; // YYYY-MM-DD, local time
  costUsd: number;
}

function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function spendByDay(sessions: SessionSummary[], days: number): DaySpend[] {
  const byDay = new Map<string, number>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    byDay.set(localDay(new Date(now.getTime() - i * 86400_000)), 0);
  }
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const day = localDay(new Date(s.endedAt));
    if (byDay.has(day)) byDay.set(day, byDay.get(day)! + (s.costUsd ?? 0));
  }
  return [...byDay.entries()].map(([day, costUsd]) => ({ day, costUsd }));
}

export function totals(sessions: SessionSummary[]): {
  costUsd: number;
  sessions: number;
  toolCalls: number;
  outputTokens: number;
} {
  return sessions.reduce(
    (acc, s) => ({
      costUsd: acc.costUsd + (s.costUsd ?? 0),
      sessions: acc.sessions + 1,
      toolCalls: acc.toolCalls + s.toolCalls,
      outputTokens: acc.outputTokens + s.outputTokens,
    }),
    { costUsd: 0, sessions: 0, toolCalls: 0, outputTokens: 0 },
  );
}
