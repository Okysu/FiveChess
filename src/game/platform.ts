/**
 * Which shell the game runs in: a browser tab, the Electron desktop client (electron/preload.cjs exposes
 * window.mingqueNative) or the Capacitor Android/iOS app. One codebase; only these few hooks differ.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';

interface NativeBridge {
  platform: 'desktop'; quit(): void; setFullscreen(on: boolean): void; isFullscreen(): boolean;
  fetchText(url: string, ms: number): Promise<{ ok: boolean; status: number; text: string }>;
  openExternal(url: string): void;
}
const bridge = (globalThis as { mingqueNative?: NativeBridge }).mingqueNative;

export const isDesktopApp = !!bridge;
export const isMobileApp = Capacitor.isNativePlatform();
export const isNativeApp = isDesktopApp || isMobileApp;

/** the desktop client can quit; browsers and phones leave through their own UI */
export const canQuit = isDesktopApp;
export function quitApp() { bridge?.quit(); }

export function isFullscreen(): boolean {
  return bridge ? bridge.isFullscreen() : !!document.fullscreenElement;
}
export function setFullscreen(on: boolean) {
  if (bridge) { bridge.setFullscreen(on); return; }
  if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
}

/** Android back button: close the top modal, else go back one screen, else ask to leave (handler set by the router) */
export async function onBackButton(fn: () => boolean) {
  if (!isMobileApp) return;
  const { App } = await import('@capacitor/app');
  void App.addListener('backButton', () => { if (!fn()) void App.minimizeApp(); });
}

/**
 * GET a text resource from outside the game (the update check). The clients fetch natively — Electron's main
 * process, Capacitor's HTTP — because GitHub's release downloads redirect to a host that sends no CORS headers.
 * null on failure or timeout.
 */
export async function fetchText(url: string, ms: number): Promise<string | null> {
  try {
    if (bridge) { const r = await bridge.fetchText(url, ms); return r.ok ? r.text : null; }
    if (isMobileApp) {
      const r = await CapacitorHttp.get({ url, connectTimeout: ms, readTimeout: ms, responseType: 'text' });
      if (r.status < 200 || r.status >= 300) return null;
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' }); return r.ok ? await r.text() : null; } finally { clearTimeout(t); }
  } catch { return null; }
}

/** open a link in the system browser (downloads, release pages) */
export async function openExternal(url: string) {
  if (bridge) { bridge.openExternal(url); return; }
  if (isMobileApp) { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); return; }
  window.open(url, '_blank', 'noopener');
}
