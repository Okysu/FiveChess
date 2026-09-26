/**
 * Which shell the game runs in: a browser tab, the Electron desktop client (electron/preload.cjs exposes
 * window.mingqueNative) or the Capacitor Android/iOS app. One codebase; only these few hooks differ.
 */
import { Capacitor } from '@capacitor/core';

interface NativeBridge { platform: 'desktop'; quit(): void; setFullscreen(on: boolean): void; isFullscreen(): boolean }
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
