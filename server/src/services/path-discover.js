// Robust binary discovery — never trust `process.env.PATH` alone, especially
// inside packaged Electron apps where the GUI inherits a minimal PATH that
// excludes Homebrew, nvm, Volta, asdf, Herd, etc.
//
// Strategy (in order of preference):
//   1. process.env.PATH (whatever the main process already has)
//   2. Login-shell expansion via $SHELL (best-effort; tries several flag combos
//      because some users have rc files that hang on -i)
//   3. Known fixed locations per platform
//   4. Discovered locations under $HOME (nvm versions, Volta, fnm, asdf, …)
//
// All four sources are merged and de-duplicated. The resulting PATH is cached
// per process (cleared on demand if a user-action plausibly changed it).

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PLATFORM = process.platform;
const HOME = os.homedir();
const SEP = path.delimiter; // ':' on POSIX, ';' on Windows

let cached = null;

export function clearPathCache() { cached = null; }

// ---- 1. Existing PATH ---------------------------------------------------
function fromEnv() {
  return (process.env.PATH || '').split(SEP).filter(Boolean);
}

// ---- 2. Login-shell expansion -------------------------------------------
function fromLoginShell() {
  if (PLATFORM === 'win32') return [];
  const shells = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/bash'].filter(Boolean);
  for (const sh of shells) {
    if (!existsSync(sh)) continue;
    // Try interactive+login first, then login-only, then plain login.
    for (const flags of ['-ilc', '-lc', '-c']) {
      try {
        const cmd = `${sh} ${flags} 'echo "__ARAMIS_PATH_START__$PATH__ARAMIS_PATH_END__"'`;
        const out = execSync(cmd, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
        const m = /__ARAMIS_PATH_START__([\s\S]*?)__ARAMIS_PATH_END__/.exec(out);
        if (m && m[1] && m[1].includes('/')) return m[1].trim().split(':').filter(Boolean);
      } catch { /* try next combination */ }
    }
  }
  return [];
}

// ---- 3. Known fixed locations -------------------------------------------
function fixedLocations() {
  if (PLATFORM === 'win32') {
    return [
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\Git\\bin',
      'C:\\ProgramData\\chocolatey\\bin',
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'nodejs'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm'),
      path.join(HOME, '.volta', 'bin'),
      path.join(HOME, 'scoop', 'shims'),
      path.join(HOME, 'scoop', 'apps'),
    ].filter(Boolean);
  }
  return [
    // System defaults
    '/usr/local/bin', '/usr/local/sbin',
    '/usr/bin', '/usr/sbin',
    '/bin', '/sbin',
    // Homebrew
    '/opt/homebrew/bin', '/opt/homebrew/sbin',
    '/home/linuxbrew/.linuxbrew/bin', '/home/linuxbrew/.linuxbrew/sbin',
    // Linux managers / Snap / Flatpak
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    // User-local
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, 'bin'),
    path.join(HOME, '.cargo', 'bin'),
    path.join(HOME, 'go', 'bin'),
    // Version managers
    path.join(HOME, '.volta', 'bin'),
    path.join(HOME, '.bun', 'bin'),
    path.join(HOME, '.deno', 'bin'),
    path.join(HOME, '.rye', 'shims'),
    path.join(HOME, '.fnm'),
    // npm global on user-prefix installs
    path.join(HOME, '.npm-global', 'bin'),
    path.join(HOME, '.yarn', 'bin'),
    path.join(HOME, '.config', 'yarn', 'global', 'node_modules', '.bin'),
  ];
}

// ---- 4. Discovered locations under $HOME -------------------------------
function discoveredLocations() {
  const out = [];
  // nvm versions (active + all installed)
  const nvmRoots = [
    path.join(HOME, '.nvm', 'versions', 'node'),
    // Laravel Herd ships its own nvm
    path.join(HOME, 'Library', 'Application Support', 'Herd', 'config', 'nvm', 'versions', 'node'),
    // n
    '/usr/local/n/versions/node',
  ];
  for (const root of nvmRoots) {
    try {
      const versions = readdirSync(root).filter((v) => v.startsWith('v')).sort().reverse();
      for (const v of versions) out.push(path.join(root, v, 'bin'));
    } catch {}
  }
  // asdf shims
  try {
    if (existsSync(path.join(HOME, '.asdf', 'shims'))) out.push(path.join(HOME, '.asdf', 'shims'));
  } catch {}
  // pipx user installs
  try {
    if (existsSync(path.join(HOME, '.local', 'pipx', 'venvs'))) out.push(path.join(HOME, '.local', 'bin'));
  } catch {}
  return out;
}

// ---- Public: discoverPath() --------------------------------------------
export function discoverPath() {
  if (cached) return cached;
  const seen = new Set();
  const merged = [];
  const add = (p) => {
    if (!p) return;
    if (seen.has(p)) return;
    if (!existsSync(p)) return;
    seen.add(p);
    merged.push(p);
  };
  for (const p of fromEnv())          add(p);
  for (const p of fromLoginShell())   add(p);
  for (const p of fixedLocations())   add(p);
  for (const p of discoveredLocations()) add(p);
  cached = merged.join(SEP);
  return cached;
}

/**
 * Permanently update process.env.PATH so child_process.spawn() calls without
 * an explicit env: also benefit from the discovered locations.
 */
export function applyDiscoveredPath() {
  process.env.PATH = discoverPath();
  return process.env.PATH;
}

/**
 * Find an executable by name. Returns its absolute path or null. Tries common
 * extensions on Windows. Always returns the resolved path so the caller can
 * spawn it directly (no PATH lookup at spawn time).
 */
export function findBin(name) {
  if (!name) return null;
  // Already an absolute path?
  if (path.isAbsolute(name) && existsSync(name)) return name;
  const exts = PLATFORM === 'win32' ? ['.cmd', '.exe', '.bat', '.ps1', ''] : [''];
  for (const dir of discoverPath().split(SEP)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Run a binary by name and capture its first-line stdout. Tolerant of failure
 * — returns null if anything goes wrong. Useful for `<bin> --version`.
 */
export function getVersion(name, args = ['--version'], timeoutMs = 2500) {
  const bin = findBin(name);
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" ${args.map(quote).join(' ')}`, {
      encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.split('\n')[0] || null;
  } catch { return null; }
}

function quote(s) {
  if (s == null) return '';
  if (PLATFORM === 'win32') return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  return /[\s"']/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s;
}
