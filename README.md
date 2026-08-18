# Agent Observatory

[![CI](https://github.com/tsaipraveen99/agent-observatory/actions/workflows/ci.yml/badge.svg)](https://github.com/tsaipraveen99/agent-observatory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-silver.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-black)

**A flight recorder for your AI coding sessions.**

Agent Observatory is a native macOS app (Tauri) that reads the session records your AI coding tools already write to disk — Claude Code transcripts and Cursor conversations and turns them into something you can actually see: what the agent did, in what order, how long each step took, and what it cost. Open a session and replay it — every user turn, thinking pass, and tool call on a timeline, with cumulative token and dollar telemetry.

> The session where an agent quietly spent $15 retrying a broken test is invisible in your terminal scrollback. Here it's a timeline you can scrub.

## What it shows

- **Sessions list** — every Claude Code and Cursor session across all your projects, with title, activity sparkline, tool-call count, wall-clock duration, and estimated API cost at a glance.
- **Session replay** — a timeline of the full session: user messages, the agent's visible reasoning, and collapsible tool cards (input, output, per-call duration), with idle gaps compressed and labeled. Subagent (sidechain) activity is separated behind a toggle.
- **Telemetry** — token totals split by input / output / cache read / cache write, per-model cost estimation at list prices, and models used.
- **Live mode** — the app watches the transcript directory, so a session updates while Claude Code is still running it.

## Privacy stance

Transcripts contain your code, your prompts, and sometimes your secrets. So:

- **Zero network calls.** Nothing is uploaded, ever. System fonts only — not even a font CDN.
- **Read-only, enforced.** Claude Code transcripts are read through a Tauri fs capability scoped to `~/.claude/projects` only; Cursor conversations are read through a native SQLite connection opened `SQLITE_OPEN_READ_ONLY`. Neither path can write.
- All parsing happens in-process; the only thing written is a small summary cache in the app's own data directory.

## Architecture

```
~/.claude/projects/**/*.jsonl        Claude Code transcripts (source of truth)
Cursor's state.vscdb                 Cursor conversations (read-only SQLite)
        │
        ▼  scoped fs access / read-only native queries
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

## Install

**From a release:** grab the `.dmg` from [Releases](https://github.com/tsaipraveen99/agent-observatory/releases). Builds are currently unsigned — right-click → Open on first launch.

**From source:**

```sh
git clone https://github.com/tsaipraveen99/agent-observatory
cd agent-observatory
npm install
npm run tauri dev      # needs Rust (rustup) + Xcode CLT
npm run tauri build    # produces the .dmg locally
```

`npm test` runs the parser suite (vitest) — no app or Rust needed.

## Status & roadmap

Functional today: sessions list, replay, live refresh, cost estimation — all against real transcripts. Long sessions stay smooth via `content-visibility` render skipping.

- [x] Insight detectors ("repeated an identical Bash call 5×", "re-read the same file 14×")
- [x] Cross-session analytics — overview screen with spend by project and last-14-days chart
- [x] Cursor adapter — conversations from Cursor's local store, normalized into the same timeline model
- [ ] Adapters for other agent tools behind the same interface
- [ ] Signed + notarized builds

## Non-goals

Uploading telemetry, team dashboards, or anything that requires your transcripts to leave your machine.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — short version: local-only is non-negotiable, parser changes need tests with synthetic fixtures, never commit real transcripts.

## License

[MIT](LICENSE)
