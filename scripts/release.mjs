#!/usr/bin/env node
// Aramis release tool — single command that:
//   1. Rolls everything under `## [Unreleased]` in CHANGELOG.md into a new
//      dated version section.
//   2. Bumps `package.json` version (patch by default; --minor / --major).
//   3. Appends any positional argument as a new bullet under Unreleased BEFORE
//      the roll, so `npm run release -- "added X"` is the typical AI invocation.
//   4. If nothing has been said about the change, auto-derives a one-line
//      summary from `git diff --stat` on the working tree.
//   5. Rebuilds the web bundle (unless --no-build).
//   6. Stages all changes and creates a single `release: vX.Y.Z — …` commit
//      (unless --no-commit).
//
// Usage examples:
//   npm run release                            # auto-summary, patch bump, build, commit
//   npm run release -- "Added dark-mode toggle"
//   npm run release -- --minor "New mode-switcher"
//   npm run release -- --major "Breaking schema change"
//   npm run release -- --dry-run "Preview only"
//   npm run release -- --no-bump "Just append to Unreleased"
//   npm run release -- --no-build --no-commit "Just update changelog"

import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_FILE = path.join(ROOT, 'package.json');
const LOCK_FILE = path.join(ROOT, 'package-lock.json');
const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const flags = {
  bump: 'patch',
  dryRun: false,
  noCommit: false,
  noBuild: false,
  noBump: false,
};
const positionals = [];
for (const a of args) {
  switch (a) {
    case '--minor':   flags.bump = 'minor'; break;
    case '--major':   flags.bump = 'major'; break;
    case '--patch':   flags.bump = 'patch'; break;
    case '--dry-run': flags.dryRun = true; break;
    case '--dry':     flags.dryRun = true; break;
    case '--no-commit': flags.noCommit = true; break;
    case '--no-build':  flags.noBuild = true; break;
    case '--no-bump':   flags.noBump = true; break;
    case '--help':
    case '-h':
      printUsage();
      process.exit(0);
      break;
    default:
      if (a.startsWith('--')) {
        console.error(`unknown flag: ${a}`);
        printUsage();
        process.exit(2);
      }
      positionals.push(a);
  }
}

const userMessage = positionals.join(' ').trim();

function printUsage() {
  console.log(`Aramis release tool

Usage:
  npm run release                            auto-summary, patch bump, build, commit
  npm run release -- "Description"           description as a bullet
  npm run release -- --minor "..."           minor bump (X.Y+1.0)
  npm run release -- --major "..."           major bump (X+1.0.0)
  npm run release -- --no-bump "..."         just append to Unreleased, no version cut
  npm run release -- --no-build "..."        skip the web build
  npm run release -- --no-commit "..."       skip the git commit
  npm run release -- --dry-run "..."         preview without writing anything
`);
}

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();
}
function shTry(cmd, argv, opts = {}) {
  try { return { ok: true, out: sh(cmd, argv, opts) }; }
  catch (e) { return { ok: false, out: '', err: e.message, status: e.status ?? -1, stderr: e.stderr?.toString() || '' }; }
}

function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bumpVersion(v, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)(.*)?$/.exec(v);
  if (!m) throw new Error(`unparseable version: ${v}`);
  let [, maj, min, pat] = m;
  maj = +maj; min = +min; pat = +pat;
  switch (kind) {
    case 'major': maj += 1; min = 0; pat = 0; break;
    case 'minor': min += 1; pat = 0; break;
    case 'patch':
    default:      pat += 1; break;
  }
  return `${maj}.${min}.${pat}`;
}

// ---------------------------------------------------------------------------
// Auto-summary: when no message is supplied, derive a one-line description
// from `git status` and `git diff --stat HEAD`.

