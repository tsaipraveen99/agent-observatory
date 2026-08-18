export function fmtCost(costUsd: number | null): string {
  if (costUsd === null) return "—";
  if (costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ${Math.round((ms % 60_000) / 1_000)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtSpan(startedAt?: string, endedAt?: string): string {
  if (!startedAt || !endedAt) return "—";
  return fmtDuration(Date.parse(endedAt) - Date.parse(startedAt));
}

export function fmtWhen(iso?: string): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / (60 * 24));
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function shortModel(model: string): string {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "");
}
