/**
 * 命阙 desktop client: the same web build (dist/, `npm run build:native`) in an Electron window.
 * The page is served from https://mingque.game/, a private host answered from dist/ by this process (nothing goes
 * to the network), so absolute asset URLs, fetch, IndexedDB saves and audio streaming behave exactly as on the
 * website. (A custom app:// scheme breaks PixiJS, whose URL helpers only know http(s) and file.) Saves live in the user-data folder of this app.
 *   --smoke[=out.png]  load, wait, save a screenshot, print renderer errors, quit (used by `npm run desktop:smoke`)
 */
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const smokeArg = process.argv.find((a) => a.startsWith('--smoke'));
const smokeOut = smokeArg ? (smokeArg.split('=')[1] || path.join(process.cwd(), '.cache', 'desktop-smoke.png')) : null;
const devUrl = process.env.MINGQUE_DEV_URL || (process.argv.includes('--dev') ? 'http://localhost:5173/' : null); // desktop:dev → Vite dev server

const HOST = 'mingque.game';
const ORIGIN = `https://${HOST}`;

if (!smokeOut && !app.requestSingleInstanceLock()) app.quit();

// window size / position / fullscreen survive restarts
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function readState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } }
function writeState(win) {
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), fullscreen: win.isFullScreen(), maximized: win.isMaximized() })); } catch { /* read-only profile */ }
}

let win = null;
function createWindow() {
  const st = readState();
  win = new BrowserWindow({
    width: st.width || 1600, height: st.height || 900, x: st.x, y: st.y,
    minWidth: 960, minHeight: 540,
    backgroundColor: '#0b0806',
    title: '命阙',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // music + tweens keep running when the window is behind another one
      devTools: !app.isPackaged || !!process.env.MINGQUE_DEVTOOLS,
    },
  });
  Menu.setApplicationMenu(null);
  if (st.maximized) win.maximize();
  if (st.fullscreen) win.setFullScreen(true);
  win.once('ready-to-show', () => win.show());
  win.on('close', () => writeState(win));
  // links in the credits etc. open in the system browser; the game window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN) &&!url.startsWith(devUrl || '\0')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && win.webContents.isDevToolsOpened !== undefined && (!app.isPackaged || process.env.MINGQUE_DEVTOOLS)) win.webContents.toggleDevTools();
  });
  void win.loadURL(devUrl || `${ORIGIN}/index.html`);
  if (smokeOut) runSmoke(win);
}

function runSmoke(w) {
  const errors = [];
  w.webContents.on('console-message', (e) => { const { level, message } = e; if (level === 'error' || level === 3) errors.push(message); });
  w.webContents.on('render-process-gone', (_e, d) => { errors.push(`renderer gone: ${d.reason}`); });
  w.webContents.session.webRequest.onErrorOccurred((d) => { errors.push(`request failed: ${d.url} ${d.error}`); });
  w.webContents.session.webRequest.onCompleted((d) => { if (d.statusCode >= 400) errors.push(`HTTP ${d.statusCode}: ${d.url}`); });
  w.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const scene = await w.webContents.executeJavaScript("document.getElementById('boot') ? 'booting' : 'ready'").catch((e) => String(e));
      const probe = process.env.MINGQUE_SMOKE_EVAL ? await w.webContents.executeJavaScript(process.env.MINGQUE_SMOKE_EVAL).catch((e) => String(e)) : undefined;
      const img = await w.webContents.capturePage();
      fs.mkdirSync(path.dirname(smokeOut), { recursive: true });
      fs.writeFileSync(smokeOut, img.toPNG());
      console.log(JSON.stringify({ smoke: smokeOut, scene, errors, probe }));
      app.exit(errors.length ? 1 : 0);
    }, Number(process.env.MINGQUE_SMOKE_MS || 9000));
  });
}

ipcMain.on('mq:quit', () => app.quit());
// update check: fetched here (no page CORS; GitHub's release downloads redirect to a host without CORS headers)
ipcMain.handle('mq:fetch', async (_e, url, ms) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) return { ok: false, status: 0, text: '' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(Number(ms) || 5000, 20000));
  try {
    const r = await net.fetch(url, { signal: ctrl.signal, redirect: 'follow', bypassCustomProtocolHandlers: true, cache: 'no-store' });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
  } catch { return { ok: false, status: 0, text: '' }; } finally { clearTimeout(timer); }
});
ipcMain.on('mq:openExternal', (_e, url) => { if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url); });
ipcMain.on('mq:fullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); });
ipcMain.on('mq:isFullscreen', (e) => { e.returnValue = !!win && win.isFullScreen(); });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  // https://mingque.game/<path> → dist/<path>; any other https request passes through untouched
  protocol.handle('https', (req) => {
    const url = new URL(req.url);
    if (url.host !== HOST) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    if (url.pathname === '/') file = path.join(DIST, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
  });
  createWindow();
});