function autoSummary() {
  const status = shTry('git', ['status', '--porcelain']);
  if (!status.ok) return '';
  const lines = status.out.split('\n').filter(Boolean);
  if (lines.length === 0) return '';
  // Count by area
  const buckets = { server: 0, web: 0, electron: 0, scripts: 0, docs: 0, other: 0 };
  for (const l of lines) {
    const file = l.slice(3);
    if      (file.startsWith('server/'))   buckets.server++;
    else if (file.startsWith('web/'))      buckets.web++;
    else if (file.startsWith('electron/')) buckets.electron++;
    else if (file.startsWith('scripts/'))  buckets.scripts++;
    else if (/\.(md|MD)$/.test(file))      buckets.docs++;
    else buckets.other++;
  }
  const parts = [];
  if (buckets.server)   parts.push(`server (${buckets.server})`);
  if (buckets.web)      parts.push(`web (${buckets.web})`);
  if (buckets.electron) parts.push(`electron (${buckets.electron})`);
  if (buckets.scripts)  parts.push(`scripts (${buckets.scripts})`);
  if (buckets.docs)     parts.push(`docs (${buckets.docs})`);
  if (buckets.other)    parts.push(`other (${buckets.other})`);
  return `Updates across ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// CHANGELOG manipulation.
//
// We expect the format:
//
//   ## [Unreleased]
//
//   - bullet
//   - bullet
//
//   ## [0.1.0] - 2026-05-20
//   ...
//
// `cutUnreleased` returns { before, unreleasedBullets, after } so we can:
//   - append a new bullet to `unreleasedBullets`, or
//   - roll the entire block into a new dated version section.

function cutUnreleased(md) {
  const lines = md.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\[unreleased\]/i.test(lines[i])) { start = i; break; }
  }
  if (start === -1) {
    // No Unreleased section — synthesize one right after the first non-heading prelude.
    let insertAt = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^##\s+\[/.test(lines[i])) { insertAt = i; break; }
    }
    const before = lines.slice(0, insertAt).join('\n');
    const after = lines.slice(insertAt).join('\n');
    return { before, unreleased: '', after };
  }
  for (let j = start + 1; j < lines.length; j++) {
    if (/^##\s+\[/.test(lines[j])) { end = j; break; }
  }
  if (end === -1) end = lines.length;
  const before = lines.slice(0, start).join('\n');
  const unreleasedBlock = lines.slice(start + 1, end).join('\n').replace(/^\s+|\s+$/g, '');
  const after = lines.slice(end).join('\n');
  return { before, unreleased: unreleasedBlock, after };
}

function recomposeChangelog({ prelude, unreleased, releasedTail }) {
  const parts = [];
  if (prelude && prelude.trim()) parts.push(prelude.replace(/\s+$/, ''));
  parts.push('## [Unreleased]\n');
  if (unreleased && unreleased.trim()) parts.push(unreleased.trim() + '\n');
  if (releasedTail && releasedTail.trim()) parts.push(releasedTail.replace(/^\s+/, ''));
  // Single trailing newline.
  return parts.join('\n').replace(/\n+$/, '\n') + (parts.length ? '' : '');
}

// ---------------------------------------------------------------------------

async function main() {
  // Resolve current version
  const pkgRaw = await readFile(PKG_FILE, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version;
  const newVersion = flags.noBump ? oldVersion : bumpVersion(oldVersion, flags.bump);

  // Resolve message
  const summary = userMessage || autoSummary() || 'Misc. updates.';

  // Read & mutate changelog
  const md = await readFile(CHANGELOG_FILE, 'utf8').catch(() => '# Changelog\n\n## [Unreleased]\n\n');
  const cut = cutUnreleased(md);

  let nextChangelog;
  if (flags.noBump) {
    // Just add the new bullet to Unreleased — no version section, no date.
    const newUnreleased = (cut.unreleased ? cut.unreleased + '\n' : '') + `- ${summary}`;
    nextChangelog = recomposeChangelog({
      prelude: cut.before,
      unreleased: newUnreleased,
      releasedTail: cut.after,
    });
  } else {
    // Roll Unreleased + new bullet into a new dated version section.
    const allBullets = [cut.unreleased, summary ? `- ${summary}` : ''].filter((s) => s && s.trim()).join('\n').trim();
    const versionHeader = `## [${newVersion}] - ${nowIso()}`;
    const versionBlock = `${versionHeader}\n\n${allBullets || '- (no bullets — auto-generated release)'}\n`;
    // Build the released tail = versionBlock + previously-existing released versions
    const releasedTail = versionBlock + (cut.after && cut.after.trim() ? '\n' + cut.after.replace(/^\s+/, '') : '');
    nextChangelog = recomposeChangelog({
      prelude: cut.before,
      unreleased: '',
      releasedTail,
    });
  }

  // Preview
  console.log(`\n${cyan('—— Aramis release ——')}`);
  console.log(`Current version : ${oldVersion}`);
  if (!flags.noBump) console.log(`New version     : ${green(newVersion)}  (${flags.bump} bump)`);
  else console.log(`Version         : ${oldVersion} (no bump)`);
  console.log(`Summary         : ${summary}`);
  console.log(`Build           : ${flags.noBuild ? 'skipped' : 'yes'}`);
  console.log(`Commit          : ${flags.noCommit ? 'skipped' : 'yes'}`);
  if (flags.dryRun) console.log(yellow(`(dry-run — no files written)`));
  console.log('');

  if (flags.dryRun) {
    console.log(yellow('--- next CHANGELOG.md preview ---'));
    console.log(nextChangelog.split('\n').slice(0, 40).join('\n'));
    console.log(yellow('---------------------------------'));
    return;
  }

  // Write CHANGELOG
  await writeFile(CHANGELOG_FILE, nextChangelog, 'utf8');
  console.log(`${dim('✓')} CHANGELOG.md updated`);

  // Bump package.json
  if (!flags.noBump && newVersion !== oldVersion) {
    pkg.version = newVersion;
    await writeFile(PKG_FILE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`${dim('✓')} package.json bumped to ${newVersion}`);

    const lockRaw = await readFile(LOCK_FILE, 'utf8').catch(() => '');
    if (lockRaw) {
      const lock = JSON.parse(lockRaw);
      lock.version = newVersion;
      if (lock.packages?.['']) lock.packages[''].version = newVersion;
      await writeFile(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n', 'utf8');
      console.log(`${dim('✓')} package-lock.json bumped to ${newVersion}`);
    }
  }

  // Build
  if (!flags.noBuild) {
    console.log(dim('› npm run build:web …'));
    const r = spawnSync('npm', ['run', 'build:web'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(red(`✗ build failed (exit ${r.status}). Files are written but no commit was made.`));
      process.exit(r.status || 1);
    }
    console.log(`${dim('✓')} build completed`);
  }

  // Commit
  if (!flags.noCommit) {
    const repo = shTry('git', ['rev-parse', '--is-inside-work-tree']);
    if (!repo.ok || repo.out.trim() !== 'true') {
      console.warn(yellow('• not a git repository — skipping commit'));
      return;
    }
    const status = shTry('git', ['status', '--porcelain']);
    if (!status.ok || !status.out.trim()) {
      console.log(dim('• git working tree clean — nothing to commit'));
      return;
    }
    sh('git', ['add', '-A']);
    const tag = flags.noBump ? 'chore' : 'release';
    const versionPart = flags.noBump ? '' : `v${newVersion} — `;
    const subject = `${tag}: ${versionPart}${summary.replace(/\s+/g, ' ').slice(0, 90)}`;
    const cm = spawnSync('git', ['commit', '-m', subject], { cwd: ROOT, stdio: 'inherit' });
    if (cm.status !== 0) {
      console.error(red(`✗ git commit failed (exit ${cm.status}).`));
      process.exit(cm.status || 1);
    }
    console.log(`${dim('✓')} committed → ${subject}`);
  }

  console.log(green('\n done.'));
  if (!flags.noBump) {
    console.log(dim('   tip: `git push` when you\'re ready to publish.'));
  }
}

// Pretty colors that degrade to plain text when stdout isn't a TTY.
const TTY = process.stdout.isTTY;
const c = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c('2'), red = c('31'), green = c('32'), yellow = c('33'), cyan = c('36');

main().catch((e) => {
  console.error(red(`✗ release failed: ${e.message}`));
  process.exit(1);
});
