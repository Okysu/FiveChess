/** Boot: content → assets → renderer → save data → title (or resume). */
import { Content, setContent } from './engine/content';
import { loadBrowserBundle } from './data/index';
import { assets, K } from './game/assets';
import { G } from './game/core/app';
import { audio } from './game/audio/audio';
import { session } from './game/state';
import { go } from './game/router';
import { preloadFx } from './game/fx/fx';
import { preloadUi } from './game/ui/skin';

const bar = document.getElementById('bootbar');
const msg = document.getElementById('bootmsg');
const progress = (k: number, text?: string) => { if (bar) bar.style.width = `${Math.round(k * 100)}%`; if (text && msg) msg.textContent = text; };

async function boot() {
  progress(0.05, '展开命书……');
  setContent(new Content(loadBrowserBundle()));
  await assets.init();
  progress(0.15, '点亮星灯……');
  await G.init(document.getElementById('app')!);
  audio.init();
  await session.load();
  progress(0.25, '研墨……');
  // fonts: wait briefly for web fonts, fall back to system fonts
  await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
  // every UI texture + icon is preloaded: the UI is built only from generated woodblock art
  await preloadUi((k) => progress(0.25 + k * 0.4, '唤醒执命者……'));
  await assets.loadMany([...assets.keysByPrefix('ui/icons/'), K.bg('title')], (k) => progress(0.65 + k * 0.25, '点燃灯火……'));
  await preloadFx();
  progress(1, '');
  const el = document.getElementById('boot');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); }
  if (import.meta.env.DEV) Object.assign(window, { __G: G, __session: session });
  await go(true);
}

boot().catch((e) => {
  console.error(e);
  if (msg) msg.textContent = `启动失败：${(e as Error).message}`;
});
