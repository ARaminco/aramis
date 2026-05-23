# Contributing to Aramis

Aramis is maintained as a focused local-first AI terminal agent for DevOps, sysadmin, SSH, Git, FTP, and desktop automation workflows.

## Before Opening Work

- Search existing issues first.
- Keep proposals narrow and operationally useful.
- Do not include credentials, private server addresses, API keys, database dumps, or production logs with secrets.
- For security issues, do not open a public issue. Use the private reporting path in [SECURITY.md](SECURITY.md).

## Development Setup

```bash
npm run install:all
npm run dev
```

Open `http://localhost:5173` for the web UI.

## Build Check

```bash
npm run build:web
```

Desktop packaging is handled by GitHub Actions and can also be run locally with:

```bash
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

## Pull Request Standards

- Explain the user-facing change clearly.
- Include verification steps.
- Keep unrelated cleanup out of feature/fix PRs.
- Review shell, filesystem, SSH, FTP, credential, and auth changes with extra care.
- Update Persian and English UI strings together when touching user-facing copy.

## Release Rule

This repository uses a local release workflow. After meaningful edits, run:

```bash
npm run release -- "One-line summary of what changed"
```

The command updates the changelog, bumps the version, builds the web app, and creates the release commit.
