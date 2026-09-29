/** Boot: content → assets → renderer → save data → title (or resume). */
import { Content, setContent } from './engine/content';
import { loadBrowserBundle } from './data/index';
import { assets, K } from './game/assets';
import { G } from './game/core/app';
import { audio } from './game/audio/audio';
import { session } from './game/state';
import { go } from './game/router';
import { preloadFx } from './game/fx/fx';
import { preloadUi, setColorGlyphs } from './game/ui/skin';
import { isNativeApp, onBackButton } from './game/platform';
import { installCjkWrap } from './game/ui/textwrap';

const bar = document.getElementById('bootbar');
const msg = document.getElementById('bootmsg');
const progress = (k: number, text?: string) => { if (bar) bar.style.width = `${Math.round(k * 100)}%`; if (text && msg) msg.textContent = text; };

async function boot() {
  installCjkWrap();
  progress(0.05, '展开命书……');
  setContent(new Content(loadBrowserBundle()));
  await assets.init();
  progress(0.15, '点亮星灯……');
  await G.init(document.getElementById('app')!);
  audio.init();
  await session.load();
  G.setHudMargin(session.settings.hudMargin ?? 0);
  setColorGlyphs(session.settings.colorblind !== 'none');
  progress(0.25, '研墨……');
  // fonts: wait briefly for web fonts, fall back to system fonts
  // the clients bundle their fonts (assets/fonts): load them before any canvas text is drawn
  const bundled = isNativeApp ? Promise.all(['400 20px "Noto Serif SC"', '900 20px "Noto Serif SC"', '20px "Ma Shan Zheng"'].map((f) => document.fonts.load(f, '命阙'))) : Promise.resolve();
  await Promise.race([Promise.all([bundled, document.fonts?.ready]), new Promise((r) => setTimeout(r, 2500))]);
  // every UI texture + icon is preloaded: the UI is built only from generated woodblock art
  await preloadUi((k) => progress(0.25 + k * 0.4, '唤醒执命者……'));
  await assets.loadMany([...assets.keysByPrefix('ui/icons/'), K.bg('title')], (k) => progress(0.65 + k * 0.25, '点燃灯火……'));
  void preloadFx(); // particles fade in once their textures arrive; the title does not wait for them
  progress(1, '');
  const el = document.getElementById('boot');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }
  if (import.meta.env.DEV) {
    // debug handles: __pump steps the ticker (the preview pane pauses rAF), __snap saves a PNG to .cache/snaps
    const pump = async (ms: number) => { let now = performance.now(); const end = now + ms; while (now < end) { now += 16; G.app.ticker.update(now); await new Promise((r) => setTimeout(r, 0)); } };
    const snap = async (name: string) => { G.app.render(); return (await fetch(`/__snap?name=${name}`, { method: 'POST', body: G.app.canvas.toDataURL('image/png') })).status; };
    Object.assign(window, { __G: G, __session: session, __audio: audio, __pump: pump, __snap: snap });
    // UI tour: ?uitour=1 (headless via scripts/ui-tour.ts) or window.__uiTour() by hand
    const tour = async (o?: { events?: 'all' | number }) => {
      const m = await import('./game/dev/uiTour');
      try {
        const pages = await m.runUiTour(o);
        const summary = m.tourSummary(pages);
        console.log(summary);
        Object.assign(window, { __tourResult: { pages, summary } });
        return summary;
      } catch (e) {
        const summary = `UI tour crashed: ${(e as Error).stack ?? e}`;
        Object.assign(window, { __tourResult: { pages: [{ name: 'crash', issues: [{ kind: 'error', detail: summary }] }], summary } });
        return summary;
      }
    };
    Object.assign(window, { __uiTour: tour });
    const q = new URLSearchParams(location.search);
    if (q.has('uitour')) {
      void go(true);
      await pump(3000);
      await tour({ events: q.get('uitour') === 'all' ? 'all' : Number(q.get('uitour')) || 6 });
      return;
    }
  }
  // Android back: whatever Escape closes (modal, targeting, deck view); nothing open → minimise
  void onBackButton(() => G.dispatchKey(new KeyboardEvent('keydown', { key: 'Escape' })));
  await go(true);
}

// production: cache art/audio locally so repeat visits don't download them again (assets/sw.js)
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNativeApp) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL ?? '/'}sw.js`).catch(() => undefined); });
}

boot().catch((e) => {
  console.error(e);
  if (msg) msg.textContent = `启动失败：${(e as Error).message}`;
});
