// OS-aware bootstrap recommendations. When NO package manager can be
// discovered, we suggest a single official one-liner per platform that
// installs the canonical package manager (Homebrew on macOS / apt|dnf|pacman
// on Linux / winget on Windows). The user can copy the command or have
// Aramis open their system terminal with the command pre-typed via the
// `openInTerminal` helper below.

import { spawn, execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findBin } from './path-discover.js';

async function detectLinuxDistro() {
  try {
    const text = await fs.readFile('/etc/os-release', 'utf8');
    const obj = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) obj[m[1]] = m[2].replace(/^"|"$/g, '');
    }
    return { id: (obj.ID || '').toLowerCase(), id_like: (obj.ID_LIKE || '').toLowerCase(), name: obj.PRETTY_NAME || obj.NAME };
  } catch { return { id: '', id_like: '', name: 'Linux' }; }
}

/**
 * Return a single, opinionated "do this to bootstrap your system" command
 * for the current platform. The command may require sudo or interactive
 * confirmation; we surface that so the UI can warn the user.
 */
export async function suggestBootstrap() {
  const platform = process.platform;
  if (platform === 'darwin') {
    return {
      platform: 'darwin',
      os_label: 'macOS',
      shell: process.env.SHELL || '/bin/zsh',
      // Homebrew is the canonical macOS package manager. Its official install
      // script prompts for sudo (it adjusts ownership of /opt/homebrew or
      // /usr/local). Once installed, Aramis can use `brew install node`
      // automatically.
      recommendations: [
        {
          id: 'homebrew',
          label: 'Install Homebrew (recommended)',
          command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
          requires_sudo: true,
          requires_tty: true,
          follow_up: 'brew install node',
          docs: 'https://brew.sh/',
          description: 'Installs Homebrew → then `brew install node` gives you npm. Roughly 5 minutes; you\'ll be asked for your password once.',
        },
        {
          id: 'node-official',
          label: 'Install Node.js (universal pkg installer)',
          command: 'open https://nodejs.org/en/download/',
          requires_sudo: false,
          requires_tty: false,
          docs: 'https://nodejs.org/',
          description: 'Opens the Node.js download page in your browser. The macOS .pkg installer adds `node` and `npm` to PATH.',
        },
      ],
    };
  }
  if (platform === 'linux') {
    const distro = await detectLinuxDistro();
    const debianLike = /debian|ubuntu|mint|elementary|pop/.test(distro.id) || /debian/.test(distro.id_like);
    const rhelLike   = /fedora|rhel|centos|rocky|almalinux/.test(distro.id) || /fedora|rhel/.test(distro.id_like);
    const arch       = /arch|manjaro|endeavouros/.test(distro.id) || /arch/.test(distro.id_like);
    const alpine     = /alpine/.test(distro.id);
    const opensuse   = /suse|opensuse/.test(distro.id) || /suse/.test(distro.id_like);
    const recs = [];
    if (debianLike) recs.push({ id: 'apt', label: 'Install Node.js via apt', command: 'sudo apt-get update && sudo apt-get install -y nodejs npm', requires_sudo: true });
    if (rhelLike)   recs.push({ id: 'dnf', label: 'Install Node.js via dnf', command: 'sudo dnf install -y nodejs npm', requires_sudo: true });
    if (arch)       recs.push({ id: 'pacman', label: 'Install Node.js via pacman', command: 'sudo pacman -Sy --noconfirm nodejs npm', requires_sudo: true });
    if (alpine)     recs.push({ id: 'apk', label: 'Install Node.js via apk', command: 'sudo apk add --no-cache nodejs npm', requires_sudo: true });
    if (opensuse)   recs.push({ id: 'zypper', label: 'Install Node.js via zypper', command: 'sudo zypper install -y nodejs npm', requires_sudo: true });
    // Always offer Volta (no sudo) as a fallback
    recs.push({
      id: 'volta',
      label: 'Install Volta (Node.js without sudo)',
      command: 'curl https://get.volta.sh | bash && exec $SHELL -l && volta install node',
      requires_sudo: false,
      docs: 'https://volta.sh/',
      description: 'Lightweight Node.js manager that lives entirely under ~/.volta. No sudo needed.',
    });
    return { platform: 'linux', os_label: distro.name || 'Linux', distro, recommendations: recs };
  }
  if (platform === 'win32') {
    const wingetAvail = !!findBin('winget');
    const chocoAvail  = !!findBin('choco');
    const recs = [];
    if (wingetAvail) recs.push({ id: 'winget', label: 'Install Node.js via winget', command: 'winget install OpenJS.NodeJS.LTS', requires_sudo: false });
    if (chocoAvail)  recs.push({ id: 'choco',  label: 'Install Node.js via Chocolatey', command: 'choco install -y nodejs-lts', requires_sudo: true });
    if (!wingetAvail && !chocoAvail) {
      recs.push({
        id: 'msi',
        label: 'Download Node.js installer',
        command: 'start https://nodejs.org/en/download/',
        requires_sudo: false,
        description: 'Opens the Node.js download page in your browser. Run the .msi to install.',
      });
    }
    return { platform: 'win32', os_label: 'Windows', recommendations: recs };
  }
  return { platform, os_label: platform, recommendations: [] };
}

/**
 * Launch the system's native terminal app with the given command pre-pasted.
 * Strategy by platform:
 *   - macOS:   `osascript -e 'tell app "Terminal" to activate; do script "<cmd>"'`
 *   - Linux:   try x-terminal-emulator → gnome-terminal → konsole → xterm
 *   - Windows: `cmd /c start cmd /k "<cmd>"`
 *
 * Returns { ok, terminal } when the spawn fires (we don't wait for it to
 * close). The command runs visibly so the user can answer any sudo prompts.
 */
export async function openInTerminal(command) {
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'command required' };
  }
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      // Escape double-quotes for AppleScript
      const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const apple = `tell application "Terminal"\nactivate\ndo script "${esc}"\nend tell`;
      const ascript = findBin('osascript') || 'osascript';
      spawn(ascript, ['-e', apple], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, terminal: 'Terminal.app' };
    }
    if (platform === 'linux') {
      const terminals = [
        ['x-terminal-emulator', ['-e', `bash -lc '${command.replace(/'/g, `'\\''`)}; echo; read -p "Press enter to close…"'`]],
        ['gnome-terminal',     ['--', 'bash', '-lc', `${command}; echo; read -p "Press enter to close…"`]],
        ['konsole',            ['-e', 'bash', '-lc', `${command}; echo; read -p "Press enter to close…"`]],
        ['xfce4-terminal',     ['-e', `bash -lc '${command.replace(/'/g, `'\\''`)}; read -p "done"'`]],
        ['xterm',              ['-e', 'bash', '-lc', `${command}; echo; read -p "done"`]],
      ];
      for (const [bin, args] of terminals) {
        const resolved = findBin(bin);
        if (!resolved) continue;
        spawn(resolved, args, { detached: true, stdio: 'ignore' }).unref();
        return { ok: true, terminal: bin };
      }
      return { ok: false, error: 'no terminal emulator found' };
    }
    if (platform === 'win32') {
      // Use cmd's `start` builtin which opens a new window with the supplied command.
      spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', command], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, terminal: 'cmd.exe' };
    }
    return { ok: false, error: `unsupported platform ${platform}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
