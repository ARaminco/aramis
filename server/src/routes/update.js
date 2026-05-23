// GET /api/update/check
//
// Compares the running version (from package.json) against the latest
// published GitHub Release for ARaminco/aramis. Results are cached in-memory
// for 30 minutes to stay well under GitHub's 60-req/hour anonymous limit.
//
// Response shape:
//   {
//     current: "0.5.7",
//     latest:  "0.6.0",
//     update_available: true,
//     html_url: "https://github.com/ARaminco/aramis/releases/tag/v0.6.0",
//     tag: "v0.6.0",
//     published_at: "2026-06-01T12:34:56Z",
//     notes: "…release body (truncated)…",
//     assets: [
//       { name, size, browser_download_url, platform_hint }
//     ],
//     checked_at: 1700000000000,
//   }
//
// Errors fail open: { error: "...", current, update_available: false }. The
// UI treats any error the same as "no update".

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO = process.env.ARAMIS_UPDATE_REPO || 'ARaminco/aramis';
const CACHE_MS = 30 * 60 * 1000;
const NOTES_MAX = 4000;

let cache = { at: 0, data: null };

const PKG_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'package.json'),
  path.resolve(__dirname, '..', '..', 'package.json'),
  path.resolve(process.resourcesPath || process.cwd(), 'package.json'),
];

async function readCurrentVersion() {
  for (const p of PKG_CANDIDATES) {
    try {
      const pkg = JSON.parse(await fs.readFile(p, 'utf8'));
      if (pkg && pkg.version) return String(pkg.version);
    } catch {}
  }
  return null;
}

// Strict semver-ish comparator: returns 1 / 0 / -1 (a vs b). Treats missing
// or unparseable versions as "equal" so we never wrongly suggest updates.
function compareVersions(a, b) {
  const parse = (v) => {
    if (!v) return null;
    const clean = String(v).replace(/^v/, '');
    const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(clean);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const A = parse(a), B = parse(b);
  if (!A || !B) return 0;
  for (let i = 0; i < 3; i++) {
    if (A[i] !== B[i]) return A[i] > B[i] ? 1 : -1;
  }
  return 0;
}

function platformHint(name) {
  const lower = name.toLowerCase();
  if (/\.dmg$/.test(lower) && /arm64/.test(lower)) return 'macos-arm64';
  if (/\.dmg$/.test(lower)) return 'macos-x64';
  if (/setup-.*\.exe$/.test(lower) || /\.msi$/.test(lower)) return 'windows';
  if (/\.appimage$/.test(lower)) return 'linux-appimage';
  if (/\.deb$/.test(lower)) return 'linux-deb';
  if (/\.rpm$/.test(lower)) return 'linux-rpm';
  if (/\.tar\.gz$/.test(lower) || /\.tgz$/.test(lower)) return 'linux-tar';
  return 'other';
}

async function fetchLatest() {
  // Node 20+ has global fetch. Set a short timeout so a stalled GitHub call
  // doesn't make /api/update/check hang the UI.
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `aramis-update-check/${REPO}`,
      },
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`github responded ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const updateRouter = Router();
updateRouter.use(requireAuth);

updateRouter.get('/check', async (req, res) => {
  const current = await readCurrentVersion();
  const force = req.query.refresh === '1';
  const now = Date.now();

  if (!force && cache.data && (now - cache.at) < CACHE_MS) {
    return res.json({ ...cache.data, current, cached: true });
  }

  try {
    const release = await fetchLatest();
    const tag = String(release.tag_name || '').trim();
    const latest = tag.replace(/^v/, '');
    const cmp = compareVersions(latest, current);
    const data = {
      current,
      latest,
      tag,
      update_available: cmp > 0,
      html_url: release.html_url || `https://github.com/${REPO}/releases/latest`,
      published_at: release.published_at || null,
      notes: typeof release.body === 'string' ? release.body.slice(0, NOTES_MAX) : '',
      assets: (release.assets || []).map((a) => ({
        name: a.name,
        size: a.size,
        browser_download_url: a.browser_download_url,
        platform_hint: platformHint(a.name || ''),
      })),
      checked_at: now,
    };
    cache = { at: now, data };
    res.json({ ...data, cached: false });
  } catch (e) {
    // Fail-open: tell the UI we couldn't check but don't claim an update.
    res.json({
      current,
      latest: null,
      update_available: false,
      error: e.message || 'check failed',
      checked_at: now,
      cached: false,
    });
  }
});
