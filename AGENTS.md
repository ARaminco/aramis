# AGENTS.md

This project follows the [AGENTS.md / CLAUDE.md](https://agent.md/) convention.

All AI-agent rules — including the mandatory `npm run release` workflow that
must run after every change — are documented in [CLAUDE.md](./CLAUDE.md).

This file exists for agents (Codex CLI, Cursor, Gemini CLI, …) that look for
`AGENTS.md` instead of `CLAUDE.md`. The two files are mirrors; **keep them
synchronized**, and prefer editing `CLAUDE.md` first.

## Quick summary

After any meaningful edit, run:

```bash
npm run release -- "One-line summary of what changed"
```

This bumps the version, updates `CHANGELOG.md`, rewrites the macOS download
links in `README.md` to the new version, runs the web build, and commits
everything in one step.

When the user explicitly asks to publish a release to GitHub (so the in-app
update checker and `install-linux.sh` reusers pick it up):

```bash
npm run publish:release
```

This pushes `main` plus the `vX.Y.Z` tag; the `release.yml` GitHub Actions
workflow then builds and attaches the per-platform installers.

See [CLAUDE.md](./CLAUDE.md) for the full rules.
