/** 开局祈命: before the first map, take one 命签 (a boon with a price, or a small pure boon) — or none. */
import { Container, Sprite, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, icon } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { Button, Tooltip, glossLines, hideTip, showTip, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { tweens } from '../core/tween';
import { richTexture } from '../ui/richtext';
import { termsOf } from '../ui/hud';
import { sfx } from '../audio/audio';

export class BlessingScene extends RunScreen {
  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'blessing') return;
    await this.setup({ bg: 'stargaze', music: 'map1', heading: '「 开 局 祈 命 」', dim: 0.35 });
    const intro = new Text({ text: '命书翻开第一页。取一支命签，带着它走进命阙——命签有得便有失。', style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.text, stroke: { color: 0, width: 4 } } });
    intro.anchor.set(0.5, 0);
    intro.position.set(960, 250);
    this.content.addChild(intro);

    const n = sc.options.length;
    const W = n >= 4 ? 380 : 420, GAP = 36, H = 540;
    const x0 = 960 - (n * W + (n - 1) * GAP) / 2;
    sc.options.forEach((id, i) => {
      const b = content().blessings.get(id)!;
      const c = new Container();
      c.pivot.set(W / 2, H / 2);
      c.position.set(x0 + i * (W + GAP) + W / 2, 318 + H / 2);
      c.addChild(uiPanel(W, H, 'dark'));
      const sign = icon('ui_sign', 96);
      sign.position.set(W / 2, 110);
      const nm = new Text({ text: b.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(46), fill: C.goldLight, stroke: { color: 0, width: 6 }, letterSpacing: 6 } });
      nm.anchor.set(0.5, 0);
      nm.position.set(W / 2, 176);
      const tag = new Text({ text: b.kind === 'boon' ? '小吉' : '有得有失', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(22), fill: b.kind === 'boon' ? 0x9adfa8 : 0xffb07a, stroke: { color: 0, width: 4 } } });
      tag.anchor.set(0.5, 0);
      tag.position.set(W / 2, 240);
      const { texture } = richTexture(b.text, { width: W - 96, height: 220, fontSize: fs(24), minFontSize: 16, color: 0xeadfc8, align: 'center', vAlign: 'top', lineHeight: 1.55 });
      const body = new Sprite(texture);
      body.position.set(48, 292);
      c.addChild(sign, nm, tag, body);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerover', () => {
        void tweens.to(c.scale, { x: 1.03, y: 1.03 }, 120);
        const g = glossLines(termsOf(b.text));
        if (g.length) showTip(new Tooltip(g, 360), c.x + W / 2 + 10, 360);
      });
      c.on('pointerout', () => { void tweens.to(c.scale, { x: 1, y: 1 }, 120); hideTip(); });
      c.on('pointertap', async () => {
        sfx('relic');
        hideTip();
        const err = await act({ t: 'blessing', i });
        if (err) toast(err);
      });
      this.content.addChild(c);
    });
    const skip = new Button('不取命签', { width: 240, height: 64, kind: 'ghost', onClick: () => void act({ t: 'blessing', i: null }) });
    skip.position.set(960 - 120, 890);
    this.content.addChild(skip);
  }
}
