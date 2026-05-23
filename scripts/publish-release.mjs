#!/usr/bin/env node
// Aramis — publish a GitHub release.
//
// Run this AFTER `npm run release` has cut the version locally. It does NOT
// touch the working tree or package.json. It just:
//
//   1. Reads the current version from package.json.
//   2. Confirms (unless --yes) that the HEAD commit is the matching
//      `release: vX.Y.Z` commit, so we never tag a stale version.
//   3. Pushes the configured branch (default `main`) to `origin`.
//   4. Creates the local `vX.Y.Z` tag if it doesn't exist, then pushes it.
//   5. Prints the GitHub Actions release-build URL so the user can watch the
//      installers being uploaded.
//
// The tag push triggers `.github/workflows/release.yml`, which builds the
// macOS DMGs, Windows NSIS installer, and Linux AppImage and attaches them to
// the GitHub Release.
//
// Usage:
//   npm run publish:release                # asks for confirmation
//   npm run publish:release -- --yes       # skip confirmation
//   npm run publish:release -- --branch main --remote origin
//   npm run publish:release -- --dry-run   # print what would happen

import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const flags = { yes: false, dryRun: false, branch: 'main', remote: 'origin' };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case '--yes':     case '-y': flags.yes = true; break;
    case '--dry-run': case '--dry': flags.dryRun = true; break;
    case '--branch':  flags.branch = args[++i] || 'main'; break;
    case '--remote':  flags.remote = args[++i] || 'origin'; break;
    case '--help':    case '-h':
      printUsage(); process.exit(0); break;
    default:
      console.error(`unknown flag: ${a}`);
      printUsage(); process.exit(2);
  }
}

function printUsage() {
  console.log(`Aramis publish-release

Usage:
  npm run publish:release                push main + the current version tag
  npm run publish:release -- --yes       no confirmation prompt
  npm run publish:release -- --branch foo --remote upstream
  npm run publish:release -- --dry-run   preview only
`);
}

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();
}
function shTry(cmd, argv, opts = {}) {
  try { return { ok: true, out: sh(cmd, argv, opts) }; }
  catch (e) { return { ok: false, out: '', err: e.message, status: e.status ?? -1, stderr: (e.stderr || '').toString() }; }
}
function shStream(cmd, argv) {
  const r = spawnSync(cmd, argv, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(red(`✗ ${cmd} ${argv.join(' ')} failed (exit ${r.status})`));
    process.exit(r.status || 1);
  }
}

async function confirm(q) {
  if (flags.yes || flags.dryRun) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${q} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function main() {
  // Sanity: inside a git repo?
  const isRepo = shTry('git', ['rev-parse', '--is-inside-work-tree']);
  if (!isRepo.ok || isRepo.out.trim() !== 'true') {
    console.error(red('✗ not a git repository.'));
    process.exit(1);
  }

  // Read version
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  if (!version) { console.error(red('✗ package.json has no version.')); process.exit(1); }
  const tag = `v${version}`;

  // Sanity: working tree clean?
  const status = shTry('git', ['status', '--porcelain']);
  if (status.out.trim()) {
    console.error(red('✗ working tree is dirty. Commit or stash, then re-run.'));
    console.error(status.out);
    process.exit(1);
  }

  // Sanity: HEAD looks like a release commit?
  const head = shTry('git', ['log', '-1', '--pretty=%s']).out.trim();
  const looksLikeRelease = head.startsWith('release: ') && head.includes(tag);
  if (!looksLikeRelease) {
    console.warn(yellow(`⚠ HEAD commit doesn't look like "release: ${tag} — …".`));
    console.warn(yellow(`  Subject: "${head}"`));
    if (!await confirm('Continue anyway?')) {
      console.log(dim('aborted.'));
      process.exit(1);
    }
  }

  // Sanity: tag already exists locally or remotely?
  const localTag = shTry('git', ['rev-parse', '--verify', `refs/tags/${tag}`]);
  if (localTag.ok) {
    console.error(red(`✗ tag ${tag} already exists locally. Bump the version (npm run release) and try again.`));
    process.exit(1);
  }
  const remoteTag = shTry('git', ['ls-remote', '--tags', flags.remote, tag]);
  if (remoteTag.ok && remoteTag.out.trim()) {
    console.error(red(`✗ tag ${tag} already exists on ${flags.remote}. Bump the version and try again.`));
    process.exit(1);
  }

  // Sanity: branch matches?
  const currentBranch = shTry('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  if (currentBranch !== flags.branch) {
    console.warn(yellow(`⚠ current branch is "${currentBranch}", not "${flags.branch}".`));
    if (!await confirm(`Push "${currentBranch}" to ${flags.remote}/${flags.branch} and tag from it?`)) {
      console.log(dim('aborted.'));
      process.exit(1);
    }
  }

  // Preview
  console.log(`\n${cyan('—— Aramis publish-release ——')}`);
  console.log(`Version       : ${version}`);
  console.log(`Tag           : ${tag}`);
  console.log(`Remote/branch : ${flags.remote}/${flags.branch}`);
  console.log(`HEAD subject  : ${head}`);
  if (flags.dryRun) {
    console.log(yellow('(dry-run — no network calls)'));
    return;
  }

  if (!await confirm(`Proceed?`)) { console.log(dim('aborted.')); process.exit(1); }

  // Push the branch
  console.log(dim(`› git push ${flags.remote} ${currentBranch}:${flags.branch}`));
  shStream('git', ['push', flags.remote, `${currentBranch}:${flags.branch}`]);

  // Tag + push tag
  console.log(dim(`› git tag ${tag}`));
  shStream('git', ['tag', tag]);
  console.log(dim(`› git push ${flags.remote} ${tag}`));
  shStream('git', ['push', flags.remote, tag]);

  // Print URLs (best-effort — derive from origin url)
  const remoteUrl = shTry('git', ['remote', 'get-url', flags.remote]).out.trim();
  let webRoot = '';
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remoteUrl || '');
  if (m) webRoot = `https://github.com/${m[1]}/${m[2]}`;

  console.log(green('\n ✓ pushed.'));
  if (webRoot) {
    console.log(`   Actions:   ${webRoot}/actions`);
    console.log(`   Release:   ${webRoot}/releases/tag/${tag}`);
  }
  console.log(dim('   The release-build workflow takes a few minutes to upload installers.'));
}

const TTY = process.stdout.isTTY;
const c = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c('2'), red = c('31'), green = c('32'), yellow = c('33'), cyan = c('36');

main().catch((e) => { console.error(red(`✗ ${e.message}`)); process.exit(1); });
