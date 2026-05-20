import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { db, listMemory, getSetting } from '../db.js';
import { detectSystem } from './system-info.js';
import { runCommand } from './tools.js';
import { pingProvider } from './ai-provider.js';

const PASS = 'pass';
const FAIL = 'fail';
const SKIP = 'skip';

function entry(id, status, fields = {}) {
  return { id, status, ...fields };
}

async function timed(fn) {
  const t = Date.now();
  try { return { ok: true, result: await fn(), latency_ms: Date.now() - t }; }
  catch (e) { return { ok: false, error: e?.message || String(e), latency_ms: Date.now() - t }; }
}

export async function runDiagnostics() {
  const results = [];

  // 1) Server runtime
  results.push(entry('server', PASS, {
    latency_ms: 0,
    details: `node ${process.version} · pid ${process.pid} · uptime ${Math.floor(process.uptime())}s`,
  }));

  // 2) DB read
  const r1 = await timed(() => Promise.resolve(db.prepare('SELECT 1 AS x').get()));
  results.push(entry('db_read', r1.ok ? PASS : FAIL, { latency_ms: r1.latency_ms, error: r1.error }));

  // 3) DB write+delete (in a temporary settings row)
  const r2 = await timed(() => {
    const k = `__diag__${Date.now()}`;
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(k, 'ok', Date.now());
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    db.prepare('DELETE FROM settings WHERE key = ?').run(k);
    if (!row || row.value !== 'ok') throw new Error('round-trip mismatch');
    return true;
  });
  results.push(entry('db_write', r2.ok ? PASS : FAIL, { latency_ms: r2.latency_ms, error: r2.error }));

  // 4) System detection
  const r3 = await timed(() => detectSystem());
  results.push(entry('system_detect', r3.ok ? PASS : FAIL, {
    latency_ms: r3.latency_ms,
    details: r3.ok ? `${r3.result.osName} · ${r3.result.arch} · ${r3.result.cpu?.cores}c · ${r3.result.memoryGB}GB` : undefined,
    error: r3.error,
  }));

  // 5) File I/O round trip
  const r4 = await timed(async () => {
    const p = path.join(os.tmpdir(), `aramis-diag-${Date.now()}.txt`);
    const payload = 'aramis-' + Math.random().toString(36).slice(2);
    await fs.writeFile(p, payload, 'utf8');
    const text = await fs.readFile(p, 'utf8');
    await fs.unlink(p);
    if (text !== payload) throw new Error('content mismatch');
    return p;
  });
  results.push(entry('file_io', r4.ok ? PASS : FAIL, { latency_ms: r4.latency_ms, error: r4.error }));

  // 6) Shell execution
  const r5 = await timed(async () => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'echo aramis' : 'echo aramis';
    const r = await runCommand({ command: cmd, timeout_seconds: 5 });
    if (!r.ok) throw new Error(`exit ${r.exit_code}: ${(r.stderr || '').trim() || 'no stderr'}`);
    return r.stdout.trim();
  });
  results.push(entry('shell', r5.ok ? PASS : FAIL, {
    latency_ms: r5.latency_ms,
    details: r5.ok ? `echo → "${r5.result}"` : undefined,
    error: r5.error,
  }));

  // 7) Memory subsystem
  const r6 = await timed(() => listMemory().length);
  results.push(entry('memory', r6.ok ? PASS : FAIL, {
    latency_ms: r6.latency_ms,
    details: r6.ok ? `${r6.result} entries` : undefined,
    error: r6.error,
  }));

  // 8) AI config
  const aiConfig = getSetting('ai');
  const needsKey = aiConfig && aiConfig.provider !== 'ollama';
  const aiOk = aiConfig && aiConfig.model && (!needsKey || aiConfig.api_key);
  results.push(entry('ai_config', aiOk ? PASS : FAIL, {
    details: aiOk ? `${aiConfig.provider} · ${aiConfig.model}` : undefined,
    error: aiOk ? undefined : 'AI provider is not configured. Open Settings → AI provider.',
  }));

  // 9) AI connectivity ping
  if (!aiOk) {
    results.push(entry('ai_ping', SKIP, { details: 'skipped — configure AI first' }));
  } else {
    const r7 = await timed(() => pingProvider({ config: aiConfig, timeoutMs: 20_000 }));
    const text = (r7.result || '').replace(/\s+/g, ' ').slice(0, 80);
    results.push(entry('ai_ping', r7.ok ? PASS : FAIL, {
      latency_ms: r7.latency_ms,
      details: r7.ok ? `reply: "${text}"` : undefined,
      error: r7.error,
    }));
  }

  const passed = results.filter((r) => r.status === PASS).length;
  const failed = results.filter((r) => r.status === FAIL).length;
  const skipped = results.filter((r) => r.status === SKIP).length;
  return { results, total: results.length, passed, failed, skipped, when: Date.now() };
}
