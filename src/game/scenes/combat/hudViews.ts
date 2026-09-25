/** Battle HUD pieces (source tray + embers + sacrifice altar, piles, skills, equipment, fields) — generated textures only. */
import { Container, Text } from 'pixi.js';
import type { CombatState, Source, Side } from '../../../engine/combat/state';
import { content } from '../../../engine/content';
import { fillVars } from '../../../engine/glossary';
import { emberCap } from '../../../engine/combat/core';
import { skillDef } from '../../../engine/combat/skills';
import { skillUsable } from '../../../engine/combat/api';
import { C, FONT_NUM, FONT_TITLE, FONT_BODY } from '../../ui/theme';
import { WB, uiSprite, uiFill, nine, panel, pip, ring, frame, icon } from '../../ui/skin';
import { Tooltip, hideTip, showTip, glossLines } from '../../ui/widgets';
import { CardView } from '../../ui/card';
import { termsOf } from '../../ui/hud';
import { SOURCES, ALTAR } from './layout';
import { tweens, ease } from '../../core/tween';

export class SourceTray extends Container {
  private gems: Container[] = [];
  private embers = new Container();
  private countText: Text;
  readonly altar = new Container();
  private altarGlow = new Container();
  highlightIdx = new Set<number>();

  constructor() {
    super();
    // lighter corners: this panel is small and holds a 5x2 gem grid
    const bg = panel(262, 146, 'dark', { cornerScale: 0.55 });
    bg.position.set(SOURCES.x - 14, SOURCES.y - 12);
    this.addChild(bg, this.embers);
    this.countText = new Text({ text: '', style: { fontFamily: FONT_BODY, fontWeight: '700', fontSize: 19, fill: C.text } });
    this.countText.position.set(SOURCES.x + 4, 938);
    this.addChild(this.countText);
    // sacrifice altar: generated bronze ding + selection frame when active
    const glowFrame = frame('gold', 100, 120, 6);
    glowFrame.position.set(-50, -60);
    this.altarGlow.addChild(glowFrame);
    const ding = uiSprite('altar', 108, 108);
    ding.position.set(0, -8);
    const t = new Text({ text: '献', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: WB.white, stroke: { color: WB.ink, width: 5 } } });
    t.anchor.set(0.5); t.position.set(0, 40);
    this.altar.addChild(this.altarGlow, ding, t);
    this.altar.position.set(ALTAR.x, ALTAR.y);
    this.altar.eventMode = 'static';
    this.altar.on('pointerover', () => showTip(new Tooltip([{ title: '献牌为源', body: '每回合至多一次：把一张手牌献出，成为一枚本场永久的[源]。源的颜色等于该牌流派色；中立、状态与诅咒牌献为素源。拖动手牌到此处，或选中手牌后点击此处。' }]), ALTAR.x + 60, ALTAR.y - 200));
    this.altar.on('pointerout', hideTip);
    this.addChild(this.altar);
  }

  setAltar(state: 'ready' | 'used' | 'hot') {
    this.altar.alpha = state === 'used' ? 0.5 : 1;
    this.altarGlow.visible = state !== 'used';
    this.altarGlow.alpha = state === 'hot' ? 1 : 0.55;
    this.altar.scale.set(state === 'hot' ? 1.15 : 1);
  }

  sync(s: CombatState) {
    for (const g of this.gems) g.destroy({ children: true });
    this.gems = [];
    s.sources.forEach((src, i) => {
      const c = this.gem(src, i);
      c.position.set(SOURCES.x + 20 + (i % 5) * 48, SOURCES.y + 20 + Math.floor(i / 5) * 48);
      this.addChild(c);
      this.gems.push(c);
    });
    this.embers.removeChildren().forEach((c) => c.destroy({ children: true }));
    const cap = emberCap(s);
    const inEnemy = s.active === 'enemy';
    const ready = s.sources.filter((x) => x.ready).length;
    for (let i = 0; i < cap; i++) {
      const lit = inEnemy && i < ready;
      const e = icon('ui_ember', 30, lit ? {} : { tint: 0x5a4a40, alpha: 0.5 });
      e.position.set(SOURCES.x + 20 + i * 36, SOURCES.y + 112);
      this.embers.addChild(e);
    }
    const lbl = new Text({ text: '余烬·仅应', style: { fontFamily: FONT_BODY, fontWeight: '700', fontSize: 15, fill: C.textDim } });
    lbl.position.set(SOURCES.x + 20 + cap * 36, SOURCES.y + 102);
    this.embers.addChild(lbl);
    const permCount = s.sources.filter((x) => !x.temp).length;
    this.countText.text = `源 ${permCount}/10 · 可用 ${ready}`;
  }

  private gem(src: Source, i: number): Container {
    const c = new Container();
    c.addChild(pip(src.color, 40, !src.ready));
    if (src.temp) c.addChild(ring('gold', 50));
    if (this.highlightIdx.has(i)) { c.y -= 6; c.addChild(ring('red', 52)); }
    return c;
  }

  highlight(idx: number[] | null, s: CombatState) {
    this.highlightIdx = new Set(idx ?? []);
    this.sync(s);
  }

  gemPos(i: number) { return { x: SOURCES.x + 20 + (i % 5) * 48, y: SOURCES.y + 20 + Math.floor(i / 5) * 48 }; }
}

