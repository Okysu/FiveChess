/** 奖励 (UI研究笔记 §14.3) + 首领遗物三选一 */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { panelSurface } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act, go } from '../router';
import { content } from '../../engine/content';
import type { RewardItem } from '../../engine/run/run';
import { Button, Modal, Tooltip, glossLines, hideTip, showTip, toast, label } from '../ui/widgets';
import { CardView } from '../ui/card';
import { C, FONT_TITLE, FONT_BODY, factionColor } from '../ui/theme';
import { drawPanel, iconSprite } from '../ui/draw';
import { assets, K } from '../assets';
import { tweens, ease } from '../core/tween';
import { sfx } from '../audio/audio';
import { termsOf, inspectCard, openDeck } from '../ui/hud';
import { COLOR_INFO } from '../../engine/glossary';

export class RewardScene extends RunScreen {
  override async enter() {
    const r = session.run!;
    if (r.screen.k === 'bossRelic') { await this.bossRelic(); return; }
    await this.setup({ bg: `battle_${Math.min(4, r.act)}`, music: 'victory', heading: r.screen.k === 'reward' && r.screen.elite ? '「 力 克 强 敌 」' : '「 大 捷 」', dim: 0.55 });
    this.buildList();
    this.continueButton('继续前进 →', () => this.proceed(), 1560, 960);
  }

