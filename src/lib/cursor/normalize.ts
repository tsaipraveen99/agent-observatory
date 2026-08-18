import type { SessionDetail, TimelineItem, UsageTotals } from "../transcript/types";

export interface CursorHeader {
  composer_id: string;
  workspace_folder: string | null;
  created_at: number | null;
  last_updated_at: number | null;
  is_subagent: boolean;
}

interface Bubble {
  bubbleId?: string;
  type?: number;
  createdAt?: number | string;
  text?: string;
  thinking?: { text?: string };
  toolFormerData?: {
    name?: string;
    status?: string;
    rawArgs?: string;
    result?: string;
    error?: string;
  };
  tokenCount?: { inputTokens?: number; outputTokens?: number };
}

function toIso(value: number | string | undefined): string {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return "";
}

function parseMaybeJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function workspaceProject(folder: string | null): string {
  if (!folder) return "cursor";
  const cleaned = folder.replace(/\/+$/, "");
  return decodeURIComponent(cleaned.split("/").pop() ?? "cursor");
}

export function normalizeCursorConversation(
  header: CursorHeader,
  composerDataRaw: string | null,
  bubbleRows: string[],
): SessionDetail {
  const byId = new Map<string, Bubble>();
  const storageOrder: string[] = [];
  for (const row of bubbleRows) {
    try {
      const bubble = JSON.parse(row) as Bubble;
      if (bubble.bubbleId) {
        byId.set(bubble.bubbleId, bubble);
        storageOrder.push(bubble.bubbleId);
      }
    } catch {
      // truncated write — skip
    }
  }

  let title: string | undefined;
  let order = storageOrder;
  if (composerDataRaw) {
    try {
      const data = JSON.parse(composerDataRaw) as {
        name?: string;
        fullConversationHeadersOnly?: Array<{ bubbleId?: string }>;
      };
      title = data.name || undefined;
      const listed = (data.fullConversationHeadersOnly ?? [])
        .map((h) => h.bubbleId)
        .filter((id): id is string => !!id && byId.has(id));
      if (listed.length > 0) order = listed;
    } catch {
      // fall back to storage order
    }
  }

  const items: TimelineItem[] = [];
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let userMessages = 0;
  let assistantTurns = 0;
  let toolCalls = 0;

  for (const id of order) {
    const bubble = byId.get(id);
    if (!bubble) continue;
    const ts = toIso(bubble.createdAt);
    if (bubble.tokenCount) {
      usage.inputTokens += bubble.tokenCount.inputTokens ?? 0;
      usage.outputTokens += bubble.tokenCount.outputTokens ?? 0;
    }
    if (bubble.type === 1) {
      if (bubble.text?.trim()) {
        items.push({ kind: "user", ts, text: bubble.text, sidechain: false });
        userMessages++;
      }
      continue;
    }
    if (bubble.type !== 2) continue;
    let contributed = false;
    if (bubble.thinking?.text?.trim()) {
      items.push({ kind: "thinking", ts, summary: bubble.thinking.text, sidechain: false });
      contributed = true;
    }
    if (bubble.text?.trim()) {
      items.push({ kind: "assistant_text", ts, text: bubble.text, sidechain: false });
      contributed = true;
    }
    const tool = bubble.toolFormerData;
    if (tool?.name) {
      const isError = tool.status === "error";
      let result = tool.result && tool.result !== "{}" ? tool.result : undefined;
      if (isError) {
        const err = parseMaybeJson(tool.error);
        const msg =
          typeof err === "object" && err !== null
            ? (err as { clientVisibleErrorMessage?: string }).clientVisibleErrorMessage
            : undefined;
        result = msg ?? result ?? tool.error;
      }
      items.push({
        kind: "tool",
        ts,
        name: tool.name,
        input: parseMaybeJson(tool.rawArgs),
        result,
        isError: isError || undefined,
        sidechain: false,
      });
      toolCalls++;
      contributed = true;
    }
    if (contributed) assistantTurns++;
  }

  const stamps = items.map((i) => i.ts).filter(Boolean).sort();
  return {
    id: header.composer_id,
    title,
    cwd: header.workspace_folder?.replace(/^file:\/\//, "") ?? undefined,
    models: [],
    items,
    usage,
    costUsd: null, // Cursor doesn't expose which model served each turn — never guess a price
    startedAt: stamps[0] ?? (toIso(header.created_at ?? undefined) || undefined),
    endedAt: stamps[stamps.length - 1] ?? (toIso(header.last_updated_at ?? undefined) || undefined),
    counts: { userMessages, assistantTurns, toolCalls, sidechainItems: 0 },
  };
}
