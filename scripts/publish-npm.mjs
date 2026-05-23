#!/usr/bin/env node
// Build + publish the npm package for Aramis.
//
// The repo's root package.json is the Electron + monorepo manifest. The npm
// package we publish is a *trimmed* derivative with:
//   - name: @araminco/aramis (scoped)
//   - bin: aramis → bin/aramis.mjs
//   - only the runtime files (server/, web/dist/, bin/, scripts/fix-pty-perms.mjs)
//   - no electron-builder config (huge irrelevant payload)
//   - dependencies copied verbatim (so node-pty, bcrypt, better-sqlite3 etc.
//     install with their per-platform prebuilds)
//
// We assemble that in a temporary directory and run `npm publish` from there
// so the source tree is never mutated.
//
// Usage:
//   npm run publish:npm                 # interactive confirm + publish
//   npm run publish:npm -- --yes        # skip prompt
//   npm run publish:npm -- --dry-run    # build the bundle, print files, no publish
//   npm run publish:npm -- --tag next   # publish under a dist-tag
//   npm run publish:npm -- --otp 123456 # 2FA code (or set NPM_OTP env)

import { readFile, writeFile, mkdir, cp, rm, readdir, stat } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const NPM_NAME = process.env.ARAMIS_NPM_NAME || '@araminco/aramis';

const flags = { yes: false, dryRun: false, tag: 'latest', otp: process.env.NPM_OTP || null, keepDir: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  switch (a) {
    case '-y': case '--yes':       flags.yes = true; break;
    case '--dry-run': case '--dry': flags.dryRun = true; break;
    case '--tag':                   flags.tag = args[++i] || 'latest'; break;
    case '--otp':                   flags.otp = args[++i] || null; break;
    case '--keep':                  flags.keepDir = true; break;
    case '-h': case '--help':       printUsage(); process.exit(0); break;
    default:
      console.error(`unknown flag: ${a}`); printUsage(); process.exit(2);
  }
}

function printUsage() {
  console.log(`Aramis — publish-npm

Usage:
  npm run publish:npm                interactive confirm + publish to ${NPM_NAME}
  npm run publish:npm -- --yes       skip prompt
  npm run publish:npm -- --dry-run   build only (no publish)
  npm run publish:npm -- --tag next  publish under a dist-tag (default: latest)
  npm run publish:npm -- --otp 123456  2FA code (or NPM_OTP env)
  npm run publish:npm -- --keep      don't delete the temp build dir
`);
}

const TTY = process.stdout.isTTY;
const c = (code) => (s) => TTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const dim = c('2'), red = c('31'), green = c('32'), yellow = c('33'), cyan = c('36'), bold = c('1');

