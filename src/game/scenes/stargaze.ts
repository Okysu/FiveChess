/** 观星台: edit the run's fate deck (remove / copy / change suit) or preview the road ahead. */
import { Container, Graphics, Text } from 'pixi.js';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { SUITS, type Suit } from '../../engine/defs';
import { SUIT_INFO } from '../../engine/glossary';
import { Button, toast, label } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { drawPanel } from '../ui/draw';
import { FateCardView } from './combat/fateView';
import { sfx } from '../audio/audio';
import { content } from '../../engine/content';

export class StargazeScene extends RunScreen {
  private sel: number | null = null;
  private grid = new Container();

  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'stargaze') return;
    await this.setup({ bg: 'stargaze', music: 'map3', heading: sc.mode ? '「 改 写 天 命 」' : '「 观 星 台 」', dim: 0.4 });
    if (sc.done) {
      if (sc.preview?.length) {
        const bg = new Graphics();
        drawPanel(bg, 900, 120 + sc.preview.length * 50, { r: 14 });
        bg.position.set(510, 260);
        this.addChild(bg);
        sc.preview.forEach((p, i) => {
          const t = new Text({ text: `第 ${p.row + 1} 层 · ${p.label}`, style: { fontFamily: FONT_BODY, fontSize: 26, fill: C.text } });
          t.position.set(560, 320 + i * 50);
          this.addChild(t);
        });
        const h = label('前路已在星图中显现；地图节点悬停可再次查看。', { fontSize: 22, fill: C.textDim });
        h.position.set(560, 280);
        this.addChild(h);
      } else {
        const t = new Text({ text: '命数已改。', style: { fontFamily: FONT_TITLE, fontSize: 48, fill: C.goldLight } });
        t.anchor.set(0.5); t.position.set(960, 480);
        this.addChild(t);
      }
      this.continueButton('继续前进 →', () => void act({ t: 'proceed' }));
      return;
    }
    this.addChild(this.grid);
    this.drawGrid();
    const info = new Text({ text: `天命牌堆 ${r.fateDeck.length} 张 · 阳 ${r.fateDeck.filter((f) => SUIT_INFO[f.suit].yang && !f.omen).length} / 阴 ${r.fateDeck.filter((f) => !SUIT_INFO[f.suit].yang && !f.omen).length}${r.fateDeck.some((f) => f.omen) ? ` · 凶兆 ${r.fateDeck.filter((f) => f.omen).length}` : ''}`, style: { fontFamily: FONT_TITLE, fontSize: 26, fill: C.text, stroke: { color: 0, width: 4 } } });
    info.position.set(80, 250);
    this.addChild(info);
    const hint = label('先点选一张命牌，再选择操作。每次观星只能做一件事。', { fontSize: 20, fill: C.textDim });
    hint.position.set(80, 290);
    this.addChild(hint);
    const mode = sc.mode;
    const ops: { t: string; op: 'remove' | 'copy' | 'change' | 'preview'; needs: boolean }[] = [
      { t: '删去此牌', op: 'remove', needs: true },
      { t: '复制此牌', op: 'copy', needs: true },
      { t: '改换命纹', op: 'change', needs: true },
      { t: '预览前路', op: 'preview', needs: false },
    ].filter((o) => !mode || o.op === mode) as never;
    ops.forEach((o, i) => {
      const b = new Button(o.t, { width: 240, height: 70, fontSize: 28, kind: o.op === 'preview' ? 'normal' : 'primary', onClick: () => this.doOp(o.op) });
      b.position.set(360 + i * 300, 960);
      this.addChild(b);
    });
  }

  private drawGrid() {
    const r = session.run!;
    this.grid.removeChildren().forEach((c) => c.destroy({ children: true }));
    const sorted = r.fateDeck.map((f, i) => ({ f, i })).sort((a, b) => (a.f.omen ? 1 : 0) - (b.f.omen ? 1 : 0) || SUITS.indexOf(a.f.suit) - SUITS.indexOf(b.f.suit) || a.f.rank - b.f.rank);
    const perRow = 14;
    sorted.forEach(({ f, i }, k) => {
      const v = new FateCardView({ ...f, id: i });
      v.scale.set(0.62);
      v.position.set(170 + (k % perRow) * 118, 400 + Math.floor(k / perRow) * 118);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      if (this.sel === i) { const g = new Graphics().roundRect(-66, -90, 132, 180, 12).stroke({ width: 6, color: 0xffd46a }); v.addChild(g); }
      v.on('pointertap', () => { this.sel = i; sfx('click'); this.drawGrid(); });
      this.grid.addChild(v);
    });
  }

  private doOp(op: 'remove' | 'copy' | 'change' | 'preview') {
    if (op !== 'preview' && this.sel === null) { toast('请先点选一张命牌'); sfx('deny'); return; }
    if (op === 'change') {
      const cur = session.run!.fateDeck[this.sel!]!;
      const pick = new Container();
      const bg = new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0, alpha: 0.6 });
      bg.eventMode = 'static';
      bg.on('pointertap', () => pick.destroy({ children: true }));
      pick.addChild(bg);
      SUITS.filter((s) => s !== cur.suit).forEach((s: Suit, i) => {
        const b = new Button(SUIT_INFO[s].name, { width: 220, height: 80, fontSize: 32, onClick: async () => { pick.destroy({ children: true }); const err = await act({ t: 'fate', op: 'change', idx: this.sel!, suit: s }); if (err) toast(err); } });
        b.position.set(600 + i * 250, 500);
        pick.addChild(b);
      });
      this.addChild(pick);
      return;
    }
    void act({ t: 'fate', op, idx: this.sel ?? undefined }).then((err) => { if (err) toast(err === 'fate deck too small' ? '天命牌堆不能少于 20 张' : err); });
    void content;
  }
}
