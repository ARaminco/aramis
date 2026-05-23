<div align="center">
  <img src="electron/icon.svg" width="96" alt="Aramis logo" />

  # Aramis

  **A local-first AI command center for DevOps, sysadmin work, and code operations.**

  با Aramis به جای جنگیدن با ترمینال، با سیستم خود چت کنید: برنامه‌ریزی، بررسی، اجرا، و اعتبارسنجی در یک محیط دسکتاپ/وب امن و شفاف.

  [![CI](https://github.com/aliasgharramin/aramis/actions/workflows/ci.yml/badge.svg)](https://github.com/aliasgharramin/aramis/actions/workflows/ci.yml)
  [![Release](https://github.com/aliasgharramin/aramis/actions/workflows/release.yml/badge.svg)](https://github.com/aliasgharramin/aramis/actions/workflows/release.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-0f172a.svg)](LICENSE)
  [![Node.js 20+](https://img.shields.io/badge/Node.js-20+-16a34a.svg)](https://nodejs.org/)
  [![Electron](https://img.shields.io/badge/Desktop-Electron-38bdf8.svg)](https://www.electronjs.org/)

  [Features](#features) · [Quick Start](#quick-start) · [Desktop Builds](#desktop-builds) · [Deploy](#deploy) · [Security](#security)
</div>

---

## What Is Aramis?

Aramis is an AI-powered terminal workspace that runs locally on your machine or server. It combines a bilingual chat UI, a real Express backend, SQLite persistence, transparent tool calls, and optional desktop packaging for macOS, Windows, and Linux.

It is built for people who do infrastructure work and want an assistant that can inspect, reason, execute commands, edit files, manage SSH/FTP/Git workflows, and explain what happened without hiding the dangerous parts.

## Features

- **Agentic workflow**: Plan -> Investigate -> Execute -> Verify before final answers.
- **Live streaming**: model output, tool calls, stdout, stderr, and exit codes stream into the UI.
- **Command approval mode**: choose Auto for speed or Manual when every shell/file action must be approved.
- **Multi-engine chat**: Aramis Agent, Claude Code CLI, and OpenAI Codex CLI can stream into the same conversation interface.
- **Multi-provider AI**: OpenAI, Anthropic, Groq, OpenRouter, Together, Ollama, and OpenAI-compatible endpoints.
- **Voice input**: microphone composer powered by Whisper-compatible transcription providers.
- **Local memory**: long-term preferences, facts, environment notes, and secrets stored in SQLite.
- **Operations panels**: file explorer, Git panel, SSH/FTP host manager, diagnostics, changelog view, and command palette.
- **Desktop + web**: Electron app for local desktop use, Express/Vue production server for VPS/self-hosting.
- **Bilingual UI**: Persian and English with RTL/LTR switching, dark/light themes, and UI scaling.

## Architecture

```text
Vue 3 + Vite + Tailwind UI
        |
        | HTTP, SSE, uploads
        v
Express API + agent services
        |
        | tools, CLI runners, providers
        v
Local shell / filesystem / Git / SSH / FTP / SQLite
```

Core stack:

- **Frontend**: Vue 3, Vite, Pinia, Tailwind, reka-ui, marked, highlight.js.
- **Backend**: Express, better-sqlite3, JWT auth, bcrypt, multer, provider adapters.
- **Desktop**: Electron 33 + electron-builder for DMG, NSIS, and AppImage.
- **Data**: local SQLite database with WAL mode.

## Quick Start

Requirements:

- Node.js **20+**. Node.js 22 is recommended.
- npm **9+**.
- One AI provider key, or a local Ollama setup.

```bash
git clone https://github.com/aliasgharramin/aramis.git
cd aramis
npm run install:all
npm run dev
```

Open `http://localhost:5173`.

First run flow:

1. Create the local admin password.
2. Open Settings and configure provider, model, and API key.
3. Run Diagnostics.
4. Start a chat and choose Aramis, Claude Code, or Codex mode.

## Production Web Server

```bash
npm run install:all
npm run build
JWT_SECRET="$(openssl rand -hex 32)" npm --prefix server start
```

Default production URL is `http://localhost:5174`. The Express server serves the built SPA from `web/dist`.

Useful environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5174` | Express server port. |
| `JWT_SECRET` | development fallback | Required strong secret for production. |
| `DB_PATH` | `server/data/aramis.db` | SQLite database path. |
| `CORS_ORIGIN` | unset | Optional allowed browser origin. |
| `ARAMIS_FS_ROOT` | unset | Optional filesystem boundary for file browsing. |

## Desktop Builds

Local desktop packaging:

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

Outputs are written to `dist-electron/`.

GitHub release builds are configured in `.github/workflows/release.yml`:

- Run manually from **Actions -> Build desktop release**.
- Or push a version tag like `v0.5.2` to build all release artifacts.
- Tag builds attach generated installers to a GitHub Release.

## GitHub Publishing Setup

This repository is configured for personal GitHub publishing under:

```text
https://github.com/aliasgharramin/aramis
```

Initial push:

```bash
git remote add origin git@github.com:aliasgharramin/aramis.git
git push -u origin master
```

Create and publish a release tag after running the local release workflow:

```bash
git tag v$(node -p "require('./package.json').version")
git push origin master --tags
```

Project automation included:

- CI build on `master`, `main`, and pull requests.
- Manual/tagged desktop release workflow.
- Dependabot for npm and GitHub Actions.
- Issue templates and pull request template.
- MIT license and security policy.

## Release Workflow

This project intentionally keeps releases local-first. After meaningful changes, run:

```bash
npm run release -- "One-line summary of what changed"
```

The command updates `CHANGELOG.md`, bumps the root package version, rebuilds the web app, stages changes, and creates one release commit.

See [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md) for the mandatory agent rules.

## Deploy With systemd

Example unit:

```ini
[Unit]
Description=Aramis
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

Put Caddy, nginx, or another reverse proxy in front of Aramis and serve it only over HTTPS.

## Security

Aramis is powerful because it can operate your machine. Treat it like privileged infrastructure software.

- Change `JWT_SECRET` in production.
- Keep the server behind HTTPS and a trusted reverse proxy.
- Use Manual approval on shared machines or sensitive servers.
- Do not expose raw development ports to the public internet.
- Review tool calls before approving file writes or shell commands.
- Report private vulnerabilities through https://aramin.co.

More details: [SECURITY.md](SECURITY.md).

## Repository Layout

```text
aramis/
├── electron/          # Electron main process and icons
├── server/src/        # Express API, routes, services, SQLite helpers
├── web/src/           # Vue app, stores, components, views, i18n
├── scripts/           # Release automation
├── .github/           # CI, release workflow, templates, Dependabot
├── CLAUDE.md          # Agent rules and release policy
├── AGENTS.md          # Mirror for Codex/Cursor/Gemini-compatible agents
└── README.md
```

## Author

Built by **[Aliasghar Ramin](https://aramin.co)**.

If Aramis helps your workflow, star the repository and open focused issues for bugs or feature requests.
