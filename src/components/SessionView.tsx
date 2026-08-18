import { useMemo, useState } from "react";
import { detectInsights } from "../lib/transcript/insights";
import type { SessionDetail, TimelineItem } from "../lib/transcript/types";
import { fmtClock, fmtCost, fmtDuration, fmtSpan, fmtTokens, shortModel } from "../lib/fmt";

const IDLE_GAP_MS = 5 * 60_000;

type Row = { item: TimelineItem; gapMs: number };

function buildRows(items: TimelineItem[], showSidechain: boolean): Row[] {
  const rows: Row[] = [];
  let prevTs: number | null = null;
  for (const item of items) {
    if (item.sidechain && !showSidechain) continue;
    const t = Date.parse(item.ts);
    const gapMs = prevTs !== null && !Number.isNaN(t) ? t - prevTs : 0;
    rows.push({ item, gapMs });
    if (!Number.isNaN(t)) prevTs = t;
  }
  return rows;
}

function ToolCard({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const inputPreview = useMemo(() => {
    const s = JSON.stringify(item.input ?? {}, null, open ? 2 : 0);
    return open ? s : s.length > 120 ? s.slice(0, 120) + "…" : s;
  }, [item.input, open]);
  return (
    <div className={`tool-card${item.isError ? " tool-error" : ""}`}>
      <button className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-name mono">{item.name}</span>
        <span className="tool-input mono">{inputPreview}</span>
        {item.durationMs !== undefined && (
          <span className="tool-duration mono">{fmtDuration(item.durationMs)}</span>
        )}
      </button>
      {open && item.result !== undefined && (
        <pre className="tool-result mono">{item.result.length > 4000 ? item.result.slice(0, 4000) + "\n… (truncated)" : item.result}</pre>
      )}
    </div>
  );
}

function ItemBody({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "user":
      return <div className="bubble user-bubble">{item.text}</div>;
    case "assistant_text":
      return <div className="bubble assistant-bubble">{item.text}</div>;
    case "thinking":
      return <ThinkingRow summary={item.summary} />;
    case "tool":
      return <ToolCard item={item} />;
    case "system":
      return <div className="system-row mono">{item.subtype ? `[${item.subtype}] ` : ""}{item.text.slice(0, 300)}</div>;
  }
}

function ThinkingRow({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="thinking-row" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="thinking-label">thinking</span>
      <span className="thinking-text">{open ? summary : summary.slice(0, 90) + (summary.length > 90 ? "…" : "")}</span>
    </button>
  );
}

export function SessionView({ detail }: { detail: SessionDetail }) {
  const [showSidechain, setShowSidechain] = useState(false);
  const rows = useMemo(() => buildRows(detail.items, showSidechain), [detail, showSidechain]);
  const insights = useMemo(() => detectInsights(detail), [detail]);

  return (
    <article className="session-view">
      <div className="glass-toolbar">
        <span className="toolbar-title">{detail.title ?? "Untitled session"}</span>
        <span className="toolbar-stats mono">
          <span className="brass">{fmtCost(detail.costUsd)}</span> · {fmtSpan(detail.startedAt, detail.endedAt)} ·{" "}
          {detail.counts.toolCalls} tools
        </span>
      </div>
      <header className="session-header">
        <h1 className="display">{detail.title ?? "Untitled session"}</h1>
        <div className="header-meta mono">
          {detail.cwd && <span>{detail.cwd}</span>}
          {detail.gitBranch && <span>⎇ {detail.gitBranch}</span>}
        </div>
        <dl className="stat-strip">
          <div>
            <dt>est. cost</dt>
            <dd className="mono brass">{fmtCost(detail.costUsd)}</dd>
          </div>
          <div>
            <dt>duration</dt>
            <dd className="mono">{fmtSpan(detail.startedAt, detail.endedAt)}</dd>
          </div>
          <div>
            <dt>output</dt>
            <dd className="mono">{fmtTokens(detail.usage.outputTokens)} tok</dd>
          </div>
          <div>
            <dt>cache read</dt>
            <dd className="mono">{fmtTokens(detail.usage.cacheReadTokens)} tok</dd>
          </div>
          <div>
            <dt>tool calls</dt>
            <dd className="mono">{detail.counts.toolCalls}</dd>
          </div>
          <div>
            <dt>models</dt>
            <dd className="mono">{detail.models.map(shortModel).join(", ") || "—"}</dd>
          </div>
        </dl>
        {insights.length > 0 && (
          <ul className="insights" aria-label="Session insights">
            {insights.map((insight, i) => (
              <li key={i} className={`insight-chip${insight.severity === "warn" ? " insight-warn" : ""}`}>
                <span className="insight-glyph" aria-hidden="true">
                  {insight.severity === "warn" ? "▲" : "●"}
                </span>
                <span className="insight-title">{insight.title}</span>
                <span className="insight-detail">{insight.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {detail.counts.sidechainItems > 0 && (
          <label className="sidechain-toggle">
            <input
              type="checkbox"
              checked={showSidechain}
              onChange={(e) => setShowSidechain(e.target.checked)}
            />
            show {detail.counts.sidechainItems} subagent events
          </label>
        )}
      </header>

      <ol className="timeline">
        {rows.map(({ item, gapMs }, i) => (
          <li key={i} className={`tl-row kind-${item.kind}${item.sidechain ? " sidechain" : ""}`}>
            {gapMs > IDLE_GAP_MS && (
              <div className="idle-break mono" aria-label={`Idle ${fmtDuration(gapMs)}`}>
                · {fmtDuration(gapMs)} idle ·
              </div>
            )}
            <div className="tl-item">
              <span className="tape-tick" aria-hidden="true" />
              <time className="tl-time mono">{fmtClock(item.ts)}</time>
              <div className="tl-body">
                <ItemBody item={item} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
