import type { SessionSummary } from "../lib/discover";
import { fmtCost, fmtSpan, fmtWhen } from "../lib/fmt";
import { Sparkline } from "./Sparkline";

interface Props {
  sessions: SessionSummary[];
  selectedPath?: string;
  onSelect: (s: SessionSummary) => void;
}

export function SessionList({ sessions, selectedPath, onSelect }: Props) {
  return (
    <nav className="session-list" aria-label="Sessions">
      {sessions.map((s) => (
        <button
          key={s.path}
          className={`session-row${s.path === selectedPath ? " selected" : ""}`}
          onClick={() => onSelect(s)}
        >
          <div className="session-row-top">
            <span className="session-title">{s.title ?? "Untitled session"}</span>
            <span className="session-when mono">{fmtWhen(s.endedAt)}</span>
          </div>
          <div className="session-row-bottom">
            <span className={`project-chip${s.source === "cursor" ? " chip-cursor" : ""}`}>
              {s.project}
            </span>
            <Sparkline buckets={s.activity} />
            <span className="session-stats mono">
              {s.toolCalls} tools · {fmtSpan(s.startedAt, s.endedAt)} ·{" "}
              <span className="brass">{fmtCost(s.costUsd)}</span>
            </span>
          </div>
        </button>
      ))}
    </nav>
  );
}
