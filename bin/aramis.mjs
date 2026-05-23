#!/usr/bin/env node
// Aramis CLI launcher — entry point for the npm package.
//
// What this does:
//   1. Loads or generates a persistent JWT secret under ~/.aramis/.jwt-secret
//      (mode 600) so users don't have to think about it.
//   2. Picks a database path under ~/.aramis/aramis.db unless DB_PATH is set.
//   3. Imports server/src/index.js and starts the embedded Express server.
//   4. Prints the URL and (unless --no-open) launches the system browser.
//   5. Cleans up the server on SIGINT/SIGTERM.
//
// CLI flags:
//   --port <n>       Override PORT (default 5174 or $PORT env)
//   --host <addr>    Bind address note (informational only; server picks)
//   --no-open        Don't auto-launch the browser
//   --data-dir <p>   Override ARAMIS_HOME (default ~/.aramis)
//   --help / -h
//   --version / -v
//
// Environment:
//   PORT, JWT_SECRET, DB_PATH, ARAMIS_HOME, CORS_ORIGIN, ARAMIS_FS_ROOT
//   are all honored — flags override env, env overrides defaults.

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(__dirname, '..', 'package.json');

// ---- args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = { open: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case '--port':     flags.port = argv[++i]; break;
    case '--host':     flags.host = argv[++i]; break;
    case '--no-open':  flags.open = false; break;
    case '--data-dir': flags.dataDir = argv[++i]; break;
    case '-v': case '--version': printVersion(); process.exit(0);
    case '-h': case '--help':    printHelp();    process.exit(0);
    default:
      if (a.startsWith('-')) {
        console.error(`unknown flag: ${a}\nrun 'aramis --help' for options.`);
        process.exit(2);
      }
  }
}

function printHelp() {
  console.log(`Aramis — AI terminal agent for DevOps, sysadmin, SSH, Git, FTP, and local automation.

Usage:
  aramis [options]

Options:
  --port <n>         Port to bind (default: 5174, env: PORT)
  --no-open          Don't auto-launch the system browser
  --data-dir <path>  Directory for DB + JWT secret (default: ~/.aramis, env: ARAMIS_HOME)
  -v, --version      Show version
  -h, --help         Show this help

Environment overrides:
  PORT, JWT_SECRET, DB_PATH, ARAMIS_HOME, CORS_ORIGIN, ARAMIS_FS_ROOT

Examples:
  aramis                              # start on port 5174, open browser
  aramis --port 8080                  # start on port 8080
  aramis --no-open --port 5174        # start headless (server only)
  PORT=3000 aramis                    # same as --port 3000
  ARAMIS_HOME=/srv/aramis aramis      # custom data directory

Project: https://github.com/ARaminco/aramis
`);
}

async function printVersion() {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(PKG_PATH, 'utf8'));
    console.log(pkg.version || '0.0.0');
  } catch { console.log('unknown'); }
}

// ---- data dir + secret --------------------------------------------------
const dataDir = flags.dataDir || process.env.ARAMIS_HOME || path.join(os.homedir(), '.aramis');
try { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); }
catch (e) { console.error(`could not create data dir ${dataDir}: ${e.message}`); process.exit(1); }

const secretFile = path.join(dataDir, '.jwt-secret');
let secret = process.env.JWT_SECRET;
if (!secret) {
  try {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
    if (!secret || secret.length < 32) throw new Error('too short');
  } catch {
    secret = crypto.randomBytes(48).toString('hex');
    try {
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    } catch (e) {
      console.error(`could not write JWT secret to ${secretFile}: ${e.message}`);
      process.exit(1);
    }
  }
}

// Push env so the embedded server picks them up.
process.env.JWT_SECRET = secret;
process.env.DB_PATH    = process.env.DB_PATH || path.join(dataDir, 'aramis.db');
process.env.PORT       = String(flags.port || process.env.PORT || 5174);
// Web bundle is co-located inside the published package.
const staticDir = path.resolve(__dirname, '..', 'web', 'dist');

// ---- boot ---------------------------------------------------------------
const SERVER_ENTRY = path.resolve(__dirname, '..', 'server', 'src', 'index.js');

let server;
try {
  const mod = await import(SERVER_ENTRY);
  if (typeof mod.startServer !== 'function') {
    throw new Error('server module does not export startServer()');
  }
  server = await mod.startServer({ staticDir });
} catch (e) {
  console.error(`\n✗ Aramis failed to start: ${e.message}\n`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
}

const url = `http://127.0.0.1:${server.port}/`;

// Friendly banner. ANSI colors degrade to plain text when not a TTY.
const tty = process.stdout.isTTY;
const c = (code) => (s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const bold = c('1'), dim = c('2'), green = c('32'), cyan = c('36');

console.log(`\n${green('●')} ${bold('Aramis')} is running at ${cyan(url)}\n`);
console.log(`  ${dim('Data:')}     ${dataDir}`);
console.log(`  ${dim('DB:')}       ${process.env.DB_PATH}`);
console.log(`  ${dim('Stop:')}     Ctrl-C\n`);

if (flags.open && process.stdout.isTTY) openInBrowser(url);

function openInBrowser(target) {
  const cmd = process.platform === 'darwin' ? ['open', target]
    : process.platform === 'win32'           ? ['cmd', '/c', 'start', '""', target]
    : ['xdg-open', target];
  try {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true });
    child.on('error', () => { /* user can copy the URL from the banner */ });
    child.unref();
  } catch { /* same */ }
}

async function shutdown(signal) {
  console.log(`\n${dim(`received ${signal}, shutting down…`)}`);
  try { await server?.close?.(); } catch {}
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP',  () => shutdown('SIGHUP'));
