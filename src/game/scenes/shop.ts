/** 商店 (UI研究笔记 §14.4) */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { RunScreen } from './common';
import { session } from '../state';
import { act, go } from '../router';
import { content } from '../../engine/content';
import { Button, Tooltip, glossLines, hideTip, showTip, toast } from '../ui/widgets';
import { CardView } from '../ui/card';
import { C, FONT_NUM, FONT_TITLE } from '../ui/theme';
import { drawPanel, iconSprite } from '../ui/draw';
import { assets, K } from '../assets';
import { tweens } from '../core/tween';
import { sfx } from '../audio/audio';
import { termsOf, inspectCard } from '../ui/hud';

export class ShopScene extends RunScreen {
  override async enter() {
    await this.setup({ bg: 'shop', music: 'shop', dim: 0.25 });
    await assets.load(K.ui('shopkeeper'));
    const keeper = assets.get(K.ui('shopkeeper'));
    if (keeper) { const s = new Sprite(keeper); s.anchor.set(0.5, 1); s.scale.set(Math.min(820 / keeper.height, 1)); s.position.set(250, 1060); this.addChildAt(s, 1); }
    const bubble = new Text({ text: '「客官，看看？命数也能买卖。」', style: { fontFamily: FONT_TITLE, fontSize: 26, fill: C.text, stroke: { color: 0, width: 4 } } });
    bubble.position.set(40, 160);
    this.addChild(bubble);
    this.build();
    this.continueButton('离　开', () => void act({ t: 'proceed' }), 1600, 970);
  }

