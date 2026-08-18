# Agent Observatory

**A flight recorder for your AI coding sessions.**

Agent Observatory is a native macOS app (Tauri) that reads the session transcripts Claude Code already writes to your disk and turns them into something you can actually see: what the agent did, in what order, how long each step took, and what it cost. Open a session and replay it — every user turn, thinking pass, and tool call on a timeline, with cumulative token and dollar telemetry.

> The session where an agent quietly spent $15 retrying a broken test is invisible in your terminal scrollback. Here it's a timeline you can scrub.

## What it shows

- **Sessions list** — every Claude Code session across all your projects, with title, activity sparkline, tool-call count, wall-clock duration, and estimated API cost at a glance.
- **Session replay** — a timeline of the full session: user messages, the agent's visible reasoning, and collapsible tool cards (input, output, per-call duration), with idle gaps compressed and labeled. Subagent (sidechain) activity is separated behind a toggle.
- **Telemetry** — token totals split by input / output / cache read / cache write, per-model cost estimation at list prices, and models used.
- **Live mode** — the app watches the transcript directory, so a session updates while Claude Code is still running it.

## Privacy stance

Transcripts contain your code, your prompts, and sometimes your secrets. So:

- **Zero network calls.** Nothing is uploaded, ever. System fonts only — not even a font CDN.
- **One directory, read-only.** The Tauri capability config grants the webview read access to `~/.claude/projects` and nothing else — enforced by the platform, not promised by a privacy policy.
- All parsing happens in-process; the only thing written is a small summary cache in the app's own data directory.

## Architecture

```
~/.claude/projects/**/*.jsonl        Claude Code's own transcripts (source of truth)
        │
        ▼  scoped read-only fs access (Tauri fs plugin)
┌──────────────────────────────────────────────┐
│  Webview (React + TypeScript)                │
│  discover.ts   scan / mtime-cache / watch    │
│  parse.ts      JSONL → normalized timeline   │
│  pricing.ts    usage → estimated USD         │
│  UI            list · replay · telemetry     │
└──────────────────────────────────────────────┘
        Rust shell: stock Tauri v2, no custom native code
```

Parsing details worth knowing: streamed assistant messages spanning multiple JSONL lines share a `requestId`, so usage is deduped by request (otherwise costs double-count); tool results live in *user* lines and are paired back to their `tool_use` by ID to compute per-call durations; malformed lines (truncated mid-write) are skipped, not fatal.

## Development

```sh
npm install
npm run tauri dev    # needs Rust (rustup) + Xcode CLT
npm test             # parser test suite (vitest) — no app needed
```

## Status & roadmap

Early but functional: list, replay, live refresh, cost estimation all work against real transcripts today.

- [ ] App icon and packaged `.dmg`
- [ ] Virtualized timeline (sessions with ~1000 tool calls render as one long list today)
- [ ] Insight detectors ("retried a failing test 7 times — $2.10", "re-read the same file 14×")
- [ ] Cross-session analytics (spend per project / per day)
- [ ] Cursor and other agent-tool adapters behind the same parser interface

## Non-goals

Uploading telemetry, team dashboards, or anything that requires your transcripts to leave your machine.