  private buildList() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'reward') return;
    this.content.removeChildren().forEach((c) => c.destroy({ children: true }));
    sc.items.forEach((it, i) => {
      const row = new Container();
      row.position.set(680, 300 + i * 104);
      const bg = new Graphics();
      drawPanel(bg, 560, 88, { r: 12, alpha: it.taken ? 0.4 : 0.92 });
      row.addChild(bg);
      const { icon, text } = this.describe(it);
      icon.position.set(46, 44);
      const t = new Text({ text, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 28, fill: it.taken ? C.textDim : C.text } });
      t.anchor.set(0, 0.5);
      t.position.set(96, 44);
      row.addChild(icon, t);
      if (it.taken) { const ok = new Text({ text: '✔', style: { fontSize: 32, fill: C.jade } }); ok.anchor.set(0.5); ok.position.set(520, 44); row.addChild(ok); }
      row.eventMode = 'static';
      row.cursor = it.taken ? 'default' : 'pointer';
      row.on('pointertap', () => { if (!it.taken) void this.take(i, it); });
      if (it.k === 'relic') {
        const def = content().relic(it.id);
        row.on('pointerover', (e) => showTip(new Tooltip([{ title: def.name, body: def.text }, ...glossLines(termsOf(def.text))]), 1260, 300 + i * 104));
        row.on('pointerout', hideTip);
      }
      if (it.k === 'potion') {
        const def = content().potions.get(it.id)!;
        row.on('pointerover', () => showTip(new Tooltip([{ title: def.name, body: def.text }]), 1260, 300 + i * 104));
        row.on('pointerout', hideTip);
      }
      row.alpha = 0;
      this.content.addChild(row);
      void tweens.to(row, { alpha: 1 }, 250, { delay: i * 80 });
    });
  }

  private describe(it: RewardItem): { icon: Container; text: string } {
    if (it.k === 'gold') return { icon: iconSprite('ui_gold', 56, '金', C.gold), text: `获得 ${it.n} 金` };
    if (it.k === 'cards') return { icon: iconSprite('ui_deck', 56, '牌', C.text), text: '选择一张卡牌加入牌组' };
    if (it.k === 'relic') {
      const c = new Container();
      const fb = iconSprite('ui_relic', 56, '遗', C.gold);
      c.addChild(fb);
      assets.with(K.relic(it.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(60 / Math.max(t.width, t.height)); c.removeChildren(); c.addChild(s); });
      return { icon: c, text: `遗物【${content().relic(it.id).name}】` };
    }
    const c = new Container();
    c.addChild(iconSprite('ui_potion', 56, '丹', C.jade));
    assets.with(K.potion(it.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(60 / Math.max(t.width, t.height)); c.removeChildren(); c.addChild(s); });
    return { icon: c, text: `丹药【${content().potions.get(it.id)?.name}】` };
  }

  private async take(i: number, it: RewardItem) {
    if (it.k === 'cards') { this.cardChoice(i, it.options); return; }
    const err = session.act({ t: 'take', i });
    if (err) { toast(err === 'potion slots full' ? '行囊已满' : err); sfx('deny'); return; }
    sfx(it.k === 'gold' ? 'gold' : it.k === 'relic' ? 'relic' : 'click');
    this.top.refresh();
    this.buildList();
  }

  private cardChoice(i: number, options: { uid: number; id: string; up: boolean }[]) {
    const m = new Modal(1500, 820, { title: '选择一张卡牌' });
    const own = [content().commander(session.run!.commander).faction, ...(session.run!.lieutenant ? [content().lieutenants.get(session.run!.lieutenant)!.faction] : [])];
    options.forEach((c, k) => {
      const v = new CardView(c);
      v.scale.set(0.001);
      v.position.set(750 + (k - (options.length - 1) / 2) * 360, 400);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointerover', () => { void tweens.to(v.scale, { x: 1.05, y: 1.05 }, 120); sfx('cardHover'); const g = glossLines(v.rulesTerms); if (g.length) showTip(new Tooltip(g, 320), v.x + 450 + 180, 300); });
      v.on('pointerout', () => { void tweens.to(v.scale, { x: 0.95, y: 0.95 }, 120); hideTip(); });
      v.on('pointertap', (e) => { if (e.button === 2) { inspectCard(c.id, c.up); return; } m.close(); session.act({ t: 'take', i, choice: k }); sfx('relic'); this.top.refresh(); this.buildList(); });
      void tweens.to(v.scale, { x: 0.95, y: 0.95 }, 300, { delay: k * 90, ease: ease.outBack });
      m.body.addChild(v);
      const f = v.def.faction;
      const tag = new Text({ text: f === 'N' ? '素 · 中立' : own[0] === f ? `${COLOR_INFO[f].name} · 主色` : `${COLOR_INFO[f].name} · 副色`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: factionColor(f) } });
      tag.anchor.set(0.5); tag.position.set(v.x, 640);
      m.body.addChild(tag);
    });
    const skip = new Button('跳过', { width: 200, height: 64, kind: 'ghost', onClick: () => { m.close(); session.act({ t: 'take', i, choice: null }); this.buildList(); } });
    skip.position.set(540, 720);
    const deck = new Button('查看牌组', { width: 200, height: 64, kind: 'ghost', onClick: () => openDeck(session.run!.deck, '牌组') });
    deck.position.set(760, 720);
    m.body.addChild(skip, deck);
  }

  private proceed() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k === 'reward' && sc.items.some((it) => !it.taken && it.k !== 'potion')) {
      const m = new Modal(700, 300, { title: '还有奖励未领取' });
      const ok = new Button('确定离开', { width: 240, height: 64, kind: 'danger', onClick: () => { m.close(); void act({ t: 'proceed' }); } });
      ok.position.set(80, 180);
      const no = new Button('返回', { width: 240, height: 64, kind: 'ghost', onClick: () => m.close() });
      no.position.set(380, 180);
      m.body.addChild(ok, no);
      return;
    }
    void act({ t: 'proceed' });
  }

  private async bossRelic() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'bossRelic') return;
    await this.setup({ bg: 'victory', music: 'victory', heading: '「 首领遗物 · 三选一 」', dim: 0.45 });
    await assets.loadMany(sc.options.map((id) => K.relic(id)));
    sc.options.forEach((id, i) => {
      const def = content().relic(id);
      const c = new Container();
      c.position.set(960 + (i - (sc.options.length - 1) / 2) * 480, 560);
      const bg = panelSurface(420, 520, true);
      bg.position.set(-210, -260);
      c.addChild(bg);
      const ic = new Container();
      ic.addChild(iconSprite('ui_relic', 150, '遗', C.gold));
      assets.with(K.relic(id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(190 / Math.max(t.width, t.height)); ic.removeChildren(); ic.addChild(s); });
      ic.position.set(0, -130);
      c.addChild(ic);
      const nm = new Text({ text: def.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 36, fill: C.goldLight } });
      nm.anchor.set(0.5); nm.position.set(0, 0);
      const tx = new Text({ text: def.text.replace(/\[|\]/g, ''), style: { fontFamily: FONT_BODY, fontSize: 22, fill: C.text, wordWrap: true, wordWrapWidth: 360, breakWords: true, align: 'center', lineHeight: 34 } });
      tx.anchor.set(0.5, 0); tx.position.set(0, 40);
      c.addChild(nm, tx);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerover', () => void tweens.to(c.scale, { x: 1.04, y: 1.04 }, 120));
      c.on('pointerout', () => void tweens.to(c.scale, { x: 1, y: 1 }, 120));
      c.on('pointertap', () => { sfx('relic'); void act({ t: 'bossRelic', i }); });
      this.content.addChild(c);
    });
    const skip = new Button('放弃', { width: 200, height: 64, kind: 'ghost', onClick: () => void act({ t: 'bossRelic', i: null }) });
    skip.position.set(860, 960);
    this.addChild(skip);
    void label;
    void go;
  }
}
