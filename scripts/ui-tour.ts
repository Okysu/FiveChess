/**
 * Headless UI tour: starts the Vite dev server, opens the game in headless Edge/Chrome at 1920×1080,
 * runs src/game/dev/uiTour.ts (visits every screen, snapshots, layout checks) and prints the report.
 *   npm run ui:tour                 (6 events)     npm run ui:tour -- --events=all    --ci (exit 1 on issues)
 * Snapshots: .cache/snaps/tour_*.png · report: .cache/uitour/report.json. No extra dependencies (CDP over WebSocket).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const PORT = 5199, DEBUG = 9333;
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter((x): x is string => !!x && fs.existsSync(x));
if (!BROWSERS.length) throw new Error('no Chrome/Edge found — set CHROME_PATH');

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'uitour-'));
const browser = spawn(BROWSERS[0]!, [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1920,1080',
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const cleanup = async () => { browser.kill(); await server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked on Windows until exit */ } };
try {
  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
    await new Promise((r) => setTimeout(r, 200));
    targets = await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json() as Promise<typeof targets>).catch(() => []);
  }
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('headless browser did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map<number, (v: { result?: { result?: { value?: unknown } } }) => void>();
  ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id && pending.has(d.id)) { pending.get(d.id)!(d); pending.delete(d.id); } };
  const cdp = (method: string, params: object = {}) => new Promise<{ result?: { result?: { value?: unknown } } }>((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr: string) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/?uitour=${args.events ?? 6}` });
  const t0 = Date.now();
  let result: { pages: { name: string; issues: { kind: string; detail: string }[] }[]; summary: string } | undefined;
  while (!result && Date.now() - t0 < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 2000));
    result = (await evaluate('window.__tourResult ?? null')) as typeof result;
    const boot = await evaluate("document.getElementById('bootmsg')?.textContent ?? ''");
    if (typeof boot === 'string' && boot.startsWith('启动失败')) throw new Error(boot);
  }
  if (!result) throw new Error('UI tour timed out');
  fs.mkdirSync('.cache/uitour', { recursive: true });
  fs.writeFileSync('.cache/uitour/report.json', JSON.stringify(result.pages, null, 1));
  console.log(result.summary);
  console.log(`snapshots: .cache/snaps/tour_*.png · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const issues = result.pages.reduce((a, p) => a + p.issues.length, 0);
  ws.close();
  await cleanup();
  process.exit(args.ci === 'true' && issues ? 1 : 0);
} catch (e) {
  console.error(e);
  await cleanup();
  process.exit(2);
}
