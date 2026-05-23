<div align="center">
  <a href="https://github.com/ARaminco/aramis">
    <img src="electron/icon.svg" width="104" alt="Aramis AI Terminal Agent logo" />
  </a>

  # Aramis

  **AI Terminal Agent for DevOps, SysAdmin, SSH, Git, FTP, and local automation.**

  **آرامیس یک دستیار هوش مصنوعی دسکتاپ و وب برای مدیریت سرور، اجرای دستور، کار با فایل‌ها، Git، SSH، FTP و اتوماسیون DevOps است.**

  [![CI](https://github.com/ARaminco/aramis/actions/workflows/ci.yml/badge.svg)](https://github.com/ARaminco/aramis/actions/workflows/ci.yml)
  [![Desktop Release](https://github.com/ARaminco/aramis/actions/workflows/release.yml/badge.svg)](https://github.com/ARaminco/aramis/actions/workflows/release.yml)
  [![Latest Release](https://img.shields.io/github/v/release/ARaminco/aramis?label=latest%20release&color=0f766e)](https://github.com/ARaminco/aramis/releases/latest)
  [![License: MIT](https://img.shields.io/badge/License-MIT-111827.svg)](LICENSE)
  [![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-16a34a.svg)](https://nodejs.org/)
  [![Electron](https://img.shields.io/badge/Desktop-Electron-38bdf8.svg)](https://www.electronjs.org/)

  [Download](#download-aramis) · [Features](#features) · [Quick Start](#quick-start) · [macOS](#download-for-macos) · [Deploy](#self-hosted-web-deploy) · [Security](#security)
</div>

---

## Download Aramis

Aramis is available as a desktop AI terminal app and as a self-hosted web app.

### Download For macOS

| Platform | Recommended For | Download |
| --- | --- | --- |
| **macOS Apple Silicon** | M1, M2, M3, M4 Macs | [Download Aramis v0.5.6 ARM64 DMG](https://github.com/ARaminco/aramis/releases/latest/download/Aramis-0.5.6-arm64.dmg) |
| **macOS Intel** | Intel-based Macs | [Download Aramis v0.5.6 Intel DMG](https://github.com/ARaminco/aramis/releases/latest/download/Aramis-0.5.6.dmg) |
| **All releases** | Older versions and release notes | [Open GitHub Releases](https://github.com/ARaminco/aramis/releases) |

> If direct DMG links return 404, the latest GitHub Release is still being built. Open the [Releases page](https://github.com/ARaminco/aramis/releases) and download the newest macOS asset after the build finishes.

### Other Platforms

| Platform | Installer |
| --- | --- |
| Windows | [Latest Windows Setup](https://github.com/ARaminco/aramis/releases/latest) |
| Linux | [Latest AppImage](https://github.com/ARaminco/aramis/releases/latest) |
| Web / VPS | Run from source with Node.js and Express. |

## What Is Aramis?

Aramis is a **local-first AI terminal agent** for developers, DevOps engineers, system administrators, hosting teams, and power users. It gives you a bilingual chat interface that can plan work, inspect your system, execute shell commands, edit files, manage Git changes, connect to SSH and FTP hosts, and verify results.

Instead of copying commands from an AI chat into a terminal, Aramis keeps the AI assistant, terminal operations, file tools, Git status, remote hosts, diagnostics, and long-term memory in one controlled workspace.

**SEO keywords:** AI terminal agent, DevOps AI assistant, sysadmin AI tool, self-hosted AI agent, Electron AI desktop app, SSH AI assistant, Git AI assistant, AI command runner, local AI automation, Persian AI DevOps tool.

## Why Aramis?

- **Transparent execution**: every command, file operation, stdout, stderr, and exit code is visible.
- **Local-first data**: chats, settings, memory, and credentials are stored locally in SQLite.
- **Desktop and server ready**: use it as a macOS/Windows/Linux desktop app or self-host it on a VPS.
- **Built for real operations**: shell, filesystem, Git, SSH, FTP, diagnostics, uploads, and CLI integrations are first-class workflows.
- **Bilingual by design**: Persian and English UI with RTL/LTR switching.

## Features

### AI Agent Workflow

- **Plan -> Investigate -> Execute -> Verify** loop for safer operational work.
- Live SSE streaming for assistant text, tool calls, command output, and errors.
- Manual approval mode for sensitive shell and filesystem actions.
- Ask-user checkpoints when the agent needs missing parameters.
- Multi-chat history with resumable context.

### DevOps And SysAdmin Tools

- Run local shell commands with streamed output.
- Read, write, browse, and constrain filesystem access.
- Git panel for status, diff, stage, unstage, and commit workflows.
- SSH host discovery and command execution.
- FTP host manager with encrypted credentials.
- Diagnostics page for server, database, filesystem, shell, memory, and AI provider checks.

### Multi-Engine AI

- Built-in Aramis Agent mode.
- Claude Code CLI mode.
- OpenAI Codex CLI mode.
- Session importer for existing CLI sessions.
- Provider support for OpenAI, Anthropic, Groq, OpenRouter, Together, Ollama, and OpenAI-compatible APIs.

### Desktop Experience

- Electron desktop app with embedded Express server.
- macOS DMG builds for Apple Silicon and Intel.
- Windows NSIS installer.
- Linux AppImage build.
- Native path discovery for Homebrew, npm, pnpm, shell tools, Claude, Codex, Git, and SSH.

### UX And Accessibility

- Persian and English language support.
- RTL/LTR automatic document direction.
- Dark and light themes.
- UI scaling from compact to large text.
- Mobile-first responsive layout for the web app.
- Markdown rendering with syntax-highlighted code blocks.
- Voice input with Whisper-compatible transcription.

## Screens And Workflows

Aramis is designed around practical infrastructure workflows:

| Workflow | What Aramis Does |
| --- | --- |
| Server troubleshooting | Plans checks, runs commands, reads logs, explains failures, verifies fixes. |
| Code operations | Opens files, edits safely, checks Git diff, commits reviewed changes. |
| Remote access | Works with discovered SSH hosts and FTP connections. |
| AI CLI bridge | Runs Claude Code or Codex from the same chat UI. |
| Self-hosted assistant | Serves the Vue app and Express API from one production port. |

## Architecture

```text
Vue 3 + Vite + Tailwind UI
        |
        | HTTP, SSE, multipart uploads
        v
Express API + agent services
        |
        | tools, CLI runners, provider adapters
        v
Shell / filesystem / Git / SSH / FTP / SQLite
```

Core stack:

| Layer | Technology |
| --- | --- |
| Frontend | Vue 3, Vite, Pinia, Tailwind CSS, reka-ui, marked, highlight.js |
| Backend | Express, better-sqlite3, JWT auth, bcrypt, multer |
| AI providers | OpenAI, Anthropic, Groq, OpenRouter, Together, Ollama, compatible APIs |
| Desktop | Electron 33, electron-builder |
| Storage | SQLite with WAL mode |

## Quick Start

Requirements:

- Node.js **20+**. Node.js 22 is recommended.
- npm **9+**.
- One AI provider key, or a local Ollama setup.

```bash
git clone https://github.com/ARaminco/aramis.git
cd aramis
npm run install:all
npm run dev
```

Open:

```text
http://localhost:5173
```

First run:

1. Create the local admin password.
2. Open Settings.
3. Configure provider, model, and API key.
4. Run Diagnostics.
5. Start a chat and choose Aramis, Claude Code, or Codex mode.

## Self-Hosted Web Deploy

Build and run the production server:

```bash
npm run install:all
npm run build
JWT_SECRET="$(openssl rand -hex 32)" npm --prefix server start
```

Default production URL:

```text
http://localhost:5174
```

The Express server serves the built SPA from `web/dist`, so production needs only one HTTP port.

### Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5174` | Express server port. |
| `JWT_SECRET` | development fallback | Required strong secret for production. |
| `DB_PATH` | `server/data/aramis.db` | SQLite database path. |
| `CORS_ORIGIN` | unset | Optional allowed browser origin. |
| `ARAMIS_FS_ROOT` | unset | Optional filesystem boundary for file browsing. |

### systemd Example

```ini
[Unit]
Description=Aramis AI Terminal Agent
After=network.target

[Service]
Type=simple
User=aramis
WorkingDirectory=/opt/aramis
Environment="PORT=5174"
Environment="JWT_SECRET=replace-with-a-long-random-secret"
ExecStart=/usr/bin/node server/src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aramis
```

Use Caddy, nginx, or another reverse proxy and serve Aramis only over HTTPS.

## Build Desktop Apps Locally

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

Build outputs are written to `dist-electron/`.

Expected macOS artifact names:

```text
Aramis-<version>-arm64.dmg   # Apple Silicon
Aramis-<version>.dmg         # Intel
```

## GitHub Releases

This repository uses GitHub Actions to build release assets.

- CI workflow: `.github/workflows/ci.yml`
- Desktop release workflow: `.github/workflows/release.yml`
- Tag format: `vX.Y.Z`
- Latest release page: https://github.com/ARaminco/aramis/releases/latest

Publish flow:

```bash
npm run release -- "Short release summary"
git push origin main
git tag v$(node -p "require('./package.json').version")
git push origin --tags
```

A tag push builds macOS, Windows, and Linux installers and attaches them to the GitHub Release.

## Release History

Current local version: **v0.5.6**.

Recent project milestones:

| Version | Highlights |
| --- | --- |
| `v0.5.6` | Completed the GitHub repository profile, support docs, ownership metadata, and polished public presentation. |
| `v0.5.5` | Removed Dependabot automation to keep repository attribution personal. |
| `v0.5.4` | SEO-focused README, direct macOS download links, and fixed GitHub Release artifact uploads. |
| `v0.5.2` | GitHub publishing configuration, CI/release workflows, templates, license, and security policy. |
| `v0.5.1` | Ignore local AI tool configs and per-user agent folders. |
| `v0.5.0` | Production security hardening, paste-image upload flow, login improvements, encrypted credentials, CSP, and path hardening. |
| `v0.4.x` | Claude/Codex visibility, mobile UI fixes, path discovery, and CLI installer improvements. |
| `v0.3.0` | SSH + FTP host manager and macOS packaging improvements. |
| `v0.2.0` | Multi-engine agent backend, file explorer, Git panel, command palette, session importer, and release tooling. |

See [CHANGELOG.md](CHANGELOG.md) for full details.

## Security

Aramis can execute shell commands, write files, and store provider credentials. Treat it like privileged infrastructure software.

- Set a strong `JWT_SECRET` in production.
- Serve only over HTTPS behind a trusted reverse proxy.
- Keep Manual approval enabled on shared machines or sensitive servers.
- Do not expose development ports to the public internet.
- Review tool calls before approving file writes or shell commands.
- Report private vulnerabilities through https://aramin.co.

Read the full policy: [SECURITY.md](SECURITY.md).

## Repository Layout

```text
aramis/
├── electron/          # Electron main process and app icons
├── server/src/        # Express API, routes, services, SQLite helpers
├── web/src/           # Vue app, stores, components, views, i18n
├── scripts/           # Release automation
├── .github/           # CI, desktop releases, templates, Dependabot
├── CLAUDE.md          # Agent rules and release policy
├── AGENTS.md          # Mirror for Codex/Cursor/Gemini-compatible agents
└── README.md
```

## Author

Built by **[Aliasghar Ramin](https://aramin.co)**.

If Aramis helps your DevOps, sysadmin, server management, or local AI automation workflow, star the repository and open focused issues for bugs or feature requests.
