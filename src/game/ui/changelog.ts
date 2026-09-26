/**
 * 更新日志 (src/data/changelog.json): the full log from 设置, and 「命书新章」 once after an update —
 * only the versions since the one the player last saw, only the entries for this platform.
 */
import { Text } from 'pixi.js';
import { fs } from './profile';
import { INSET } from './skin';
import { ScrollBox } from './scroll';
import { Modal } from './widgets';
import { C, FONT_BODY, FONT_TITLE } from './theme';
import { session } from '../state';
import { isDesktopApp, isMobileApp } from '../platform';
import { APP_VERSION, CHANGELOG, logsSince, type VersionLog } from '../version';

const PLATFORM = isDesktopApp ? 'pc' : isMobileApp ? 'android' : 'web';
const PLATFORM_NAME = { web: '网页', pc: 'PC', android: '安卓' } as const;

export function openChangelog(o: { title?: string; logs?: VersionLog[]; thisPlatformOnly?: boolean } = {}) {
  const W = 1300, H = 880;
  const m = new Modal(W, H, { title: o.title ?? `更新日志 · 当前版本 ${APP_VERSION}` });
  const box = new ScrollBox(W - INSET.dark.x * 2, H - 110 - INSET.dark.y);
  box.position.set(INSET.dark.x, 110);
  m.body.addChild(box);
  const wrap = W - INSET.dark.x * 2 - 60;
  let y = 0;
  const add = (t: Text, x: number, gap: number) => { t.position.set(x, y); box.content.addChild(t); y += t.height + gap; };
  for (const v of o.logs ?? CHANGELOG) {
    add(new Text({ text: `${v.version} · ${v.title}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(32), fill: C.goldLight } }), 0, 2);
    add(new Text({ text: v.date, style: { fontFamily: FONT_BODY, fontSize: fs(18), fill: C.textDim } }), 2, 14);
    for (const [section, entries] of Object.entries(v.sections)) {
      const shown = entries.filter((e) => !o.thisPlatformOnly || !e.platforms || e.platforms.includes(PLATFORM));
      if (!shown.length) continue;
      add(new Text({ text: section, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.text } }), 12, 8);
      for (const e of shown) {
        const tag = e.platforms && !o.thisPlatformOnly ? `【${e.platforms.map((p) => PLATFORM_NAME[p]).join(' / ')}】` : '';
        // the bullet is its own Text: glued to the sentence, Pixi wraps the whole unbroken Chinese line after it
        const dot = new Text({ text: '·', style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.goldLight, lineHeight: 32 } });
        dot.position.set(28, y);
        box.content.addChild(dot);
        add(new Text({ text: `${tag}${e.text}`, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.text, lineHeight: 32, wordWrap: true, wordWrapWidth: wrap - 20, breakWords: true } }), 52, 6);
      }
      y += 10;
    }
    y += 24;
  }
  box.refresh();
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
