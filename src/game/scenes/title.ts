import { Container, Text } from 'pixi.js';
import { WB, nine, INSET, uiSprite } from '../ui/skin';
import { fs } from '../ui/profile';
import { ScrollBox } from '../ui/scroll';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { Box } from '../core/layout';
import { Button, Modal, label } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE, FONT_BRUSH } from '../ui/theme';
import { Particles } from '../fx/fx';
import { tweens, ease } from '../core/tween';
import { audio } from '../audio/audio';
import { session } from '../state';
import { nextUnlock } from '../../engine/meta';
import intro from '../../data/lore/intro.json';
import { go } from '../router';

export class TitleScene extends Scene {
  private parts = new Particles();
  private spawnA?: () => void;
  private spawnB?: () => void;
  private acc = 0;

  override async enter() {
    await assets.load(K.bg('title'));
    G.setBackdrop(assets.get(K.bg('title')));
    audio.playMusic('title');
    audio.ambience('forest');
    // a flat printed ink band behind the menu (woodblock layer), no gradient
    const shade = nine('menu_panel', 820, 1060);
    shade.position.set(20, 10);
    this.addChild(shade, this.parts);
    this.spawnA = this.parts.ambient('embers', 1920, 1080, 0.6);
    this.spawnB = this.parts.ambient('dust', 1920, 1080, 0.3);

    // the game logo (art-src/logo: generated woodblock cartouche + 马善政 lettering)
    const titleText = uiSprite('logo', 660, 400);
    titleText.position.set(430, 215);
    const sub = new Text({ text: '执 命 者 · 逆 命 之 书', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(40), fill: C.text, letterSpacing: 10, stroke: { color: 0, width: 4 } } });
    sub.anchor.set(0.5);
    sub.position.set(430, 432);
    this.addChild(titleText, sub);
    titleText.alpha = 0; sub.alpha = 0;
    void tweens.to(titleText, { alpha: 1 }, 1400, { ease: ease.outQuad, unscaled: true });
    void tweens.to(sub, { alpha: 1 }, 1400, { delay: 500, unscaled: true });

    const menu = new Box({ dir: 'column', gap: 14, align: 'center' });
    const btn = (t: string, fn: () => void, kind: 'primary' | 'normal' = 'normal', sub2?: string) => { const h = sub2 ? 88 : 74; menu.add(new Button(t, { width: 360, height: h, fontSize: fs(32), kind, onClick: fn, sub: sub2 }), { width: 360, height: h }); };
    if (session.run) {
      const r = session.run;
      btn('继续冒险', () => go(), 'primary', `第${r.act}幕 · 第${r.floor}层`);
    }
    btn('新的冒险', () => void import('./select').then((m) => G.go(new m.SelectScene())), session.run ? 'normal' : 'primary');
    btn('图　　鉴', () => void import('./codex').then((m) => G.go(new m.CodexScene())));
    btn('设　　置', () => void import('./settings').then((m) => m.openSettings()));
    btn('鸣　　谢', () => this.credits());
    menu.layout();
    menu.position.set(430 - 180, 478);
    this.addChild(menu);

    // progress
    const p = session.profile;
    const nu = nextUnlock(p);
    // inside the scroll, above its bottom roller
    const prog = label(`命数 ${p.xp}　·　通关 ${p.wins}/${p.runs}
${nu ? `下一解锁：${nu.label}（${nu.xp}）` : '全部内容已解锁'}`, { fontSize: fs(20), fill: C.textDim, align: 'center' });
    prog.anchor.set(0.5, 0);
    prog.position.set(430, 936);
    this.addChild(prog);

    // opening narration
    const lines = (intro as { opening: string[] }).opening;
    const narr = new Container();
    narr.position.set(1880, 820);
    this.addChild(narr);
    lines.forEach((l, i) => {
      const t = new Text({ text: l, style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: C.text, stroke: { color: 0, width: 4 }, align: 'right' } });
      t.anchor.set(1, 0);
      t.y = i * 38 - lines.length * 19;
      t.alpha = 0;
      narr.addChild(t);
      void tweens.to(t, { alpha: 0.85 }, 900, { delay: 1500 + i * 700, unscaled: true });
    });
  }

  /** 鸣谢: generated from assets/manifest.json by `npm run credits` (assets/credits.json) */
  private credits() {
    const W = 1300, H = 880;
    const m = new Modal(W, H, { title: '制作与鸣谢' });
    const box = new ScrollBox(W - INSET.dark.x * 2, H - 110 - INSET.dark.y);
    box.position.set(INSET.dark.x, 110);
    m.body.addChild(box);
    void fetch(`${import.meta.env.BASE_URL ?? '/'}credits.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { sections: { title: string; lines: string[] }[] } | null) => {
        if (!j || box.destroyed) return;
        let y = 0;
        const wrap = W - INSET.dark.x * 2 - 40;
        for (const sec of j.sections) {
          const h = new Text({ text: sec.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(28), fill: C.goldLight } });
          h.position.set(0, y);
          box.content.addChild(h);
          y += 44;
          for (const line of sec.lines) {
            const t = new Text({ text: `· ${line}`, style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.text, lineHeight: 32, wordWrap: true, wordWrapWidth: wrap, breakWords: true } });
            t.position.set(12, y);
            box.content.addChild(t);
            y += t.height + 6;
          }
          y += 20;
        }
        box.refresh();
      });
  }

  override update(dt: number) {
    this.acc += dt;
    while (this.acc > 60) { this.acc -= 60; this.spawnA?.(); this.spawnB?.(); }
    this.parts.update(dt);
  }
}