function sh(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString();
}
function shTry(cmd, argv, opts = {}) {
  try { return { ok: true, out: sh(cmd, argv, opts) }; }
  catch (e) { return { ok: false, out: '', err: e.message, stderr: (e.stderr || '').toString() }; }
}
function shStream(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
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

async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  const rootPkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const version = rootPkg.version;
  if (!version) { console.error(red('✗ package.json has no version')); process.exit(1); }

  // 1. Sanity — web bundle exists?
  const distDir = path.join(ROOT, 'web', 'dist');
  if (!await pathExists(path.join(distDir, 'index.html'))) {
    console.error(red('✗ web/dist/index.html not found — run `npm run build:web` first.'));
    process.exit(1);
  }

  // 2. Build the publish-ready package.json
  //    NOTE: bin scripts use ./ paths relative to package root after publish.
  const publishPkg = {
    name: NPM_NAME,
    version,
    description: rootPkg.description,
    license: rootPkg.license,
    author: rootPkg.author,
    homepage: rootPkg.homepage,
    repository: rootPkg.repository,
    bugs: rootPkg.bugs,
    keywords: rootPkg.keywords,
    type: 'module',
    main: 'server/src/index.js',
    bin: { aramis: './bin/aramis.mjs' },
    files: [
      'bin/',
      'server/',
      'web/dist/',
      'scripts/fix-pty-perms.mjs',
      'CHANGELOG.md',
      'LICENSE',
      'README.md',
    ],
    engines: { node: '>=20.0.0' },
    // node-pty 1.x ships prebuilds but the spawn-helper bit needs to be set
    // on each fresh install; we re-use the same script the monorepo uses.
    scripts: {
      postinstall: 'node scripts/fix-pty-perms.mjs',
    },
    // Dependencies are copied as-is so prebuilt natives still resolve.
    dependencies: rootPkg.dependencies,
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  };

  // 3. Stage into a temp directory.
  const stageDir = path.join(os.tmpdir(), `aramis-npm-${version}-${Date.now()}`);
  console.log(`\n${cyan('—— publish-npm ——')}`);
  console.log(`Package    : ${bold(NPM_NAME)}@${green(version)}`);
  console.log(`Tag        : ${flags.tag}`);
  console.log(`Stage dir  : ${stageDir}`);
  console.log(`Dry-run    : ${flags.dryRun ? yellow('yes') : 'no'}`);

  await mkdir(stageDir, { recursive: true });
  await writeFile(path.join(stageDir, 'package.json'), JSON.stringify(publishPkg, null, 2) + '\n');

  // Files we always want in the npm tarball.
  const COPY = [
    'bin',
    'server',
    'web/dist',
    'scripts/fix-pty-perms.mjs',
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
  ];

  // Patterns to skip during recursive copy — gitignored runtime files,
  // editor cruft, test scratch dirs. Matches against the *basename* OR a
  // path segment so `server/data/anything` is dropped regardless of depth.
  const SKIP_BASENAMES = new Set([
    'aramis.db', 'aramis.db-journal', 'aramis.db-wal', 'aramis.db-shm',
    '.jwt-secret', '.DS_Store', '.env', '.env.local',
    'data', // drop server/data/ entirely — it's a runtime dir
  ]);
  function filter(src) {
    const base = path.basename(src);
    if (SKIP_BASENAMES.has(base)) return false;
    // Drop .env.local, .env.production, etc. but keep .env.example as docs.
    if (base.startsWith('.env.') && base !== '.env.example') return false;
    return true;
  }

  for (const rel of COPY) {
    const src = path.join(ROOT, rel);
    const dst = path.join(stageDir, rel);
    if (!await pathExists(src)) {
      console.warn(yellow(`  • skipping missing ${rel}`));
      continue;
    }
    await mkdir(path.dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: true, filter });
  }

  // Make sure bin script is executable (in case file mode was lost via cp).
  try { execFileSync('chmod', ['+x', path.join(stageDir, 'bin/aramis.mjs')]); } catch {}

  // 4. Print what's about to ship.
  console.log(`\n${dim('Files in tarball:')}`);
  const proc = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: stageDir, encoding: 'utf8' });
  if (proc.status === 0) {
    try {
      const j = JSON.parse(proc.stdout);
      const info = Array.isArray(j) ? j[0] : j;
      const totalKb = ((info.size || info.unpackedSize || 0) / 1024).toFixed(1);
      console.log(`  ${green('✓')} ${info.filename || `${NPM_NAME.replace('/', '-').replace('@', '')}-${version}.tgz`}  (${totalKb} kB packed)`);
      const files = info.files || [];
      const max = Math.min(files.length, 25);
      for (let i = 0; i < max; i++) {
        console.log(`     ${dim('-')} ${files[i].path} ${dim(`(${files[i].size}b)`)}`);
      }
      if (files.length > max) console.log(`     ${dim(`… and ${files.length - max} more`)}`);
    } catch {
      console.log(proc.stdout.split('\n').slice(0, 15).join('\n'));
    }
  } else {
    console.warn(yellow('  ! npm pack --dry-run failed; continuing anyway'));
    if (proc.stderr) console.warn(proc.stderr);
  }

  if (flags.dryRun) {
    console.log(`\n${yellow('--dry-run')} — staged at ${cyan(stageDir)}; not publishing.`);
    if (!flags.keepDir) {
      try { await rm(stageDir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  // 5. Confirm.
  if (!await confirm(`\nPublish ${bold(NPM_NAME)}@${version} to npm registry?`)) {
    console.log(dim('aborted.'));
    if (!flags.keepDir) { try { await rm(stageDir, { recursive: true, force: true }); } catch {} }
    process.exit(1);
  }

  // 6. Auth probe.
  const whoami = shTry('npm', ['whoami']);
  if (!whoami.ok) {
    console.error(red(`\n✗ Not logged into npm. Run ${cyan('npm login')} first (with an account that has publish access to ${NPM_NAME}).`));
    if (!flags.keepDir) { try { await rm(stageDir, { recursive: true, force: true }); } catch {} }
    process.exit(1);
  }
  console.log(dim(`(logged in as ${whoami.out.trim()})`));

  // 7. Publish.
  const pubArgs = ['publish', '--access', 'public', '--tag', flags.tag];
  if (flags.otp) pubArgs.push('--otp', flags.otp);
  console.log(dim(`› npm ${pubArgs.join(' ')}`));
  shStream('npm', pubArgs, { cwd: stageDir });

  console.log(green(`\n ✓ published ${NPM_NAME}@${version} (tag: ${flags.tag})`));
  console.log(`   ${dim('Install:')}  ${cyan(`npm i -g ${NPM_NAME}`)}`);
  console.log(`   ${dim('Run:')}      ${cyan(`npx ${NPM_NAME}`)}`);
  console.log(`   ${dim('Browse:')}   ${cyan(`https://www.npmjs.com/package/${NPM_NAME}`)}`);

  // 8. Cleanup.
  if (!flags.keepDir) {
    try { await rm(stageDir, { recursive: true, force: true }); } catch {}
  } else {
    console.log(dim(`(stage dir kept at ${stageDir})`));
  }
}

main().catch((e) => { console.error(red(`✗ ${e.message}`)); process.exit(1); });
