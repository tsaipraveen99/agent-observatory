import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { Overview } from "./components/Overview";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";
import { loadIndex, loadSessionDetail, watchTranscripts, type SessionSummary } from "./lib/discover";
import type { SessionDetail } from "./lib/transcript/types";

type LoadState =
  | { phase: "loading"; done: number; total: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export default function App() {
  const [state, setState] = useState<LoadState>({ phase: "loading", done: 0, total: 0 });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const selectedRef = useRef<SessionSummary | null>(null);
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    try {
      const index = await loadIndex((done, total) =>
        setState((s) => (s.phase === "ready" ? s : { phase: "loading", done, total })),
      );
      setSessions(index);
      setState({ phase: "ready" });
      const current = selectedRef.current;
      if (current) {
        setDetail(await loadSessionDetail(current.path));
      }
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    let stop: (() => void) | undefined;
    watchTranscripts(() => void refresh())
      .then((unwatch) => (stop = unwatch))
      .catch(() => {
        /* watching is an enhancement; polling users can re-launch */
      });
    return () => stop?.();
  }, [refresh]);

  const openSession = useCallback(async (s: SessionSummary) => {
    setSelected(s);
    setDetail(null);
    try {
      setDetail(await loadSessionDetail(s.path));
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const goHome = useCallback(() => {
    setSelected(null);
    setDetail(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") goHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goHome]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand" data-tauri-drag-region>
          <span className="brand-mark" aria-hidden="true">
            ◑
          </span>
          <div>
            <div className="brand-name display">Observatory</div>
            <div className="brand-sub mono">~/.claude/projects · local only</div>
          </div>
        </div>
        {state.phase === "loading" && (
          <div className="loading mono">
            indexing sessions… {state.done}/{state.total || "?"}
          </div>
        )}
        {state.phase === "error" && <div className="error-box">{state.message}</div>}
        <button className={`overview-link${selected ? "" : " active"}`} onClick={goHome}>
          <span aria-hidden="true">◑</span> Overview
          <kbd className="mono">esc</kbd>
        </button>
        {sessions.length === 0 && state.phase === "ready" && (
          <div className="empty mono">
            No sessions found. Run Claude Code once, then reopen — transcripts appear here automatically.
          </div>
        )}
        <SessionList sessions={sessions} selectedPath={selected?.path} onSelect={openSession} />
      </aside>
      <main className="main">
        {detail ? (
          <SessionView detail={detail} />
        ) : selected ? (
          <div className="placeholder mono">reading transcript…</div>
        ) : sessions.length > 0 ? (
          <Overview sessions={sessions} />
        ) : (
          <div className="placeholder">
            <div className="placeholder-mark" aria-hidden="true">
              ◑
            </div>
            <p>Pick a session to replay its flight record.</p>
          </div>
        )}
      </main>
    </div>
  );
}
