/** Battle HUD pieces: source tray + embers + sacrifice altar, piles, skills, equipment, fields. */
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CombatState, Source, Side } from '../../../engine/combat/state';
import { content } from '../../../engine/content';
import { emberCap } from '../../../engine/combat/core';
import { skillDef } from '../../../engine/combat/skills';
import { skillUsable } from '../../../engine/combat/api';
import { drawPip } from '../../ui/canvasIcons';
import { C, FONT_NUM, FONT_TITLE, FONT_BODY } from '../../ui/theme';
import { drawPanel, iconSprite } from '../../ui/draw';
import { WB, printShape, uiSprite } from '../../ui/skin';
import { Tooltip, hideTip, showTip, glossLines } from '../../ui/widgets';
import { cardBackTexture, CardView } from '../../ui/card';
import { termsOf } from '../../ui/hud';
import { SOURCES, ALTAR } from './layout';
import { tweens, ease } from '../../core/tween';
import type { Color } from '../../../engine/defs';

const pipCache = new Map<string, Texture>();
function pipTex(c: Color, empty = false): Texture {
  const k = `${c}:${empty}`;
  const hit = pipCache.get(k);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  drawPip(cv.getContext('2d')!, c, 48, 48, 34, empty);
  const t = new Texture({ source: new CanvasSource({ resource: cv, resolution: 2 }) });
  pipCache.set(k, t);
  return t;
}

export class SourceTray extends Container {
  private gems: Container[] = [];
  private embers = new Container();
  private countText: Text;
  readonly altar = new Container();
  private altarGlow = new Graphics();
  highlightIdx = new Set<number>();

