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

## [0.6.0] - 2026-05-23

- **Integrated terminal** — full-featured PTY-backed shell inside the chat, accessible via `⌘T` or the terminal button in the header. Backed by `node-pty` on the server and `xterm.js` in the browser, wired over a JWT-authenticated WebSocket (`/api/terminal`) with idle / heartbeat / 16-session caps. Persists across panel toggles, auto-reconnects once on accidental disconnect, follows light/dark theme, ships full-screen toggle, restart, and clear-screen controls.
- **Settings overhaul** — single-page Settings replaced by a sidebar-nav layout with searchable section list and `#hash` deep-links. Sections: Appearance, Workspace, AI, Agents, Updates, Diagnostics, System, Data, Memory, Security. Horizontal-scrolling tabs on mobile; sticky sidebar on desktop. The old "Changelog" card became a nav item that opens `/changelog`.
- **Richer tool-call rendering** — every Claude / Codex / Aramis tool step now shows live duration, syntax-highlighted file reads (15 languages via highlight.js), copy buttons on stdout/stderr/content, exit-code badges, and a unified-diff renderer with +/− counts for `apply_patch` / `edit_file` results.
- **node-pty install fix** — `scripts/fix-pty-perms.mjs` runs as a postinstall hook and re-applies the executable bit on the per-platform `spawn-helper` binary that npm sometimes strips during prebuild extraction (long-standing bug). Avoids the `posix_spawnp failed` error on a fresh checkout.
- **electron-builder** — added `node_modules/node-pty/**/*` to `asarUnpack` so the native module is loadable inside the packaged Electron app.
- Lazy-loaded the terminal panel chunk so the chat bundle stays small for users who never open a terminal (`defineAsyncComponent`).
- Integrated PTY terminal (xterm + node-pty), Settings overhaul with sidebar nav, richer tool-call rendering with diff/highlight/timing

## [0.5.7] - 2026-05-23

- Removed the always-visible folder-path indicator and the cwd input from the chat composer; the default workspace folder now lives in **Settings → Default workspace folder** with the same path picker.
- Added one-shot Linux server installer (`scripts/install-linux.sh`) that auto-picks a free non-panel port (skips cPanel / DirectAdmin / aaPanel / Plesk / CyberPanel reserved ports), installs Node 20+ from NodeSource when missing, creates a dedicated `aramis` system user, writes a hardened systemd unit, and is idempotent for upgrades.
- Added GitHub-release auto-update checker: new `/api/update/check` proxies the GitHub Releases API with 30-minute in-memory cache, plus a dismissible "new version" banner at the top of the chat and a per-platform download grid inside Settings → Updates.
- Added `npm run publish:release` (`scripts/publish-release.mjs`) — verifies the working tree, pushes `main` and the matching `vX.Y.Z` tag to trigger the GitHub Actions release-build workflow.
- `npm run release` now also rewrites the macOS DMG / Windows Setup / Linux AppImage download links and the "Current local version" line in `README.md` as part of the version bump, so the README never drifts behind a release.
- README: documented the one-line Linux install command, the in-app auto-updater, and that Aramis ships native chat modes for Claude Code, OpenAI Codex, and Google Gemini CLI from one UI.
- CLAUDE.md / AGENTS.md: added the GitHub-release publishing rule and the README-link auto-update invariant.

## [0.5.6] - 2026-05-23

- Completed professional GitHub repository profile and community files

## [0.5.5] - 2026-05-23

- Removed Dependabot automation to keep repository attribution personal

## [0.5.4] - 2026-05-23

- Fixed release artifact uploads and refreshed README download links

## [0.5.3] - 2026-05-23

- Improved README SEO and macOS release downloads

## [0.5.2] - 2026-05-23

- Prepared GitHub publishing configuration and refreshed README

## [0.5.1] - 2026-05-23

- Ignore local AI tool configs (.claude, .codex, .cursor, .aider, .continue, .copilot, .cline, .windsurf, .codeium, .gemini, etc.) in .gitignore

## [0.5.0] - 2026-05-23

- Production-ready security + paste-image + login flow: Helmet security headers, rate-limited /api/auth, CORS lockdown via CORS_ORIGIN, fatal-stop on dev JWT secret in prod, AES-256-GCM for FTP/CLI keys, DOMPurify XSS sanitization on all rendered markdown, CSP meta tag, fs path-traversal hardening (null bytes rejected, ARAMIS_FS_ROOT confines browsing); image paste/drop/pick in composer with live preview chips + /api/uploads/image (10MiB, image MIME allowlist, unguessable 32-hex IDs); Login buttons that launch `claude login` / `codex login` in the user's system terminal; copy buttons icon-only; PathPicker dialog wired into ModeSwitcher cwd + FileExplorer + GitPanel; syntax-highlighted code blocks via highlight.js + marked-highlight

## [0.4.3] - 2026-05-23

- Mobile-first overhaul + Claude/Codex visibility: Dialog goes full-screen on phones (no horizontal scroll), all side panels reserve space for macOS traffic-lights so close X is never covered, Claude Code / Codex now stream stderr live (auth errors surface immediately) with empty-prompt guard and startup banner, model/base_url no longer cross-pollinate between providers, SessionImporter groups by project with collapsible folders and search, new PathPicker dialog for browsing the working directory, HostsPanel adds curated remote-install dropdown (Node.js via Volta/apt/dnf, Homebrew, Claude Code, Codex) — one click runs the canonical install script over SSH on the chosen host

## [0.4.2] - 2026-05-23

- Auto-detect & one-click bootstrap: new path-discover service scans known install locations (Homebrew, nvm, Volta, Herd, asdf, fnm, Volta, etc.) on top of shell PATH expansion — packaged Electron app now finds npm/brew/pnpm even without manual setup; all CLI spawns use absolute resolved paths; bootstrap dialog suggests OS-specific install command (Homebrew on macOS, apt/dnf/pacman/zypper/apk on Linux, winget/choco on Windows) and offers one-click 'Open in Terminal' so sudo prompts work; Re-scan PATH button after the user finishes

## [0.4.1] - 2026-05-23

- Fix: expand Electron PATH from login shell so npm/brew/pnpm are findable (resolves spawn ENOENT during CLI install); lazy chat creation — no empty placeholder rows in sidebar, no hardcoded Persian default title, title pre-filled from first message; AgentInstallerDialog layout (no truncation, no-wrap badges, install button disabled when no manager on PATH); tighter sidebar item spacing

## [0.4.0] - 2026-05-23

- In-app installer & configurator for Claude Code / Codex / Gemini CLIs — detects npm/brew/pnpm/yarn, streams live install output, encrypted per-tool API key (auto-inherited from AI provider config), and injects env + model when spawning each CLI; new ⌘I shortcut and ModeSwitcher install/configure buttons

## [0.3.0] - 2026-05-23

- Build fix: include arch in DMG title so arm64 + x64 builds don't collide on /Volumes/Aramis
- SSH + FTP host manager (~/.ssh/config discovery, run-command streaming, encrypted FTP credentials, file browser); global Vazirmatn font for both locales; dedicated macOS titlebar strip so traffic-lights stop overlapping the sidebar header

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
