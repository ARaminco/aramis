/**
 * Aramis desktop wrapper (CommonJS — Electron 33 ESM main has known issues
 * with bundled native CJS dependencies, so we stay on CJS for reliability).
 *
 * - Embeds the Express server in-process on a random local port.
 * - Stores SQLite DB in the OS-standard userData directory.
 * - Loads the built Vue SPA served by that Express instance.
 */
const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const isDev = !app.isPackaged;

// macOS / Linux GUI apps inherit a stripped-down PATH (just /usr/bin:/bin:/...) so
// Homebrew, nvm, pnpm-installed binaries are invisible. Source the user's login
// shell once and merge the result back into our PATH so the embedded server can
// spawn npm / brew / claude / codex / git / ssh etc. without ENOENT.
function expandShellPath() {
  if (process.platform === 'win32') return;
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const out = execSync(`${shell} -ilc 'echo $PATH'`, {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out && out.includes('/')) {
      const seen = new Set();
      const merged = []
        .concat((process.env.PATH || '').split(':'), out.split(':'))
        .filter((p) => p && !seen.has(p) && (seen.add(p), true))
        .join(':');
      process.env.PATH = merged;
    }
  } catch { /* shell missing or refused — keep the inherited PATH */ }
}
expandShellPath();

// --- Single-instance lock so a second launch focuses the existing window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;
let serverHandle = null;

function resolveStaticDir() {
  const candidates = [
    path.join(__dirname, '..', 'web', 'dist'),
    path.join(process.resourcesPath || '', 'app.asar', 'web', 'dist'),
    path.join(process.resourcesPath || '', 'app', 'web', 'dist'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function resolveServerEntry() {
  const candidates = [
    path.join(__dirname, '..', 'server', 'src', 'index.js'),
    path.join(process.resourcesPath || '', 'app.asar', 'server', 'src', 'index.js'),
    path.join(process.resourcesPath || '', 'app', 'server', 'src', 'index.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0];
}

function resolveDbPath() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'aramis.db');
}

function getOrCreateJwtSecret() {
  const file = path.join(app.getPath('userData'), '.jwt-secret');
  try { if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(48).toString('hex');
  try { fs.writeFileSync(file, secret, { mode: 0o600 }); } catch {}
  return secret;
}

async function startEmbeddedServer() {
  process.env.DB_PATH = resolveDbPath();
  process.env.JWT_SECRET = process.env.JWT_SECRET || getOrCreateJwtSecret();

  const serverEntry = resolveServerEntry();
  // dynamic ESM import from CJS
  const mod = await import(pathToFileURL(serverEntry).href);
  if (typeof mod.startServer !== 'function') {
    throw new Error('server module does not export startServer()');
  }
  return mod.startServer({ port: 0, staticDir: resolveStaticDir() });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    {
      role: 'help',
      submenu: [{ label: 'About Aramis', click: () => shell.openExternal('https://aramin.co') }],
    },
  ]);
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 700,
    minHeight: 500,
    title: 'Aramis',
    backgroundColor: '#0a0a0c',
    show: false,
    autoHideMenuBar: !isDev,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  });

  if (!isDev) Menu.setApplicationMenu(buildMenu());

  try {
    serverHandle = await startEmbeddedServer();
  } catch (err) {
    console.error('[aramis] failed to start embedded server', err);
    dialog.showErrorBox('Aramis — startup error', err?.message || String(err));
    app.quit();
    return;
  }

  await mainWindow.loadURL(`http://127.0.0.1:${serverHandle.port}/`);
  mainWindow.show();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverHandle.port}`)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', async () => {
  try { await serverHandle?.close(); } catch {}
});
