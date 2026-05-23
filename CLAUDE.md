# Aramis — project rules for AI agents

This file is read by Claude Code, Codex, Cursor, and any other AI agent that
follows the [AGENTS.md / CLAUDE.md](https://agent.md/) convention. Follow these
rules whenever you edit this repo.

> Mirror in [AGENTS.md](./AGENTS.md). Keep both in sync.

---

## Release workflow — MANDATORY after every meaningful change

After completing any user-visible or behavior-changing edit, run the release
command. **One command does everything:**

```bash
npm run release -- "One-line summary of what changed"
```

This will, in order:

1. Take everything currently sitting under `## [Unreleased]` in `CHANGELOG.md`
2. Roll it (plus the summary you pass) into a **new dated version section**
3. Bump the version in `package.json` (default: patch — `0.1.0 → 0.1.1`)
4. Run `npm run build:web` so the production bundle matches the new version
5. Stage all changes and create one commit titled
   `release: vX.Y.Z — <your summary>`

You do **not** need to update `CHANGELOG.md`, bump the version, run the build,
or `git commit` separately. `npm run release` is the single entrypoint.

### Flags

| Flag                         | Effect                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| _(default)_                  | Patch bump (`0.1.0 → 0.1.1`)                                        |
| `--minor`                    | Minor bump (`0.1.0 → 0.2.0`) — new feature, no breaking change      |
| `--major`                    | Major bump (`0.1.0 → 1.0.0`) — breaking change                      |
| `--no-bump`                  | Just append the bullet to `## [Unreleased]` without cutting a version |
| `--no-build`                 | Skip `npm run build:web`                                            |
| `--no-commit`                | Update files but don't `git commit`                                 |
| `--dry-run`                  | Preview every action; write nothing                                 |

### Picking the bump kind

- **Patch** (default) — fixes, small additions, refactors, doc tweaks.
- **Minor** — a new feature, a new route, a new view, a new CLI mode.
- **Major** — only when a public API/route/event/DB-shape change forces
  existing setups to migrate.

### When to use `--no-bump`

If you're stacking several small edits during one session and don't want every
commit to cut a new version, run `--no-bump "what I just did"` on intermediate
commits. The final session-ending change uses the default (patch/minor/major)
to roll everything into one version. Keep this rare — the default is to cut a
release per meaningful change.

### Examples

```bash
# A typical AI-driven edit
npm run release -- "Fixed empty-state alignment on mobile"

# A new feature
npm run release -- --minor "Added Codex CLI integration"

# Preview before committing
npm run release -- --dry-run "Test description"

# Just record progress without bumping (e.g. mid-session)
npm run release -- --no-bump "Refactored auth middleware"
```

---

## Publishing a GitHub release — for user-facing builds

`npm run release` bumps the version, rolls the changelog, rewrites the macOS
download links in `README.md`, builds the bundle, and creates a local commit.
It does **not** push to GitHub. When the user explicitly asks to "ship",
"publish", or "release to GitHub" (so the in-app update checker and the
`install-linux.sh` users pick up the new build), run:

```bash
npm run publish:release
```

This script (`scripts/publish-release.mjs`):

1. Reads the version from `package.json` (must already match the latest
   `release: vX.Y.Z` commit).
2. Pushes `main` to `origin`.
3. Creates the `vX.Y.Z` tag locally if it doesn't exist, then pushes it.
4. The tag push triggers `.github/workflows/release.yml`, which builds the
   macOS DMGs, Windows NSIS installer, and Linux AppImage and attaches them
   to the GitHub Release.

Manual equivalent (use this if the script isn't available yet):

```bash
git push origin main
VER=$(node -p "require('./package.json').version")
git tag "v$VER"
git push origin "v$VER"
```

**Rules:**

- **Never publish a release that wasn't cut by `npm run release`** — the
  changelog and version must stay in sync.
- **Never overwrite an existing tag** with `git tag -f` or `git push --force`.
  Cut a new patch instead.
- **Never run `npm run publish:release` automatically.** It's an irreversible,
  user-visible action — wait for an explicit ask.

---

## Other project rules

- **Never edit `CHANGELOG.md` by hand** when the release script could do it.
  The script keeps the file shape canonical (Keep-a-Changelog) and avoids
  merge-conflict-prone manual entries.
- **Never edit the `version` field in `package.json` by hand.** Always go
  through `npm run release` so the changelog and version stay in sync.
- **Never skip the build step** unless you have a specific reason (e.g. the
  change is server-only and you've verified manually that `web/dist` doesn't
  need updating). When in doubt, run the build.
- **Don't push to `main` / `master` automatically** — the release script
  commits but does not push. Leave that decision to the human operator. Same
  applies to `npm run publish:release` (see above).
- **README download links auto-update.** `scripts/release.mjs` rewrites every
  `Aramis-<version>.dmg` / `Aramis-<version>-arm64.dmg` URL in `README.md`
  during a version bump. If you change the asset naming scheme in
  `package.json`'s electron-builder block, update `scripts/release.mjs` too —
  otherwise the README will silently drift.
- The in-app **Changelog & Version** page (`/changelog`) reads `CHANGELOG.md`
  live via `/api/changelog`. It auto-refreshes whenever the file changes on
  disk — no extra work needed.
- The in-app **Updates** card (Settings) hits `/api/update/check`, which
  proxies the GitHub Releases API and caches results server-side for 30
  minutes. After publishing a release, the banner appears in the chat on the
  next page load (or 30 min later for stale clients).

---

## Architecture pointers (so you don't have to re-discover them)

- Backend: Express + SQLite (better-sqlite3) in [server/src/](server/src/).
- Frontend: Vue 3 + Vite + Tailwind in [web/src/](web/src/). Build output lives
  in [web/dist/](web/dist/) and is served by Express in production.
- Native modules (`bcrypt`, `better-sqlite3`) ship pre-built for x86_64 from
  npm; on Apple Silicon run
  `arch -arm64 npm rebuild --build-from-source bcrypt better-sqlite3` after
  install.
- Chat history persists in SQLite. Each chat has a `mode` column
  (`aramis` | `claude` | `codex`) and the agent loop dispatches on it.
- Agent backends:
  - `services/agent.js` — Aramis's own Plan → Investigate → Execute loop.
  - `services/cli-runner.js` — spawns external `claude` / `codex` CLIs and
    translates their output into the same SSE protocol.
- All `/api/*` endpoints (except `/api/auth/setup` and `/api/auth/login`)
  require a JWT Bearer token.

---

## Tone

This project ships in **Persian and English**. When adding user-facing strings
to [web/src/lib/i18n.js](web/src/lib/i18n.js), add **both** locales. Don't
default-stub one and leave the other untranslated.