export class Pile extends Container {
  private count: Text;
  constructor(readonly kind: 'draw' | 'discard' | 'exhaust', x: number, y: number, onClick: () => void) {
    super();
    const w = kind === 'exhaust' ? 80 : 108, h = kind === 'exhaust' ? 112 : 152;
    const back = uiFill('card_back', w, h, kind === 'draw' ? {} : { tint: kind === 'discard' ? 0xb0a490 : 0x7a5a4a });
    back.position.set(-w / 2, -h / 2);
    this.count = new Text({ text: '0', style: { fontFamily: FONT_NUM, fontSize: 32, fontWeight: '900', fill: WB.white, stroke: { color: WB.ink, width: 6 } } });
    this.count.anchor.set(0.5);
    const lbl = new Text({ text: kind === 'draw' ? '抽牌' : kind === 'discard' ? '弃牌' : '燃尽', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 20, fill: WB.white, stroke: { color: WB.ink, width: 5 } } });
    lbl.anchor.set(0.5); lbl.position.set(0, h / 2 - 16);
    this.addChild(back, this.count, lbl);
    this.position.set(x, y);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', onClick);
  }
  set(n: number) { this.count.text = String(n); if (this.kind === 'exhaust') this.visible = n > 0; }
  async bump() { await tweens.to(this.scale, { x: 1.12, y: 1.12 }, 80); await tweens.to(this.scale, { x: 1, y: 1 }, 140, { ease: ease.outBack }); }
}

const SLOT_NAME = { weapon: '武器', armor: '防具', mount: '坐骑', treasure: '宝物' } as const;
const SLOT_ICON = { weapon: 'ui_weapon', armor: 'ui_armorslot', mount: 'ui_mount', treasure: 'ui_treasure' } as const;

export class EquipRow extends Container {
  constructor(private side: Side) { super(); }
  sync(s: CombatState) {
    this.removeChildren().forEach((c) => c.destroy({ children: true }));
    (['weapon', 'armor', 'mount', 'treasure'] as const).forEach((slot, i) => {
      const eq = s.sides[this.side].equip[slot];
      const c = new Container();
      c.position.set(i * 62, 0);
      const g = nine('equip_slot', 58, 58, eq ? {} : { alpha: 0.6 });
      g.position.set(-29, -29);
      c.addChild(g);
      if (eq) {
        const def = content().card(eq.card, eq.up);
        const mini = new CardView({ id: eq.card, up: eq.up });
        mini.scale.set(0.17);
        c.addChild(mini);
        if (slot === 'weapon') {
          const atk = (def.equip?.atk ?? 0) + eq.atkBonus;
          const t = new Text({ text: `${atk}/${eq.durability}`, style: { fontFamily: FONT_NUM, fontSize: 17, fontWeight: '900', fill: WB.white, stroke: { color: WB.ink, width: 4 } } });
          t.anchor.set(0.5); t.position.set(0, 22);
          c.addChild(t);
        }
        c.eventMode = 'static';
        c.on('pointerover', () => { const p = c.getGlobalPosition(); showTip(new Tooltip([{ title: `${SLOT_NAME[slot]}：${def.name}`, body: fillVars(def.text, def.vars) }, ...glossLines(termsOf(def.text))]), p.x, p.y - 180, 'above'); });
        c.on('pointerout', hideTip);
      } else {
        c.addChild(icon(SLOT_ICON[slot], 34, { alpha: 0.45 }));
      }
      this.addChild(c);
    });
  }
}

