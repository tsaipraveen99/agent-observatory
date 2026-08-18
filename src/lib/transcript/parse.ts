import { priceFor } from "./pricing";
import type { SessionDetail, TimelineItem, UsageTotals } from "./types";

interface RawLine {
  type?: string;
  uuid?: string;
  requestId?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  aiTitle?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  subtype?: string;
  content?: unknown;
  message?: {
    role?: string;
    model?: string;
    id?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface PendingTool {
  item: Extract<TimelineItem, { kind: "tool" }>;
  startedAt?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text?: string } => typeof b === "object" && b !== null)
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

export function parseTranscript(jsonl: string, sessionId: string): SessionDetail {
  const items: TimelineItem[] = [];
  const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const models = new Set<string>();
  const seenUsageKeys = new Set<string>();
  const pendingTools = new Map<string, PendingTool>();
  const costByModel = new Map<string, UsageTotals>();

  let title: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let userMessages = 0;
  let assistantTurns = 0;
  let toolCalls = 0;
  let sidechainItems = 0;

  for (const rawLine of jsonl.split("\n")) {
    if (!rawLine.trim()) continue;
    let raw: RawLine;
    try {
      raw = JSON.parse(rawLine) as RawLine;
    } catch {
      continue; // malformed line — transcripts can be truncated mid-write
    }

    if (raw.type === "ai-title" && raw.aiTitle) {
      title = raw.aiTitle;
      continue;
    }
    if (raw.type !== "user" && raw.type !== "assistant" && raw.type !== "system") continue;

    cwd ??= raw.cwd;
    gitBranch ??= raw.gitBranch;
    version ??= raw.version;
    const ts = raw.timestamp ?? "";
    if (ts) {
      startedAt ??= ts;
      endedAt = ts;
    }
    const sidechain = raw.isSidechain === true;

    if (raw.type === "system") {
      const text = textOf(raw.content);
      if (!raw.isMeta && text) {
        items.push({ kind: "system", ts, subtype: raw.subtype, text, sidechain });
        if (sidechain) sidechainItems++;
      }
      continue;
    }

    const message = raw.message;
    if (!message) continue;

    if (raw.type === "user") {
      if (raw.isMeta) continue;
      const content = message.content;
      let isToolResultOnly = false;
      if (Array.isArray(content)) {
        const blocks = content.filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null);
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        for (const tr of toolResults) {
          const pending = pendingTools.get(String(tr.tool_use_id));
          if (pending) {
            pending.item.result = textOf(tr.content);
            if (tr.is_error === true) pending.item.isError = true;
            if (pending.startedAt && ts) {
              pending.item.durationMs = Date.parse(ts) - Date.parse(pending.startedAt);
            }
            pendingTools.delete(String(tr.tool_use_id));
          }
        }
        isToolResultOnly = toolResults.length > 0 && toolResults.length === blocks.length;
      }
      if (!isToolResultOnly) {
        const text = textOf(content);
        if (text) {
          items.push({ kind: "user", ts, text, sidechain });
          userMessages++;
          if (sidechain) sidechainItems++;
        }
      }
      continue;
    }

    // assistant
    const model = message.model;
    if (model) models.add(model);
    const usageKey = raw.requestId ?? message.id ?? raw.uuid ?? "";
    if (message.usage && !seenUsageKeys.has(usageKey)) {
      seenUsageKeys.add(usageKey);
      const u = message.usage;
      const add = (t: UsageTotals) => {
        t.inputTokens += u.input_tokens ?? 0;
        t.outputTokens += u.output_tokens ?? 0;
        t.cacheReadTokens += u.cache_read_input_tokens ?? 0;
        t.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      };
      add(usage);
      const key = model ?? "unknown";
      if (!costByModel.has(key)) {
        costByModel.set(key, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
      }
      add(costByModel.get(key)!);
      assistantTurns++;
    }

    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        items.push({ kind: "assistant_text", ts, text: b.text, model, sidechain });
        if (sidechain) sidechainItems++;
      } else if (b.type === "thinking" && typeof b.thinking === "string" && b.thinking.trim()) {
        items.push({ kind: "thinking", ts, summary: b.thinking, sidechain });
        if (sidechain) sidechainItems++;
      } else if (b.type === "tool_use") {
        const item: Extract<TimelineItem, { kind: "tool" }> = {
          kind: "tool",
          ts,
          name: String(b.name ?? "unknown"),
          input: b.input,
          sidechain,
        };
        items.push(item);
        toolCalls++;
        if (sidechain) sidechainItems++;
        pendingTools.set(String(b.id), { item, startedAt: ts });
      }
    }
  }

  let costUsd: number | null = 0;
  for (const [model, t] of costByModel) {
    const price = priceFor(model);
    if (!price) {
      costUsd = null;
      break;
    }
    costUsd +=
      (t.inputTokens * price.input +
        t.outputTokens * price.output +
        t.cacheReadTokens * price.input * 0.1 +
        t.cacheWriteTokens * price.input * 1.25) /
      1_000_000;
  }

  return {
    id: sessionId,
    title,
    cwd,
    gitBranch,
    version,
    startedAt,
    endedAt,
    models: [...models],
    items,
    usage,
    costUsd,
    counts: { userMessages, assistantTurns, toolCalls, sidechainItems },
  };
}
