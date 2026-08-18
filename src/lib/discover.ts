import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, readDir, readTextFile, stat, watch } from "@tauri-apps/plugin-fs";
import { normalizeCursorConversation, workspaceProject, type CursorHeader } from "./cursor/normalize";
import { parseTranscript } from "./transcript/parse";
import type { SessionDetail } from "./transcript/types";

const ROOT = ".claude/projects";
const CACHE_PREFIX = "ao:v1:";

export interface SessionSummary {
  id: string;
  path: string; // relative to $HOME for Claude Code; "cursor:<composerId>" for Cursor
  source: "claude" | "cursor";
  project: string;
  title?: string;
  startedAt?: string;
  endedAt?: string;
  costUsd: number | null;
  models: string[];
  userMessages: number;
  toolCalls: number;
  outputTokens: number;
  /** 16-bucket tool/assistant activity density across the session's wall-clock span. */
  activity: number[];
}

function projectLabel(dirName: string): string {
  const parts = dirName.split("-").filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

function activityBuckets(detail: SessionDetail): number[] {
  const buckets = new Array<number>(16).fill(0);
  if (!detail.startedAt || !detail.endedAt) return buckets;
  const start = Date.parse(detail.startedAt);
  const span = Math.max(1, Date.parse(detail.endedAt) - start);
  for (const item of detail.items) {
    if (item.kind !== "tool" && item.kind !== "assistant_text") continue;
    const t = Date.parse(item.ts);
    if (Number.isNaN(t)) continue;
    const idx = Math.min(15, Math.floor(((t - start) / span) * 16));
    buckets[idx]++;
  }
  const max = Math.max(1, ...buckets);
  return buckets.map((b) => b / max);
}

function cachePut(pathKey: string, cacheKey: string, summary: SessionSummary): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${CACHE_PREFIX}${pathKey}:`)) localStorage.removeItem(key);
    }
    localStorage.setItem(cacheKey, JSON.stringify(summary));
  } catch {
    // cache full — fine, we just re-parse next launch
  }
}

function toSummary(
  detail: SessionDetail,
  path: string,
  project: string,
  source: SessionSummary["source"],
): SessionSummary {
  return {
    id: detail.id,
    path,
    source,
    project,
    title: detail.title,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    costUsd: detail.costUsd,
    models: detail.models,
    userMessages: detail.counts.userMessages,
    toolCalls: detail.counts.toolCalls,
    outputTokens: detail.usage.outputTokens,
    activity: activityBuckets(detail),
  };
}

interface CursorConversation {
  composer_data: string | null;
  bubbles: string[];
}

async function cursorHeaderFor(composerId: string): Promise<CursorHeader> {
  const headers = await invoke<CursorHeader[]>("cursor_headers");
  return (
    headers.find((h) => h.composer_id === composerId) ?? {
      composer_id: composerId,
      workspace_folder: null,
      created_at: null,
      last_updated_at: null,
      is_subagent: false,
    }
  );
}

export async function loadSessionDetail(relPath: string): Promise<SessionDetail> {
  if (relPath.startsWith("cursor:")) {
    const composerId = relPath.slice("cursor:".length);
    const [header, conv] = await Promise.all([
      cursorHeaderFor(composerId),
      invoke<CursorConversation>("cursor_conversation", { composerId }),
    ]);
    return normalizeCursorConversation(header, conv.composer_data, conv.bubbles);
  }
  const text = await readTextFile(relPath, { baseDir: BaseDirectory.Home });
  const id = relPath.split("/").pop()?.replace(".jsonl", "") ?? relPath;
  return parseTranscript(text, id);
}

async function loadCursorIndex(): Promise<SessionSummary[]> {
  let headers: CursorHeader[];
  try {
    headers = await invoke<CursorHeader[]>("cursor_headers");
  } catch {
    return []; // Cursor not installed — not an error
  }
  const summaries: SessionSummary[] = [];
  for (const h of headers.filter((h) => !h.is_subagent)) {
    const pathKey = `cursor:${h.composer_id}`;
    const cacheKey = `${CACHE_PREFIX}${pathKey}:${h.last_updated_at ?? 0}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      summaries.push(JSON.parse(cached) as SessionSummary);
      continue;
    }
    try {
      const conv = await invoke<CursorConversation>("cursor_conversation", {
        composerId: h.composer_id,
      });
      const detail = normalizeCursorConversation(h, conv.composer_data, conv.bubbles);
      if (detail.items.length === 0) continue;
      const summary = toSummary(detail, pathKey, workspaceProject(h.workspace_folder), "cursor");
      cachePut(pathKey, cacheKey, summary);
      summaries.push(summary);
    } catch {
      // one unreadable conversation shouldn't hide the rest
    }
  }
  return summaries;
}

export async function loadIndex(onProgress?: (done: number, total: number) => void): Promise<SessionSummary[]> {
  const [claude, cursor] = await Promise.all([loadClaudeIndex(onProgress), loadCursorIndex()]);
  const merged = [...claude, ...cursor];
  merged.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  return merged;
}

async function loadClaudeIndex(onProgress?: (done: number, total: number) => void): Promise<SessionSummary[]> {
  const projectDirs = await readDir(ROOT, { baseDir: BaseDirectory.Home });
  const files: Array<{ path: string; project: string }> = [];
  for (const dir of projectDirs) {
    if (!dir.isDirectory) continue;
    const dirPath = `${ROOT}/${dir.name}`;
    let entries;
    try {
      entries = await readDir(dirPath, { baseDir: BaseDirectory.Home });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        files.push({ path: `${dirPath}/${entry.name}`, project: projectLabel(dir.name) });
      }
    }
  }

  const summaries: SessionSummary[] = [];
  let done = 0;
  for (const file of files) {
    try {
      const info = await stat(file.path, { baseDir: BaseDirectory.Home });
      const cacheKey = `${CACHE_PREFIX}${file.path}:${info.mtime ? +new Date(info.mtime) : 0}:${info.size}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        summaries.push(JSON.parse(cached) as SessionSummary);
      } else {
        const detail = await loadSessionDetail(file.path);
        if (detail.items.length === 0) {
          done++;
          continue; // empty shells (aborted launches) add noise, skip them
        }
        const summary = toSummary(detail, file.path, file.project, "claude");
        cachePut(file.path, cacheKey, summary);
        summaries.push(summary);
      }
    } catch {
      // unreadable file — skip
    }
    done++;
    onProgress?.(done, files.length);
  }
  summaries.sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
  return summaries;
}

/** Watch the transcript root; fires (debounced) whenever any session file changes. */
export async function watchTranscripts(onChange: () => void): Promise<() => void> {
  return watch(ROOT, onChange, { baseDir: BaseDirectory.Home, recursive: true, delayMs: 800 });
}
