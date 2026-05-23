// Install / uninstall coding-agent CLIs (Claude Code, OpenAI Codex, Gemini, …)
// using whichever package manager the host already has. We don't bundle a
// package manager — we detect npm / brew / pipx / curl-bash and let the user
// pick whichever they prefer.
//
// Each install plan is a small array of named steps: { label, cmd, args }.
// We run them in series, streaming stdout/stderr live via the caller-supplied
// onChunk, and resolve with a final { ok, exit_code, killed } summary.

import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const WHICH = process.platform === 'win32' ? 'where' : 'which';

function which(bin) {
  try {
    const out = execFileSync(WHICH, [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }).trim();
    return out.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

// ---- Package-manager detection -----------------------------------------

export function detectInstallers() {
  const candidates = [
    { id: 'npm',  bin: 'npm',   name: 'npm (Node.js)', kind: 'node' },
    { id: 'pnpm', bin: 'pnpm',  name: 'pnpm',          kind: 'node' },
    { id: 'yarn', bin: 'yarn',  name: 'Yarn',          kind: 'node' },
    { id: 'brew', bin: 'brew',  name: 'Homebrew',      kind: 'system' },
    { id: 'winget', bin: 'winget', name: 'winget',     kind: 'system' },
    { id: 'choco',  bin: 'choco',  name: 'Chocolatey', kind: 'system' },
    { id: 'curl', bin: 'curl',  name: 'curl (script install)', kind: 'script' },
    { id: 'pipx', bin: 'pipx',  name: 'pipx',          kind: 'python' },
  ];
  return candidates.map((c) => {
    const path_ = which(c.bin);
    return { ...c, installed: !!path_, path: path_ };
  });
}

// ---- Install plans per tool --------------------------------------------
//
// Each plan key is a package-manager id; the value is a list of named steps.
// We always end with a `verify` step that runs `<bin> --version` so the user
// sees the freshly-installed version.

function npmInstall(pkg, bin) {
  return [
    { label: 'install', cmd: 'npm', args: ['install', '-g', pkg, '--loglevel=error'] },
    { label: 'verify',  cmd: bin,   args: ['--version'] },
  ];
}
function pnpmInstall(pkg, bin) {
  return [
    { label: 'install', cmd: 'pnpm', args: ['add', '-g', pkg] },
    { label: 'verify',  cmd: bin,    args: ['--version'] },
  ];
}
function yarnInstall(pkg, bin) {
  return [
    { label: 'install', cmd: 'yarn', args: ['global', 'add', pkg] },
    { label: 'verify',  cmd: bin,    args: ['--version'] },
  ];
}
function brewInstall(formula, bin) {
  return [
    { label: 'install', cmd: 'brew', args: ['install', formula] },
    { label: 'verify',  cmd: bin,    args: ['--version'] },
  ];
}

const PLANS = {
  claude: {
    name: 'Claude Code',
    bin: 'claude',
    homepage: 'https://docs.anthropic.com/claude/code',
    package_npm: '@anthropic-ai/claude-code',
    plans: {
      npm:  () => npmInstall ('@anthropic-ai/claude-code', 'claude'),
      pnpm: () => pnpmInstall('@anthropic-ai/claude-code', 'claude'),
      yarn: () => yarnInstall('@anthropic-ai/claude-code', 'claude'),
    },
  },
  codex: {
    name: 'OpenAI Codex',
    bin: 'codex',
    homepage: 'https://github.com/openai/codex',
    package_npm: '@openai/codex',
    plans: {
      npm:  () => npmInstall ('@openai/codex', 'codex'),
      pnpm: () => pnpmInstall('@openai/codex', 'codex'),
      yarn: () => yarnInstall('@openai/codex', 'codex'),
      brew: () => brewInstall('codex', 'codex'),
    },
  },
  gemini: {
    name: 'Gemini CLI',
    bin: 'gemini',
    homepage: 'https://github.com/google-gemini/gemini-cli',
    package_npm: '@google/gemini-cli',
    plans: {
      npm:  () => npmInstall ('@google/gemini-cli', 'gemini'),
      pnpm: () => pnpmInstall('@google/gemini-cli', 'gemini'),
      yarn: () => yarnInstall('@google/gemini-cli', 'gemini'),
      brew: () => brewInstall('gemini-cli', 'gemini'),
    },
  },
};

const UNINSTALL_PLANS = {
  claude: {
    npm:  () => [{ label: 'uninstall', cmd: 'npm',  args: ['uninstall', '-g', '@anthropic-ai/claude-code'] }],
    pnpm: () => [{ label: 'uninstall', cmd: 'pnpm', args: ['remove', '-g', '@anthropic-ai/claude-code'] }],
    yarn: () => [{ label: 'uninstall', cmd: 'yarn', args: ['global', 'remove', '@anthropic-ai/claude-code'] }],
  },
  codex: {
    npm:  () => [{ label: 'uninstall', cmd: 'npm',  args: ['uninstall', '-g', '@openai/codex'] }],
    pnpm: () => [{ label: 'uninstall', cmd: 'pnpm', args: ['remove', '-g', '@openai/codex'] }],
    yarn: () => [{ label: 'uninstall', cmd: 'yarn', args: ['global', 'remove', '@openai/codex'] }],
    brew: () => [{ label: 'uninstall', cmd: 'brew', args: ['uninstall', 'codex'] }],
  },
  gemini: {
    npm:  () => [{ label: 'uninstall', cmd: 'npm',  args: ['uninstall', '-g', '@google/gemini-cli'] }],
  },
};

export function getInstallOptions(toolId) {
  const plan = PLANS[toolId];
  if (!plan) return null;
  const installers = detectInstallers();
  const available = Object.keys(plan.plans);
  return {
    tool: toolId,
    name: plan.name,
    homepage: plan.homepage,
    options: available.map((id) => {
      const inst = installers.find((i) => i.id === id);
      return {
        id,
        name: inst?.name || id,
        kind: inst?.kind || 'unknown',
        available: !!inst?.installed,
        path: inst?.path || null,
      };
    }),
  };
}

// ---- Streaming run of a multi-step plan --------------------------------
//
// `onEvent(name, data)` callback styles:
//   step_start  { index, total, label, cmd, args }
//   output      { stream: 'stdout'|'stderr', text }
//   step_done   { index, exit_code, killed }
//   complete    { ok, exit_code }   // final
//
// Returns a promise that resolves when the whole plan finishes.

export function runPlan({ tool, manager, kind = 'install', onEvent, signal }) {
  const planMap = kind === 'install' ? PLANS[tool]?.plans : UNINSTALL_PLANS[tool];
  if (!planMap) {
    onEvent('error', { message: `Unsupported tool: ${tool}` });
    onEvent('complete', { ok: false, exit_code: -1 });
    return Promise.resolve({ ok: false });
  }
  const fn = planMap[manager];
  if (!fn) {
    onEvent('error', { message: `No ${kind} plan for ${tool} via ${manager}` });
    onEvent('complete', { ok: false, exit_code: -1 });
    return Promise.resolve({ ok: false });
  }
  const steps = fn();
  return runSteps(steps, onEvent, signal);
}

async function runSteps(steps, onEvent, signal) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onEvent('step_start', { index: i, total: steps.length, label: step.label, cmd: step.cmd, args: step.args });
    const result = await runStep(step, onEvent, signal);
    onEvent('step_done', { index: i, exit_code: result.exit_code, killed: result.killed });
    if (!result.ok && step.label !== 'verify') {
      onEvent('complete', { ok: false, exit_code: result.exit_code });
      return { ok: false };
    }
  }
  onEvent('complete', { ok: true, exit_code: 0 });
  return { ok: true };
}

function runStep(step, onEvent, signal) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(step.cmd, step.args, {
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      onEvent('output', { stream: 'stderr', text: `failed to spawn ${step.cmd}: ${e.message}\n` });
      return resolve({ ok: false, exit_code: -1, killed: false });
    }
    const abort = () => { try { child.kill('SIGTERM'); } catch {} };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout.on('data', (d) => onEvent('output', { stream: 'stdout', text: d.toString('utf8') }));
    child.stderr.on('data', (d) => onEvent('output', { stream: 'stderr', text: d.toString('utf8') }));
    child.on('error', (e) => {
      onEvent('output', { stream: 'stderr', text: `${e.message}\n` });
      resolve({ ok: false, exit_code: -1, killed: false });
    });
    child.on('close', (code, sig) => {
      resolve({ ok: code === 0, exit_code: code, killed: sig === 'SIGTERM' || sig === 'SIGKILL' });
    });
  });
}
