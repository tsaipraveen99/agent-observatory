import { fmtDuration } from "../fmt";
import type { SessionDetail, TimelineItem } from "./types";

export interface Insight {
  severity: "warn" | "info";
  title: string;
  detail: string;
}

type Tool = Extract<TimelineItem, { kind: "tool" }>;

const IDLE_GAP_MS = 5 * 60_000;

function tools(detail: SessionDetail): Tool[] {
  return detail.items.filter((i): i is Tool => i.kind === "tool");
}

function repeatedReads(detail: SessionDetail): Insight[] {
  const counts = new Map<string, number>();
  for (const t of tools(detail)) {
    if (t.name.toLowerCase() !== "read") continue;
    const path = (t.input as { file_path?: string } | undefined)?.file_path;
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const worst = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!worst || worst[1] < 4) return [];
  return [
    {
      severity: "warn",
      title: `Re-read the same file ${worst[1]}×`,
      detail: `${worst[0]} — repeated reads usually mean lost context between steps`,
    },
  ];
}

function repeatedCalls(detail: SessionDetail): Insight[] {
  const groups = new Map<string, Tool[]>();
  for (const t of tools(detail)) {
    const key = `${t.name}:${JSON.stringify(t.input ?? null)}`;
    const group = groups.get(key) ?? [];
    group.push(t);
    groups.set(key, group);
  }
  const worst = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!worst || worst.length < 3) return [];
  const errored = worst.some((t) => t.isError);
  return [
    {
      severity: "warn",
      title: `Repeated an identical ${worst[0].name} call ${worst.length}×`,
      detail: errored
        ? "Some attempts failed — this looks like a retry loop burning tokens"
        : "Same input every time — the result could have been reused",
    },
  ];
}

function errorCluster(detail: SessionDetail): Insight[] {
  const failed = tools(detail).filter((t) => t.isError);
  if (failed.length < 3) return [];
  const byName = new Map<string, number>();
  for (const t of failed) byName.set(t.name, (byName.get(t.name) ?? 0) + 1);
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1])[0];
  return [
    {
      severity: "info",
      title: `${failed.length} tool calls failed`,
      detail: `Most failures came from ${top[0]}`,
    },
  ];
}

function longTool(detail: SessionDetail): Insight[] {
  const timed = tools(detail).filter((t) => (t.durationMs ?? 0) >= 60_000);
  if (timed.length === 0) return [];
  const longest = timed.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))[0];
  return [
    {
      severity: "info",
      title: `${longest.name} ran for ${fmtDuration(longest.durationMs!)}`,
      detail: "The longest single tool call in this session",
    },
  ];
}

function idleShare(detail: SessionDetail): Insight[] {
  if (!detail.startedAt || !detail.endedAt) return [];
  const wall = Date.parse(detail.endedAt) - Date.parse(detail.startedAt);
  if (wall <= 0) return [];
  let idle = 0;
  let prev: number | null = null;
  for (const item of detail.items) {
    const t = Date.parse(item.ts);
    if (Number.isNaN(t)) continue;
    if (prev !== null && t - prev > IDLE_GAP_MS) idle += t - prev;
    prev = t;
  }
  if (idle / wall < 0.5) return [];
  return [
    {
      severity: "info",
      title: `Mostly waiting: ${fmtDuration(idle)} of ${fmtDuration(wall)} idle`,
      detail: "Long gaps between activity — wall clock overstates working time",
    },
  ];
}

export function detectInsights(detail: SessionDetail): Insight[] {
  const all = [
    ...repeatedReads(detail),
    ...repeatedCalls(detail),
    ...errorCluster(detail),
    ...longTool(detail),
    ...idleShare(detail),
  ];
  return all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}
