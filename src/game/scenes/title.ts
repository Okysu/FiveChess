import { Container, Graphics, Text } from 'pixi.js';
import { WB } from '../ui/skin';
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
    const shade = new Graphics().rect(0, 0, 860, 1080).fill({ color: WB.ink, alpha: 0.72 });
    shade.rect(860, 0, 8, 1080).fill({ color: WB.ochre }).rect(868, 0, 4, 1080).fill({ color: WB.ink }).rect(872, 0, 5, 1080).fill({ color: WB.vermilion });
    this.addChild(shade, this.parts);
    this.spawnA = this.parts.ambient('embers', 1920, 1080, 0.6);
    this.spawnB = this.parts.ambient('dust', 1920, 1080, 0.3);

    const titleText = new Text({
      text: '命 阙',
      style: {
        fontFamily: FONT_BRUSH, fontSize: 220, fill: WB.ochre,
        stroke: { color: WB.ink, width: 14 }, dropShadow: { color: WB.vermilion, blur: 0, distance: 12, alpha: 1, angle: Math.PI / 4 }, letterSpacing: 20,
      },
    });
    titleText.anchor.set(0.5);
    titleText.position.set(430, 250);
    const sub = new Text({ text: '执 命 者 · 逆 命 之 书', style: { fontFamily: FONT_TITLE, fontSize: 40, fill: C.text, letterSpacing: 10, stroke: { color: 0, width: 4 } } });
    sub.anchor.set(0.5);
    sub.position.set(430, 400);
    this.addChild(titleText, sub);
    titleText.alpha = 0; sub.alpha = 0;
    void tweens.to(titleText, { alpha: 1 }, 1400, { ease: ease.outQuad, unscaled: true });
    void tweens.to(sub, { alpha: 1 }, 1400, { delay: 500, unscaled: true });

    const menu = new Box({ dir: 'column', gap: 18, align: 'center' });
    const btn = (t: string, fn: () => void, kind: 'primary' | 'normal' = 'normal', sub2?: string) => menu.add(new Button(t, { width: 360, height: 74, fontSize: 32, kind, onClick: fn, sub: sub2 }), { width: 360, height: 74 });
    if (session.run) {
      const r = session.run;
      btn('继续冒险', () => go(), 'primary', `第${r.act}幕 · 第${r.floor}层`);
    }
    btn('新的冒险', () => void import('./select').then((m) => G.go(new m.SelectScene())), session.run ? 'normal' : 'primary');
    btn('图　　鉴', () => void import('./codex').then((m) => G.go(new m.CodexScene())));
    btn('设　　置', () => void import('./settings').then((m) => m.openSettings()));
    btn('鸣　　谢', () => this.credits());
    menu.layout();
    menu.position.set(430 - 180, 500);
    this.addChild(menu);

    // progress
    const p = session.profile;
    const nu = nextUnlock(p);
    const prog = label(`命数 ${p.xp}${nu ? `　·　下一解锁：${nu.label}（${nu.xp}）` : '　·　全部内容已解锁'}　·　通关 ${p.wins}/${p.runs}`, { fontSize: 20, fill: C.textDim });
    prog.position.set(40, 1030);
    this.addChild(prog);

    // opening narration
    const lines = (intro as { opening: string[] }).opening;
    const narr = new Container();
    narr.position.set(1880, 820);
    this.addChild(narr);
    lines.forEach((l, i) => {
      const t = new Text({ text: l, style: { fontFamily: FONT_BODY, fontSize: 24, fill: C.text, stroke: { color: 0, width: 4 }, align: 'right' } });
      t.anchor.set(1, 0);
      t.y = i * 38 - lines.length * 19;
      t.alpha = 0;
      narr.addChild(t);
      void tweens.to(t, { alpha: 0.85 }, 900, { delay: 1500 + i * 700, unscaled: true });
    });
  }

  private credits() {
    const m = new Modal(1200, 820, { title: '制作与鸣谢' });
    const text = [
      '《命阙》— Vite + TypeScript + PixiJS + yoga-layout',
      '',
      '规则引擎、内容、界面与演出：本项目原创',
      '插画 / 立绘 / 图标：由 gpt-image-2 按《美术风格圣经》生成（清单见 assets/manifest.json）',
      '音效与音乐：WebAudio 实时合成（五声调式生成音乐、程序化音效），无第三方素材',
      '字体：使用系统中文字体；若联网则加载 Google Fonts（Noto Serif SC / Ma Shan Zheng，SIL OFL）',
      '',
      '界面研究参考了炉石传说、万智牌 Arena、符文之地传说、杀戮尖塔、三国杀等作品的公开资料，',
      '仅用于学习交互原理；本作的界面、图标与卡框均为原创设计。',
    ].join('\n');
    const t = new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 24, fill: C.text, lineHeight: 40, wordWrap: true, wordWrapWidth: 1080 } });
    t.position.set(60, 120);
    m.body.addChild(t);
  }

  override update(dt: number) {
    this.acc += dt;
    while (this.acc > 60) { this.acc -= 60; this.spawnA?.(); this.spawnB?.(); }
    this.parts.update(dt);
  }
}