export class SkillRow extends Container {
  onUse?: (i: number) => void;
  sync(s: CombatState) {
    this.removeChildren().forEach((c) => c.destroy({ children: true }));
    s.skills.forEach((sk, i) => {
      const def = skillDef(s, sk);
      if (!def) return;
      const usable = skillUsable(s, i).ok && s.phase === 'main';
      const c = new Container();
      c.position.set(i * 86, 0);
      c.addChild(uiSprite(def.type === 'passive' ? 'skill_disc' : 'skill_disc_active', 78, 78, sk.from === 'lieutenant' ? { tint: 0xc8f0d8 } : {}));
      if (usable) c.addChild(ring('gold', 94));
      const spent = (def.type === 'limited' && sk.usedCombat) || (def.type === 'active' && sk.used);
      const t = new Text({ text: def.name.slice(0, 2), style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: spent ? 0x8a8078 : WB.white, stroke: { color: WB.ink, width: 5 } } });
      t.anchor.set(0.5);
      c.addChild(t);
      const typeName = { passive: '被动', active: '主动', limited: '限定', awaken: sk.awakened ? '已觉醒' : '觉醒' }[def.type];
      const tag = new Text({ text: typeName, style: { fontFamily: FONT_BODY, fontWeight: '700', fontSize: 14, fill: C.textDim, stroke: { color: WB.ink, width: 3 } } });
      tag.anchor.set(0.5); tag.position.set(0, 48);
      c.addChild(tag);
      c.eventMode = 'static';
      c.cursor = usable ? 'pointer' : 'help';
      c.on('pointerover', () => showTip(new Tooltip([{ title: `${def.name}（${typeName}${sk.from === 'lieutenant' ? '·副将' : ''}）`, body: def.text }, ...glossLines(termsOf(def.text))]), 340, 420));
      c.on('pointerout', hideTip);
      c.on('pointertap', () => { if (usable) this.onUse?.(i); });
      this.addChild(c);
    });
  }
}

export class FieldSlot extends Container {
  constructor(private side: Side, x: number, y: number) { super(); this.position.set(x, y); }
  sync(s: CombatState) {
    this.removeChildren().forEach((c) => c.destroy({ children: true }));
    const f = s.sides[this.side].field;
    const g = nine('equip_slot', 160, 100, f ? {} : { alpha: 0.4 });
    g.position.set(-80, -50);
    this.addChild(g);
    if (!f) return;
    const def = content().card(f.card, f.up);
    const mini = new CardView({ id: f.card, up: f.up });
    mini.scale.set(0.3);
    mini.rotation = this.side === 'player' ? -Math.PI / 2 : Math.PI / 2;
    this.addChild(mini);
    if (f.turns !== null) {
      const t = new Text({ text: String(f.turns), style: { fontFamily: FONT_NUM, fontSize: 20, fontWeight: '900', fill: WB.white, stroke: { color: WB.ink, width: 4 } } });
      t.anchor.set(0.5); t.position.set(60, -36);
      this.addChild(t);
    }
    this.eventMode = 'static';
    this.on('pointerover', () => showTip(new Tooltip([{ title: `阵地：${def.name}`, body: fillVars(def.text, def.vars) }, ...glossLines(termsOf(def.text))]), this.x + 90, this.y - 120));
    this.on('pointerout', hideTip);
  }
}
