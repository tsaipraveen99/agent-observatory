import { useMemo } from "react";
import { spendByDay, spendByProject, totals } from "../lib/analytics";
import type { SessionSummary } from "../lib/discover";
import { fmtCost, fmtTokens } from "../lib/fmt";

const DAYS = 14;

export function Overview({ sessions }: { sessions: SessionSummary[] }) {
  const t = useMemo(() => totals(sessions), [sessions]);
  const projects = useMemo(() => spendByProject(sessions).slice(0, 8), [sessions]);
  const days = useMemo(() => spendByDay(sessions, DAYS), [sessions]);
  const maxProject = Math.max(0.01, ...projects.map((p) => p.costUsd));
  const maxDay = Math.max(0.01, ...days.map((d) => d.costUsd));

  return (
    <article className="session-view">
      <header className="session-header">
        <h1 className="display">Overview</h1>
        <dl className="stat-strip">
          <div>
            <dt>est. spend</dt>
            <dd className="mono brass">{fmtCost(t.costUsd)}</dd>
          </div>
          <div>
            <dt>sessions</dt>
            <dd className="mono">{t.sessions}</dd>
          </div>
          <div>
            <dt>tool calls</dt>
            <dd className="mono">{fmtTokens(t.toolCalls)}</dd>
          </div>
          <div>
            <dt>output</dt>
            <dd className="mono">{fmtTokens(t.outputTokens)} tok</dd>
          </div>
        </dl>

        <section className="ov-section">
          <h2 className="ov-heading">Spend by project</h2>
          <ul className="ov-bars">
            {projects.map((p) => (
              <li key={p.project} className="ov-bar-row">
                <span className="ov-bar-label">{p.project}</span>
                <span className="ov-bar-track">
                  <span className="ov-bar-fill" style={{ width: `${(p.costUsd / maxProject) * 100}%` }} />
                </span>
                <span className="ov-bar-value mono">{fmtCost(p.costUsd)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="ov-section">
          <h2 className="ov-heading">Last {DAYS} days</h2>
          <div className="ov-days" role="img" aria-label={`Daily spend over the last ${DAYS} days`}>
            {days.map((d, i) => (
              <div key={d.day} className="ov-day">
                <span
                  className="ov-day-bar"
                  title={`${d.day}: ${fmtCost(d.costUsd)}`}
                  style={{ height: `${Math.max(4, (d.costUsd / maxDay) * 100)}%` }}
                />
                <span className="ov-day-label mono">{i % 2 === 0 ? d.day.slice(8) : ""}</span>
              </div>
            ))}
          </div>
        </section>
      </header>
    </article>
  );
}