  private build() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'shop') return;
    this.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    const shop = sc.shop;
    // cards
    shop.cards.forEach((it, i) => {
      const isNeutral = i >= shop.cards.length - 2;
      const x = 620 + i * 190 + (isNeutral ? 60 : 0);
      const v = new CardView(it.card);
      v.scale.set(0.58);
      v.position.set(x, 300);
      if (it.sold) v.alpha = 0.15;
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointerover', () => { if (!it.sold) void tweens.to(v.scale, { x: 0.64, y: 0.64 }, 100); const g = glossLines(v.rulesTerms); if (g.length) showTip(new Tooltip(g, 320), x + 110, 180); });
      v.on('pointerout', () => { void tweens.to(v.scale, { x: 0.58, y: 0.58 }, 100); hideTip(); });
      v.on('pointertap', (e) => { if (e.button === 2) { inspectCard(it.card.id, it.card.up); return; } if (!it.sold) this.buy('card', i, it.price); });
      this.content.addChild(v);
      if (!it.sold) this.content.addChild(this.price(it.price, x, 440));
    });
    // relics
    const lbl = (t: string, x: number) => { const l = new Text({ text: `── ${t} ──`, style: { fontFamily: FONT_TITLE, fontSize: 26, fill: C.goldLight, stroke: { color: 0, width: 4 } } }); l.anchor.set(0.5); l.position.set(x, 540); this.content.addChild(l); };
    lbl('遗物', 740); lbl('丹药', 1110); lbl('服务', 1480);
    shop.relics.forEach((it, i) => {
      const def = content().relic(it.id);
      const c = new Container();
      c.position.set(620 + i * 120, 660);
      const base = new Graphics().circle(0, 0, 52).fill({ color: 0x0d0907, alpha: 0.7 }).stroke({ width: 2, color: def.tier === 'shop' ? 0x6ad0c0 : C.gold });
      c.addChild(base);
      const ic = new Container();
      ic.addChild(iconSprite('ui_relic', 70, def.name[0] ?? '遗', C.gold));
      assets.with(K.relic(it.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(84 / Math.max(t.width, t.height)); ic.removeChildren(); ic.addChild(s); });
      c.addChild(ic);
      if (it.sold) c.alpha = 0.2;
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerover', () => showTip(new Tooltip([{ title: def.name, body: def.text }, ...glossLines(termsOf(def.text))]), c.x + 60, 560));
      c.on('pointerout', hideTip);
      c.on('pointertap', () => { if (!it.sold) this.buy('relic', i, it.price); });
      this.content.addChild(c);
      if (!it.sold) this.content.addChild(this.price(it.price, c.x, 740));
    });
    shop.potions.forEach((it, i) => {
      const def = content().potions.get(it.id)!;
      const c = new Container();
      c.position.set(1000 + i * 110, 660);
      const base = new Graphics().roundRect(-44, -44, 88, 88, 12).fill({ color: 0x0d0907, alpha: 0.7 }).stroke({ width: 2, color: C.goldDark });
      c.addChild(base);
      const ic = new Container();
      ic.addChild(iconSprite('ui_potion', 60, '丹', C.jade));
      assets.with(K.potion(it.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(76 / Math.max(t.width, t.height)); ic.removeChildren(); ic.addChild(s); });
      c.addChild(ic);
      if (it.sold) c.alpha = 0.2;
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerover', () => showTip(new Tooltip([{ title: def.name, body: def.text }]), c.x + 60, 560));
      c.on('pointerout', hideTip);
      c.on('pointertap', () => { if (!it.sold) this.buy('potion', i, it.price); });
      this.content.addChild(c);
      if (!it.sold) this.content.addChild(this.price(it.price, c.x, 740));
    });
    const full = !r.potions.includes(null);
    if (full) { const t = new Text({ text: `行囊已满（${r.potions.length}/${r.potions.length}）`, style: { fontFamily: FONT_TITLE, fontSize: 18, fill: 0xff9a8a } }); t.anchor.set(0.5); t.position.set(1110, 580); this.content.addChild(t); }
    // removal service
    const svc = new Container();
    svc.position.set(1340, 600);
    const bg = new Graphics();
    drawPanel(bg, 300, 200, { r: 14 });
    svc.addChild(bg);
    const t1 = new Text({ text: '除牌', style: { fontFamily: FONT_TITLE, fontSize: 40, fill: shop.removed ? C.textDim : C.goldLight } });
    t1.anchor.set(0.5); t1.position.set(150, 60);
    const t2 = new Text({ text: shop.removed ? '本店已服务' : '从牌组中移除一张牌', style: { fontFamily: FONT_TITLE, fontSize: 20, fill: C.textDim } });
    t2.anchor.set(0.5); t2.position.set(150, 110);
    svc.addChild(t1, t2);
    if (!shop.removed) svc.addChild(this.price(shop.removePrice, 150, 160));
    svc.eventMode = 'static';
    svc.cursor = shop.removed ? 'default' : 'pointer';
    svc.on('pointertap', () => {
      if (shop.removed) return;
      if (r.gold < shop.removePrice) { toast('金币不足'); sfx('deny'); return; }
      void act({ t: 'removeService' });
    });
    this.content.addChild(svc);
  }

  private price(n: number, x: number, y: number): Container {
    const c = new Container();
    const affordable = session.run!.gold >= n;
    const ic = iconSprite('ui_gold', 26, '金', C.gold);
    ic.position.set(-22, 0);
    const t = new Text({ text: String(n), style: { fontFamily: FONT_NUM, fontSize: 24, fontWeight: 'bold', fill: affordable ? C.goldLight : 0xe05a4a, stroke: { color: 0, width: 4 } } });
    t.anchor.set(0, 0.5);
    t.position.set(-6, 0);
    c.addChild(ic, t);
    c.position.set(x, y);
    return c;
  }

  private buy(what: 'card' | 'relic' | 'potion', i: number, price: number) {
    if (session.run!.gold < price) { toast('金币不足'); sfx('deny'); return; }
    const err = session.act({ t: 'buy', what, i });
    if (err) { toast(err === 'potion slots full' ? '行囊已满' : err); sfx('deny'); return; }
    sfx('gold');
    this.top.refresh();
    this.build();
    void go;
  }
}
