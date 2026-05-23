#!/usr/bin/env node
// node-pty 1.x ships per-platform prebuilds (pty.node + spawn-helper). npm
// installs both but on macOS and Linux the spawn-helper binary sometimes
// ends up without the executable bit (this is a long-standing npm bug with
// extracting prebuilds via tar). Without +x on spawn-helper, every pty.fork
// fails with "posix_spawnp failed".
//
// We run this as a postinstall hook so the Aramis integrated terminal works
// out of the box on a fresh `npm install` — no manual chmod required.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const candidates = [
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
  'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper',
  'node_modules/node-pty/prebuilds/linux-x64/spawn-helper',
  'node_modules/node-pty/prebuilds/linux-arm64/spawn-helper',
];

const fixed = [];
for (const rel of candidates) {
  const full = path.join(ROOT, rel);
  try {
    const st = await fs.stat(full);
    // chmod 0o755 — owner rwx, group/other rx. Idempotent.
    const want = 0o755;
    if ((st.mode & 0o777) !== want) {
      await fs.chmod(full, want);
      fixed.push(rel);
    }
  } catch { /* file absent on this platform — that's fine */ }
}

if (fixed.length) {
  console.log(`[aramis] fix-pty-perms: chmod +x for ${fixed.length} spawn-helper binary(ies).`);
}
