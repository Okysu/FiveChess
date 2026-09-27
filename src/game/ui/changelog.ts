/**
 * 更新日志 (src/data/changelog.json): the full log from 设置, and 「命书新章」 once after an update —
 * only the versions since the one the player last saw, only the entries for this platform.
 */
import { Sprite, Text } from 'pixi.js';
import { richTexture } from './richtext';
import { fs } from './profile';
import { INSET } from './skin';
import { ScrollBox } from './scroll';
import { Button, Modal } from './widgets';
import { C, FONT_BODY, FONT_TITLE } from './theme';
import { session } from '../state';
import { isDesktopApp, isMobileApp, openExternal } from '../platform';
import { viaRoute, type UpdateResult } from '../update';
import { APP_VERSION, CHANGELOG, logsSince, type VersionLog } from '../version';

const PLATFORM = isDesktopApp ? 'pc' : isMobileApp ? 'android' : 'web';
const PLATFORM_NAME = { web: '网页', pc: 'PC', android: '安卓' } as const;

/** render version logs into a scroll box (shared by the full log, 命书新章 and the update dialog) */
function fillLogs(box: ScrollBox, logs: VersionLog[], thisPlatformOnly: boolean, width: number) {
  const wrap = width - 60;
  let y = 0;
  const add = (t: Text, x: number, gap: number) => { t.position.set(x, y); box.content.addChild(t); y += t.height + gap; };
  for (const v of logs) {
    add(new Text({ text: `${v.version} · ${v.title}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(32), fill: C.goldLight } }), 0, 2);
    add(new Text({ text: v.date, style: { fontFamily: FONT_BODY, fontSize: fs(18), fill: C.textDim } }), 2, 14);
    for (const [section, entries] of Object.entries(v.sections)) {
      const shown = entries.filter((e) => !thisPlatformOnly || !e.platforms || e.platforms.includes(PLATFORM));
      if (!shown.length) continue;
      add(new Text({ text: section, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.text } }), 12, 8);
      for (const e of shown) {
        const tag = e.platforms && !thisPlatformOnly ? `【${e.platforms.map((pl) => PLATFORM_NAME[pl]).join(' / ')}】` : '';
        // the bullet is its own Text: glued to the sentence, Pixi wraps the whole unbroken Chinese line after it
        const dot = new Text({ text: '·', style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.goldLight, lineHeight: 32 } });
        dot.position.set(28, y);
        box.content.addChild(dot);
        // the rich renderer breaks Chinese lines properly (Pixi's word wrap splits at the spaces around numbers)
        const { texture, result } = richTexture(`${tag}${e.text}`, { width: wrap - 20, height: 600, fontSize: fs(21), minFontSize: fs(21), color: 0xeadfc8, align: 'left', vAlign: 'top', lineHeight: 1.5 });
        const sp = new Sprite(texture);
        sp.position.set(52, y + 2);
        box.content.addChild(sp);
        y += result.usedHeight + 8;
      }
      y += 10;
    }
    y += 24;
  }
  box.refresh();
}

export function openChangelog(o: { title?: string; logs?: VersionLog[]; thisPlatformOnly?: boolean } = {}) {
  const W = 1300, H = 880;
  const m = new Modal(W, H, { title: o.title ?? `更新日志 · 当前版本 ${APP_VERSION}` });
  const box = new ScrollBox(W - INSET.dark.x * 2, H - 110 - INSET.dark.y);
  box.position.set(INSET.dark.x, 110);
  m.body.addChild(box);
  fillLogs(box, o.logs ?? CHANGELOG, !!o.thisPlatformOnly, W - INSET.dark.x * 2);
  return m;
}

/** a newer release exists: what it brings (this platform), the chosen download route, download / skip / later */
export function openUpdateDialog(r: Extract<UpdateResult, { status: 'available' }>, o: { onSkip?: () => void } = {}) {
  const W = 1300, H = 900;
  const m = new Modal(W, H, { title: `发现新版本 · ${r.manifest.version}` });
  const info = new Text({ text: `当前 ${APP_VERSION}　→　最新 ${r.manifest.version}（${r.manifest.date}）　·　下载线路：${r.route.label}`, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.textDim } });
  info.position.set(INSET.dark.x, 100);
  m.body.addChild(info);
  const box = new ScrollBox(W - INSET.dark.x * 2, H - 250 - INSET.dark.y);
  box.position.set(INSET.dark.x, 146);
  m.body.addChild(box);
  fillLogs(box, r.logs, true, W - INSET.dark.x * 2);
  const buttons: [string, () => void, 'primary' | 'normal' | 'ghost'][] = isDesktopApp
    ? [['下载安装版', () => void openExternal(viaRoute(r.route, r.manifest.assets.pcSetup)), 'primary'], ['下载免安装版', () => void openExternal(viaRoute(r.route, r.manifest.assets.pcPortable)), 'normal']]
    : [['下载安装包', () => void openExternal(viaRoute(r.route, r.manifest.assets.android)), 'primary']];
  buttons.push(['跳过此版本', () => { o.onSkip?.(); m.close(); }, 'ghost'], ['稍后', () => m.close(), 'ghost']);
  let x = W - INSET.dark.x;
  for (const [text, fn, kind] of [...buttons].reverse()) {
    const w = text.length > 3 ? 220 : 150;
    x -= w;
    const btn = new Button(text, { width: w, height: 64, fontSize: fs(23), kind, onClick: fn });
    btn.position.set(x, H - 100);
    m.body.addChild(btn);
    x -= 16;
  }
  return m;
}

/** after an update: show what changed since the last version this player saw (never on a brand-new install) */
export function maybeShowWhatsNew() {
  const st = session.settings;
  if (st.lastSeenVersion === APP_VERSION) return;
  const fresh = !st.lastSeenVersion && session.profile.runs === 0;
  const logs = logsSince(st.lastSeenVersion);
  st.lastSeenVersion = APP_VERSION;
  void session.saveSettings();
  if (!fresh && logs.length) openChangelog({ title: `命书新章 · ${APP_VERSION}`, logs, thisPlatformOnly: true });
}