  constructor() {
    super();
    const bg = new Graphics();
    drawPanel(bg, 250, 136, { r: 12, alpha: 0.8 });
    bg.position.set(SOURCES.x - 8, SOURCES.y - 8);
    this.addChild(bg, this.embers);
    this.countText = new Text({ text: '', style: { fontFamily: FONT_BODY, fontSize: 19, fill: C.text } });
    this.countText.position.set(SOURCES.x + 4, 934);
    this.addChild(this.countText);
    // altar
    const ag = new Graphics();
    const flame = uiSprite('altar', 104, 104, WB.malachite, true);
    flame.position.set(0, -10);
    const t = new Text({ text: '献', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: C.goldLight, stroke: { color: 0, width: 4 } } });
    t.anchor.set(0.5); t.position.set(0, 38);
    this.altar.addChild(this.altarGlow, ag, flame, t);
    this.altar.position.set(ALTAR.x, ALTAR.y);
    this.altar.eventMode = 'static';
    this.altar.on('pointerover', () => showTip(new Tooltip([{ title: '献牌为源', body: '每回合至多一次：把一张手牌献出，成为一枚本场永久的[源]。源的颜色等于该牌流派色；中立、状态与诅咒牌献为素源。拖动手牌到此处，或选中手牌后点击此处。' }]), ALTAR.x + 60, ALTAR.y - 200));
    this.altar.on('pointerout', hideTip);
    this.addChild(this.altar);
  }

  setAltar(state: 'ready' | 'used' | 'hot') {
    this.altarGlow.clear();
    if (state === 'used') { this.altar.alpha = 0.5; return; }
    this.altar.alpha = 1;
    const col = state === 'hot' ? 0xffb05a : 0xff7a3a;
    for (let i = 0; i < 3; i++) this.altarGlow.roundRect(-52 - i * 4, -62 - i * 4, 104 + i * 8, 124 + i * 8, 14).stroke({ width: 3, color: col, alpha: (state === 'hot' ? 0.8 : 0.4) - i * 0.12 });
    this.altar.scale.set(state === 'hot' ? 1.15 : 1);
  }

  sync(s: CombatState) {
    for (const g of this.gems) g.destroy({ children: true });
    this.gems = [];
    const perm = s.sources;
    perm.forEach((src, i) => {
      const c = this.gem(src, i);
      c.position.set(SOURCES.x + 20 + (i % 5) * 48, SOURCES.y + 20 + Math.floor(i / 5) * 48);
      this.addChild(c);
      this.gems.push(c);
    });
    // ember slots
    this.embers.removeChildren();
    const cap = emberCap(s);
    const inEnemy = s.active === 'enemy';
    const ready = s.sources.filter((x) => x.ready).length;
    for (let i = 0; i < cap; i++) {
      const lit = inEnemy && i < ready;
      const e = iconSprite('ui_ember', 30, '烬', lit ? 0xff9a3a : 0x5a4a40);
      e.alpha = lit ? 1 : 0.4;
      e.position.set(SOURCES.x + 20 + i * 36, SOURCES.y + 112);
      this.embers.addChild(e);
    }
    const lbl = new Text({ text: '余烬 · 仅[应]', style: { fontFamily: FONT_BODY, fontSize: 15, fill: C.textDim } });
    lbl.text = '余烬·仅应';
    lbl.position.set(SOURCES.x + 20 + cap * 36, SOURCES.y + 102);
    this.embers.addChild(lbl);
    const permCount = s.sources.filter((x) => !x.temp).length;
    this.countText.text = `源 ${permCount}/10 · 可用 ${ready}`;
  }

  private gem(src: Source, i: number): Container {
    const c = new Container();
    const sp = new Sprite(pipTex(src.color));
    sp.anchor.set(0.5);
    sp.width = sp.height = 40;
    c.addChild(sp);
    if (!src.ready) { sp.alpha = 0.3; sp.tint = 0x707070; }
    if (src.temp) { const r = new Graphics().circle(0, 0, 22).stroke({ width: 2, color: 0xffffff, alpha: 0.7 }); c.addChild(r); }
    if (this.highlightIdx.has(i)) { c.y -= 6; const r = new Graphics().circle(0, 0, 23).stroke({ width: 3, color: 0xffffff }); c.addChild(r); }
    return c;
  }

  highlight(idx: number[] | null, s: CombatState) {
    this.highlightIdx = new Set(idx ?? []);
    this.sync(s);
  }

  /** world position of a source gem (for fly-in animations) */
  gemPos(i: number) { return { x: SOURCES.x + 20 + (i % 5) * 48, y: SOURCES.y + 20 + Math.floor(i / 5) * 48 }; }
}

