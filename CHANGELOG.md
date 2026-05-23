# Changelog

All notable changes to **Aramis** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Entries below `## [Unreleased]` are appended automatically by `npm run release`.
> When you run a release, everything in `[Unreleased]` rolls into a new dated
> version section, the version bumps in `package.json`, the web bundle rebuilds,
> and a single commit captures the lot. See [CLAUDE.md](./CLAUDE.md) for the AI
> project rule.
## [Unreleased]

- Build fix: include arch in DMG title so arm64 + x64 builds don't collide on /Volumes/Aramis

## [0.2.0] - 2026-05-23

- Multi-engine agent backend: chat now switches between **Aramis Agent**,
  **Claude Code** CLI, and **OpenAI Codex** CLI from the composer mode-switcher.
  Each backend streams into the same chat UI; Claude Code sessions sync from
  `~/.claude/projects/*.jsonl` and can be resumed.
- New side panels: **File Explorer** with inline editor (⌘E) and **Git Panel**
  with status / staged diff / stage-unstage-commit (⌘G).
- **Command Palette** (⌘K) with fuzzy search across actions, panels, and recent
  chats; new global shortcuts (⌘N new chat, ⌘B sidebar, ⌘/ theme).
- **Copy buttons** on every user message, assistant message, ask-user answer,
  and code block (auto-injected after markdown render).
- **Pin chats** + sidebar **search/filter**; per-chat mode badge and CLI
  metadata bar (session id, model, cwd, cost, turns).
- **Session importer** dialog that lists existing Claude Code / Codex sessions
  on disk and adopts them as Aramis chats.
- New backend routes: `/api/cli/{detect,sessions}`, `/api/fs/{home,list,read,write}`,
  `/api/git/{status,stage,unstage,commit,diff}`.
- DB migration: `chats` gains `mode`, `external_session_id`, `cwd`, `pinned`
  columns (added in place via `safeAddColumn`).
- **Release tooling**: `npm run release` bumps version, updates this file,
  rebuilds the web bundle, and commits — wired into [CLAUDE.md](./CLAUDE.md) so
  any AI editing the repo follows the workflow.
- In-app **Changelog & Version** page (`/changelog`) renders this file live.
- Claude Code + Codex sync, file explorer, git panel, command palette, copy buttons, release tooling, in-app changelog page

## [0.1.0] - 2026-05-20

Initial public release.

- Plan → Investigate → Execute → Verify agent loop with live SSE streaming.
- Tool calls rendered as transparent terminal-style cards with stdout/stderr,
  exit codes, and a manual approval gate.
- Long-term memory (`remember` / `forget`) persisted to SQLite across chats.
- Voice input via Whisper (OpenAI or Groq).
- Multi-provider AI support: OpenAI, Anthropic, Groq, OpenRouter, Together,
  Ollama, any OpenAI-compatible endpoint.
- Diagnostics page with 9 health probes including a real provider ping.
- Persian + English UI, RTL/LTR auto-swap, dark/light theme, UI scaling.
- Electron packaging for macOS (DMG), Windows (NSIS), Linux (AppImage).
