/** 宝箱 */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { iconSprite } from '../ui/draw';
import { assets, K } from '../assets';
import { tweens, ease } from '../core/tween';
import { sfx } from '../audio/audio';
import { Particles, fxTexture } from '../fx/fx';

export class ChestScene extends RunScreen {
  private parts = new Particles();
  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'chest') return;
    await this.setup({ bg: 'codex', music: `map${Math.min(4, r.act)}` as never, heading: '「 宝 箱 」', dim: 0.4 });
    this.addChild(this.parts);
    const chest = new Container();
    chest.position.set(960, 560);
    chest.addChild(iconSprite('node_chest', 260, '宝', C.gold));
    this.addChild(chest);
    if (!sc.opened) {
      chest.eventMode = 'static';
      chest.cursor = 'pointer';
      const t = new Text({ text: '点击开启', style: { fontFamily: FONT_TITLE, fontSize: 30, fill: C.text, stroke: { color: 0, width: 4 } } });
      t.anchor.set(0.5); t.position.set(960, 760);
      this.addChild(t);
      chest.on('pointertap', async () => {
        sfx('relic');
        this.parts.burst(960, 560, { tex: fxTexture('spark'), n: 60, speed: [150, 500], life: [0.6, 1.4], tint: [0xffd27a, 0xffffff], blend: 'add' });
        await tweens.to(chest.scale, { x: 1.2, y: 1.2 }, 200, { ease: ease.outBack });
        void act({ t: 'open' });
      });
      return;
    }
    if (sc.relic) {
      const def = content().relic(sc.relic);
      await assets.load(K.relic(sc.relic));
      const tex = assets.get(K.relic(sc.relic));
      if (tex) { const s = new Sprite(tex); s.anchor.set(0.5); s.scale.set(160 / Math.max(tex.width, tex.height)); s.position.set(960, 320); this.addChild(s); }
      const t = new Text({ text: `获得遗物【${def.name}】与 ${sc.gold} 金`, style: { fontFamily: FONT_TITLE, fontSize: 36, fill: C.goldLight, stroke: { color: 0, width: 5 } } });
      t.anchor.set(0.5); t.position.set(960, 780);
      const d = new Text({ text: def.text.replace(/\[|\]/g, ''), style: { fontFamily: FONT_BODY, fontSize: 24, fill: C.text, wordWrap: true, wordWrapWidth: 900, align: 'center', breakWords: true } });
      d.anchor.set(0.5, 0); d.position.set(960, 830);
      this.addChild(t, d);
    }
    this.continueButton('继续前进 →', () => void act({ t: 'proceed' }));
    void Graphics;
  }
  override update(dt: number) { this.parts.update(dt); }
}
