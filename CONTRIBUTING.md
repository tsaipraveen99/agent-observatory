# Contributing

Thanks for your interest. Ground rules are short:

## Setup

```sh
npm install
npm run tauri dev   # needs Rust (rustup) and Xcode Command Line Tools
npm test            # vitest — the parser suite runs without the app
```

## Principles

1. **Local-only is non-negotiable.** No PRs that add network calls, telemetry, or remote fonts. The fs scope stays limited to `~/.claude/projects`.
2. **The parser is test-first.** Any change to `src/lib/transcript/` needs a test demonstrating the transcript shape it handles. Use synthetic fixtures — never commit real transcripts, which contain private data by nature.
3. **New agent-tool sources** (Cursor, etc.) should implement the same normalized `SessionDetail` model behind `src/lib/transcript/types.ts` rather than leaking format-specific types into the UI.
4. Keep the Rust shell stock unless a capability genuinely requires native code.

## Reporting transcript-format breakage

Claude Code's JSONL format is undocumented and changes between versions. If sessions fail to parse, open an issue with the `version` field from an affected line and the line's `type` — never paste full transcript lines.
