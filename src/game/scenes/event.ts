/** 事件 (UI研究笔记 §14.9): illustration left, text & options right. */
import { Container, Sprite, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, maskRect, INSET } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { checkCond } from '../../engine/run/run';
import type { EventOption } from '../../engine/defs';
import { Button, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
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
    const frame = uiPanel(860, 620, 'dark');
    frame.position.set(40, 200);
    this.addChild(frame);
    const tex = assets.get(K.event(ev.id));
    if (tex) {
      // the print sits just under the carved border
      const m = maskRect(76, 236, 788, 548, 0);
      const s = new Sprite(tex);
      const k = Math.max(788 / tex.width, 548 / tex.height);
      s.scale.set(k);
      s.position.set(76 + (788 - tex.width * k) / 2, 236 + (548 - tex.height * k) / 2);
      s.mask = m;
      this.addChild(m, s);
      s.alpha = 0;
      void tweens.to(s, { alpha: 1 }, 500);
    }
    const t = new Text({ text: ev.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(60), fill: C.goldLight, stroke: { color: 0, width: 6 }, letterSpacing: 4 } });
    t.position.set(960, 150);
    this.addChild(t);
    const page = sc.page ? ev.pages?.find((p) => p.id === sc.page) : null;
    const body = sc.outcome ?? page?.text ?? ev.text;
    const options = sc.outcome !== undefined ? [] : page?.options ?? ev.options;
    // options are measured first so the panel can grow to hold text + every option (never spill past its border)
    const rows = options.map((o, i) => this.option(o, i));
    const optsH = rows.reduce((a, r) => a + r.h + 10, 0);
    const maxBodyH = Math.max(160, 1060 - 240 - INSET.dark.y * 2 - 24 - optsH);
    const { texture, result } = richTexture(body, { width: 920 - INSET.dark.x * 2, height: Math.min(360, maxBodyH), fontSize: fs(26), minFontSize: 18, color: 0xf0e4cc, align: 'left', vAlign: 'top', lineHeight: 1.6, shadow: true });
    const bodyH = Math.min(Math.min(360, maxBodyH), result.usedHeight);
    const panelH = Math.max(420, INSET.dark.y * 2 + bodyH + (rows.length ? 24 + optsH : 0));
    const panel = uiPanel(920, panelH, 'dark');
    panel.position.set(940, 240);
    this.addChild(panel);
    const bs = new Sprite(texture);
    bs.position.set(940 + INSET.dark.x, 240 + INSET.dark.y);
    this.addChild(bs);
    if (sc.outcome !== undefined) {
      this.continueButton('继续', () => void act({ t: 'proceed' }), 1580, 960);
      return;
    }
    let y = 240 + INSET.dark.y + bodyH + 24;
    for (const r of rows) { r.c.y = y; this.addChild(r.c); y += r.h + 10; }
  }

  /** one option row, sized to its text; the caller positions it */
  private option(o: EventOption, i: number): { c: Container; h: number } {
    const r = session.run!;
    const ok = !o.requires || checkCond(r, o.requires);
    const c = new Container();
    c.x = 940 + INSET.dark.x - 10;
    const RW = 920 - INSET.dark.x * 2 + 20;
    const PADX = 96; // the row plate's scroll ends are wide: text starts past them
    const txt = new Text({ text: `${o.text}`, style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: ok ? C.text : C.textDim, wordWrap: true, wordWrapWidth: RW - PADX * 2, breakWords: true, lineHeight: 32 } });
    // the plate's carved border is thick: keep text clear of it
    txt.position.set(PADX, 18);
    let h = 18 + txt.height;
    let hintText: Text | null = null;
    if (o.hint || !ok) {
      hintText = new Text({ text: !ok ? `（条件不足）${o.hint ?? ''}` : o.hint!, style: { fontFamily: FONT_BODY, fontSize: fs(19), fill: !ok ? 0xa08070 : hintColor(o.hint!), wordWrap: true, wordWrapWidth: RW - PADX * 2, breakWords: true } });
      hintText.position.set(PADX, h + 4);
      h += 4 + hintText.height;
    }
    h = Math.max(74, h + 20);
    if (!hintText) txt.y = (h - txt.height) / 2;
    const bg = uiPanel(RW, h, 'row');
    const draw = (hover: boolean) => { bg.alpha = ok ? (hover ? 1 : 0.92) : 0.5; };
    draw(false);
    c.addChild(bg, txt);
    if (hintText) c.addChild(hintText);
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
    void Button;
    return { c, h };
  }
}

function hintColor(h: string) {
  return /失去|扣|诅咒|代价|-/.test(h) ? 0xff9a8a : 0x9adfa8;
}
