import os from 'node:os';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

function safeExec(cmd, timeout = 1500) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

function detectPackageManagers() {
  const candidates = ['apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk', 'brew', 'port', 'pkg', 'choco', 'winget', 'scoop', 'snap', 'flatpak', 'npm', 'pip', 'pip3', 'cargo', 'go'];
  const found = [];
  for (const c of candidates) {
    const p = safeExec(process.platform === 'win32' ? `where ${c}` : `command -v ${c}`);
    if (p) found.push(c);
  }
  return found;
}

function detectLinuxDistro() {
  try {
    if (fs.existsSync('/etc/os-release')) {
      const text = fs.readFileSync('/etc/os-release', 'utf8');
      const obj = {};
      for (const line of text.split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) obj[m[1]] = m[2].replace(/^"|"$/g, '');
      }
      return { name: obj.PRETTY_NAME || obj.NAME, id: obj.ID, version: obj.VERSION_ID };
    }
  } catch {}
  return null;
}

export function detectSystem() {
  const platform = process.platform;
  const arch = process.arch;
  const release = os.release();
  const hostname = os.hostname();
  const totalMemGB = +(os.totalmem() / 1024 ** 3).toFixed(2);
  const cpus = os.cpus();
  const shell = process.env.SHELL || process.env.ComSpec || null;
  const user = os.userInfo().username;
  const home = os.homedir();
  const cwd = process.cwd();

  let osName = platform;
  let distro = null;
  if (platform === 'linux') {
    distro = detectLinuxDistro();
    osName = distro?.name || 'Linux';
  } else if (platform === 'darwin') {
    const ver = safeExec('sw_vers -productVersion');
    osName = `macOS ${ver || ''}`.trim();
  } else if (platform === 'win32') {
    osName = `Windows ${release}`;
  }

  return {
    platform, arch, release, hostname, osName, distro,
    cpu: { model: cpus[0]?.model, cores: cpus.length },
    memoryGB: totalMemGB,
    shell, user, home, cwd,
    packageManagers: detectPackageManagers(),
    nodeVersion: process.version,
    detectedAt: new Date().toISOString(),
  };
}