export class Pile extends Container {
  private count: Text;
  constructor(readonly kind: 'draw' | 'discard' | 'exhaust', x: number, y: number, onClick: () => void) {
    super();
    const w = kind === 'exhaust' ? 80 : 108, h = kind === 'exhaust' ? 112 : 152;
    const back = new Sprite(cardBackTexture());
    back.anchor.set(0.5);
    back.width = w; back.height = h;
    if (kind !== 'draw') back.tint = kind === 'discard' ? 0x9a8a7a : 0x6a4a3a;
    const g = new Graphics().roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 10).stroke({ width: 2, color: C.goldDark });
    this.count = new Text({ text: '0', style: { fontFamily: FONT_NUM, fontSize: 30, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 6 } } });
    this.count.anchor.set(0.5);
    const lbl = new Text({ text: kind === 'draw' ? '抽牌' : kind === 'discard' ? '弃牌' : '燃尽', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 20, fill: C.goldLight, stroke: { color: 0, width: 4 } } });
    lbl.anchor.set(0.5); lbl.position.set(0, h / 2 - 16);
    this.addChild(g, back, this.count, lbl);
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
      const g = new Graphics().roundRect(-28, -28, 56, 56, 10).fill({ color: 0x0d0907, alpha: 0.75 }).stroke({ width: 1.5, color: eq ? C.gold : C.goldDark, alpha: eq ? 1 : 0.5 });
      c.addChild(g);
      if (eq) {
        const def = content().card(eq.card, eq.up);
        const mini = new CardView({ id: eq.card, up: eq.up });
        mini.scale.set(0.17);
        c.addChild(mini);
        if (slot === 'weapon') {
          const atk = (def.equip?.atk ?? 0) + eq.atkBonus;
          const t = new Text({ text: `${atk}/${eq.durability}`, style: { fontFamily: FONT_NUM, fontSize: 16, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 4 } } });
          t.anchor.set(0.5); t.position.set(0, 22);
          c.addChild(t);
        }
        c.eventMode = 'static';
        c.on('pointerover', () => { const p = c.getGlobalPosition(); showTip(new Tooltip([{ title: `${SLOT_NAME[slot]}：${def.name}`, body: def.text }, ...glossLines(termsOf(def.text))]), p.x / 1, p.y - 180, 'above'); });
        c.on('pointerout', hideTip);
      } else {
        const ic = iconSprite(SLOT_ICON[slot], 34, SLOT_NAME[slot][0]!, 0x6a5a48);
        ic.alpha = 0.45;
        c.addChild(ic);
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
      const col = def.type === 'passive' ? 0x3a3024 : def.type === 'awaken' ? 0x3a2a4a : 0x4a1a12;
      const g = printShape(new Graphics(), (gg, dx, dy) => gg.circle(dx, dy, 36), def.type === 'passive' ? WB.ink2 : def.type === 'awaken' ? WB.plum : WB.vermilionDk, { offset: 4 });
      g.circle(0, 0, 30).stroke({ width: 3, color: usable ? WB.ochre : sk.from === 'lieutenant' ? WB.malachite : 0x5a4a38 });
      if (usable) g.circle(0, 0, 42).stroke({ width: 2, color: 0xffd46a, alpha: 0.6 });
      c.addChild(g);
      const t = new Text({ text: def.name.slice(0, 2), style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: (def.type === 'limited' && sk.usedCombat) || (def.type === 'active' && sk.used) ? 0x6a6060 : C.goldLight, stroke: { color: 0, width: 4 } } });
      t.anchor.set(0.5);
      c.addChild(t);
      const typeName = { passive: '被动', active: '主动', limited: '限定', awaken: sk.awakened ? '已觉醒' : '觉醒' }[def.type];
      const tag = new Text({ text: typeName, style: { fontFamily: FONT_BODY, fontSize: 13, fill: C.textDim } });
      tag.anchor.set(0.5); tag.position.set(0, 46);
      c.addChild(tag);
      c.eventMode = 'static';
      c.cursor = usable ? 'pointer' : 'help';
      c.on('pointerover', () => { const p = c.getGlobalPosition(); showTip(new Tooltip([{ title: `${def.name}（${typeName}${sk.from === 'lieutenant' ? '·副将' : ''}）`, body: def.text }, ...glossLines(termsOf(def.text))]), 340, 420); void p; });
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
    const g = new Graphics().roundRect(-80, -50, 160, 100, 10).stroke({ width: 1.5, color: f ? C.gold : C.goldDark, alpha: f ? 0.9 : 0.35 });
    this.addChild(g);
    if (!f) return;
    const def = content().card(f.card, f.up);
    const mini = new CardView({ id: f.card, up: f.up });
    mini.scale.set(0.3);
    mini.rotation = this.side === 'player' ? -Math.PI / 2 : Math.PI / 2;
    this.addChild(mini);
    if (f.turns !== null) {
      const t = new Text({ text: `⌛${f.turns}`, style: { fontFamily: FONT_NUM, fontSize: 18, fill: 0xffe8a0, stroke: { color: 0, width: 4 } } });
      t.anchor.set(0.5); t.position.set(60, -36);
      this.addChild(t);
    }
    this.eventMode = 'static';
    this.on('pointerover', () => showTip(new Tooltip([{ title: `阵地：${def.name}`, body: def.text }, ...glossLines(termsOf(def.text))]), this.x + 90, this.y - 120));
    this.on('pointerout', hideTip);
  }
}
