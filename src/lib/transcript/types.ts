export type TimelineItem =
  | { kind: "user"; ts: string; text: string; sidechain: boolean }
  | { kind: "assistant_text"; ts: string; text: string; model?: string; sidechain: boolean }
  | { kind: "thinking"; ts: string; summary: string; sidechain: boolean }
  | {
      kind: "tool";
      ts: string;
      name: string;
      input: unknown;
      result?: string;
      isError?: boolean;
      durationMs?: number;
      sidechain: boolean;
    }
  | { kind: "system"; ts: string; subtype?: string; text: string; sidechain: boolean };

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface SessionDetail {
  id: string;
  title?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  startedAt?: string;
  endedAt?: string;
  models: string[];
  items: TimelineItem[];
  usage: UsageTotals;
  /** Estimated API list cost in USD; null when any model is unpriced. */
  costUsd: number | null;
  counts: { userMessages: number; assistantTurns: number; toolCalls: number; sidechainItems: number };
}
