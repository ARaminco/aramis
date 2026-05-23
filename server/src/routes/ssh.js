import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listAllSshHosts, probeTcp, sshExec } from '../services/ssh-hosts.js';

export const sshRouter = Router();
sshRouter.use(requireAuth);

// All hosts available to the user (~/.ssh/config + known_hosts).
sshRouter.get('/hosts', async (req, res, next) => {
  try { res.json({ hosts: await listAllSshHosts() }); }
  catch (e) { next(e); }
});

// Quick TCP reachability probe — does NOT auth, just checks the port.
sshRouter.post('/probe', async (req, res, next) => {
  try {
    const host = String(req.body?.host || '').trim();
    const port = Number(req.body?.port || 22);
    if (!host) return res.status(400).json({ error: 'host required' });
    const r = await probeTcp(host, port);
    res.json({ host, port, ...r });
  } catch (e) { next(e); }
});

// One-shot remote command. Returns the full stdout/stderr/exit when done.
sshRouter.post('/exec', async (req, res, next) => {
  try {
    const host = String(req.body?.host || '').trim();
    const command = String(req.body?.command || '');
    if (!host || !command) return res.status(400).json({ error: 'host and command required' });
    const timeoutSec = Math.min(Math.max(Number(req.body?.timeout_seconds || 60), 5), 600);
    const result = await sshExec({ host, command, timeoutMs: timeoutSec * 1000 });
    res.json(result);
  } catch (e) { next(e); }
});

// Streaming remote command — SSE so the user can watch the output in real time.
sshRouter.post('/stream', (req, res, next) => {
  try {
    const host = String(req.body?.host || '').trim();
    const command = String(req.body?.command || '');
    if (!host || !command) return res.status(400).json({ error: 'host and command required' });
    const timeoutSec = Math.min(Math.max(Number(req.body?.timeout_seconds || 120), 5), 1800);

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };
    send('start', { host, command });

    sshExec({
      host, command, timeoutMs: timeoutSec * 1000, signal: controller.signal,
      onChunk: (stream, text) => send('output', { stream, text }),
    }).then((result) => {
      send('result', result);
      send('done', {});
      try { res.end(); } catch {}
    }).catch((err) => {
      send('error', { message: err.message || String(err) });
      send('done', {});
      try { res.end(); } catch {}
    });
  } catch (e) { next(e); }
});
