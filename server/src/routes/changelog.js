// Serves CHANGELOG.md + the current version so the in-app /changelog page can
// render the same content the user sees in their editor. The route is
// auth-gated; no secrets are exposed.

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Candidate locations: dev (repo root, two levels up from server/src/routes),
// Electron production (asar-unpacked or alongside the bundled JS), and also a
// last-resort look at the parent of `electron/`. Whichever exists first wins.
const CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'CHANGELOG.md'),
  path.resolve(__dirname, '..', '..', 'CHANGELOG.md'),
  path.resolve(process.resourcesPath || process.cwd(), 'CHANGELOG.md'),
  path.resolve(process.cwd(), 'CHANGELOG.md'),
];

const PKG_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'package.json'),
  path.resolve(__dirname, '..', '..', 'package.json'),
  path.resolve(process.resourcesPath || process.cwd(), 'package.json'),
];

async function firstReadable(paths) {
  for (const p of paths) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

function parseChangelog(md) {
  // Split into sections by lines starting with `## [`. Each section becomes
  // { version, date?, raw, isUnreleased }.
  const lines = md.split('\n');
  const sections = [];
  let current = null;
  let prelude = [];
  for (const line of lines) {
    const m = /^##\s+\[([^\]]+)\](?:\s+-\s+(\S+))?/i.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = {
        version: m[1],
        date: m[2] || null,
        isUnreleased: m[1].toLowerCase() === 'unreleased',
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    } else {
      prelude.push(line);
    }
  }
  if (current) sections.push(current);
  return {
    prelude: prelude.join('\n').trim(),
    sections: sections.map((s) => ({
      version: s.version,
      date: s.date,
      isUnreleased: s.isUnreleased,
      markdown: s.lines.slice(1).join('\n').trim(),
    })),
  };
}

export const changelogRouter = Router();
changelogRouter.use(requireAuth);

changelogRouter.get('/', async (req, res, next) => {
  try {
    const cfPath = await firstReadable(CANDIDATES);
    const pkgPath = await firstReadable(PKG_CANDIDATES);
    let version = null, name = null;
    if (pkgPath) {
      try {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
        version = pkg.version || null;
        name = pkg.productName || pkg.build?.productName || pkg.name || null;
      } catch {}
    }
    if (!cfPath) {
      return res.json({
        ok: false,
        version,
        name,
        markdown: '',
        parsed: { prelude: '', sections: [] },
        error: 'CHANGELOG.md not bundled',
      });
    }
    const md = await fs.readFile(cfPath, 'utf8');
    const parsed = parseChangelog(md);
    let mtime = null;
    try { mtime = (await fs.stat(cfPath)).mtimeMs; } catch {}
    res.json({
      ok: true,
      version,
      name,
      mtime,
      path: cfPath,
      markdown: md,
      parsed,
    });
  } catch (e) { next(e); }
});
