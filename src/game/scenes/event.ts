/** 事件 (UI研究笔记 §14.9): illustration left, text & options right. */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { panelSurface } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { checkCond } from '../../engine/run/run';
import type { EventOption } from '../../engine/defs';
import { Button, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { drawPanel } from '../ui/draw';
import { assets, K } from '../assets';
import { tweens } from '../core/tween';
import { sfx } from '../audio/audio';
import { richTexture } from '../ui/richtext';

export class EventScene extends RunScreen {
  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'event') return;
    await this.setup({ bg: 'event', music: `map${Math.min(4, r.act)}` as never, dim: 0.35 });
    const ev = content().events.get(sc.id)!;
    await assets.load(K.event(ev.id));
    // illustration
    const frame = panelSurface(860, 620, true);
    frame.position.set(40, 200);
    this.addChild(frame);
    const tex = assets.get(K.event(ev.id));
    if (tex) {
      const m = new Graphics().roundRect(52, 212, 836, 596, 12).fill(0xffffff);
      const s = new Sprite(tex);
      const k = Math.max(836 / tex.width, 596 / tex.height);
      s.scale.set(k);
      s.position.set(52 + (836 - tex.width * k) / 2, 212 + (596 - tex.height * k) / 2);
      s.mask = m;
      this.addChild(m, s);
      s.alpha = 0;
      void tweens.to(s, { alpha: 1 }, 500);
    }
    const t = new Text({ text: ev.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 60, fill: C.goldLight, stroke: { color: 0, width: 6 }, letterSpacing: 4 } });
    t.position.set(960, 150);
    this.addChild(t);
    const page = sc.page ? ev.pages?.find((p) => p.id === sc.page) : null;
    const body = sc.outcome ?? page?.text ?? ev.text;
    const panel = panelSurface(920, 820 - 240, true);
    panel.position.set(940, 240);
    this.addChild(panel);
    const { texture, result } = richTexture(body, { width: 860, height: 380, fontSize: 26, minFontSize: 19, color: 0xf0e4cc, align: 'left', vAlign: 'top', lineHeight: 1.6, shadow: true });
    const bs = new Sprite(texture);
    bs.position.set(970, 268);
    this.addChild(bs);
    const optY = 268 + Math.min(380, result.usedHeight) + 30;
    if (sc.outcome !== undefined) {
      this.continueButton('继续', () => void act({ t: 'proceed' }), 1580, 960);
      return;
    }
    const options = page?.options ?? ev.options;
    options.forEach((o, i) => this.option(o, i, optY + i * 86));
  }

  private option(o: EventOption, i: number, y: number) {
    const r = session.run!;
    const ok = !o.requires || checkCond(r, o.requires);
    const c = new Container();
    c.position.set(970, y);
    const bg = new Graphics();
    const draw = (hover: boolean) => { bg.clear(); drawPanel(bg, 860, 74, { r: 10, fill: hover && ok ? 0x4a2a1a : 0x2a1f19, alpha: ok ? 0.95 : 0.5 }); };
    draw(false);
    c.addChild(bg);
    const txt = new Text({ text: `${o.text}`, style: { fontFamily: FONT_BODY, fontSize: 24, fill: ok ? C.text : C.textDim, wordWrap: true, wordWrapWidth: 820, breakWords: true } });
    txt.position.set(20, o.hint ? 6 : 22);
    c.addChild(txt);
    if (o.hint || !ok) {
      const h = new Text({ text: !ok ? `（条件不足）${o.hint ?? ''}` : o.hint!, style: { fontFamily: FONT_BODY, fontSize: 18, fill: !ok ? 0xa08070 : hintColor(o.hint!) } });
      h.position.set(20, 42);
      c.addChild(h);
    }
    c.eventMode = 'static';
    c.cursor = ok ? 'pointer' : 'not-allowed';
    c.on('pointerover', () => draw(true));
    c.on('pointerout', () => draw(false));
    c.on('pointertap', async () => {
      if (!ok) { sfx('deny'); return; }
      sfx('click');
      const err = await act({ t: 'event', i });
      if (err) toast(err);
    });
    this.addChild(c);
    void Button;
  }
}

function hintColor(h: string) {
  return /失去|扣|诅咒|代价|-/.test(h) ? 0xff9a8a : 0x9adfa8;
}
