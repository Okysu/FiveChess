/**
 * Card renderer — woodblock print style (docs/美术风格圣经.md §4). Base size 300×420; scale for other tiers.
 * Layers: paper body → art window → school woodblock frame (9-slice) → name ribbon → rules box → cost / stats.
 * The static layer is cached as a texture; cost, rules text and stats are live.
 */
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CardDef, Color } from '../../engine/defs';
import { content } from '../../engine/content';
import { assets, K } from '../assets';
import { FONT_NUM, FONT_TITLE, FONT_BODY, RARITY_COLOR, RARITY_NAME, TYPE_NAME, factionColor, factionDark, factionLight } from './theme';
import { drawGem } from './draw';
import { richTexture, type VarInfo } from './richtext';
import { drawPip, hex } from './canvasIcons';
import { COLOR_INFO } from '../../engine/glossary';
import { WB, printRect, printShape, surface, uiSprite, printOutline } from './skin';

export const CARD_W = 300;
export const CARD_H = 420;
const ART = { x: 26, y: 28, w: 248, h: 180 };
const RULES = { x: 32, y: 276, w: 236, h: 104 };
const RIBBON_Y = 200;

export interface CardLive {
  cost?: { g: number; c: Color[]; x: boolean };
  payable?: boolean;
  missing?: Color[];
  vars?: Record<string, VarInfo>;
  atk?: number;
  hp?: number;
}

export class CardView extends Container {
  def: CardDef;
  readonly cardId: string;
  readonly up: boolean;
  cardUid: number;
  private staticLayer = new Container();
  private dyn = new Container();
  private glow = new Graphics();
  private costLayer = new Container();
  private rulesSprite = new Sprite();
  private statsLayer = new Container();
  private back?: Sprite;
  private lastRules = '';
  private lastCost = '';
  private lastStats = '';
  private cacheQueued = false;
  faceDown = false;
  glowState: 'none' | 'playable' | 'response' | 'selected' | 'danger' = 'none';

  constructor(card: { id: string; up: boolean; uid?: number }, opts: { live?: CardLive } = {}) {
    super();
    this.cardId = card.id;
    this.up = card.up;
    this.cardUid = card.uid ?? -1;
    this.def = content().card(card.id, card.up);
    this.pivot.set(CARD_W / 2, CARD_H / 2);
    this.addChild(this.glow, this.staticLayer, this.dyn);
    this.dyn.addChild(this.rulesSprite, this.costLayer, this.statsLayer);
    this.buildStatic();
    this.update(opts.live ?? {});
  }

  private buildStatic() {
    const d = this.def;
    const f = d.faction;
    const L = this.staticLayer;
    // paper body with offset print shadow
    L.addChild(printRect(new Graphics(), 0, 0, CARD_W, CARD_H, WB.paper, { r: 12, offset: 6, outline: 3.5 }));
    // art window
    const artHolder = new Container();
    const mask = this.artMaskShape(new Graphics()).fill(0xffffff);
    artHolder.addChild(mask);
    const fb = new Sprite(fallbackArt(f, d.name));
    fb.position.set(ART.x, ART.y);
    fb.width = ART.w; fb.height = ART.h;
    fb.mask = mask;
    artHolder.addChild(fb);
    L.addChild(artHolder);
    assets.with(K.card(f, d.id), (t) => {
      const s = new Sprite(t);
      const k = Math.max(ART.w / t.width, ART.h / t.height);
      s.scale.set(k);
      s.position.set(ART.x + (ART.w - t.width * k) / 2, ART.y + (ART.h - t.height * k) * 0.35);
      s.mask = mask;
      artHolder.addChild(s);
      fb.visible = false;
      this.queueCache();
    });
    L.addChild(this.artMaskShape(new Graphics()).stroke({ width: 3, color: WB.ink }));
    // school frame (woodblock texture, 9-slice)
    const frame = surface(`card_frame_${f}`, CARD_W, CARD_H, { fill: factionColor(f), r: 12 });
    // the fallback surface is a filled rect — replace with an outline-only printed frame
    if (!assets.has(K.ui(`card_frame_${f}`))) {
      frame.removeChildren();
      const g = new Graphics();
      g.roundRect(4, 4, CARD_W - 8, CARD_H - 8, 10).stroke({ width: 12, color: factionColor(f) });
      g.roundRect(0, 0, CARD_W, CARD_H, 12).stroke({ width: 3.5, color: WB.ink });
      g.roundRect(11, 11, CARD_W - 22, CARD_H - 22, 6).stroke({ width: 2, color: WB.ink });
      frame.addChild(g);
    }
    L.addChild(frame);
    this.watchLoad(K.ui(`card_frame_${f}`));
    // rules box: slightly darker paper, carved outline
    L.addChild(printRect(new Graphics(), RULES.x - 6, RULES.y - 6, RULES.w + 12, RULES.h + 12, 0xe0cfa4, { r: 6, offset: 3, outline: 2.5, shadow: factionDark(f) }));
    // name ribbon
    const ribbon = surface(`ribbon_${f}`, CARD_W + 16, 54, { fill: factionColor(f), r: 6 });
    ribbon.position.set(-8, RIBBON_Y);
    L.addChild(ribbon);
    this.watchLoad(K.ui(`ribbon_${f}`));
    const nameText = new Text({
      text: d.name + (this.up && !d.name.endsWith('+') ? '+' : ''),
      style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: d.name.length > 6 ? 21 : 25, fill: this.up ? 0xc8ffb0 : WB.white, stroke: { color: WB.ink, width: 5 }, letterSpacing: 2 },
    });
    nameText.anchor.set(0.5);
    nameText.position.set(CARD_W / 2, RIBBON_Y + 27);
    if (nameText.width > CARD_W - 90) nameText.scale.set((CARD_W - 90) / nameText.width);
    L.addChild(nameText);
    // rarity gem + type line
    const rg = new Graphics();
    if (!['basic', 'token', 'special'].includes(d.rarity)) drawGem(rg, CARD_W / 2, RIBBON_Y + 54, 7, RARITY_COLOR[d.rarity]!);
    L.addChild(rg);
    const typeText = new Text({
      text: `${TYPE_NAME[d.type] ?? ''} · ${COLOR_INFO[f].name} · ${RARITY_NAME[d.rarity] ?? ''}`,
      style: { fontFamily: FONT_BODY, fontWeight: '700', fontSize: 13, fill: 0x4a3a28, letterSpacing: 1 },
    });
    typeText.anchor.set(0.5);
    typeText.position.set(CARD_W / 2, 266 - 1);
    typeText.visible = false; // the rarity gem sits there; type is shown in tooltips/inspect
    L.addChild(typeText);
    // response seal
    if (d.type === 'response' || (d.keywords ?? []).includes('response')) {
      const seal = new Container();
      const sg = printRect(new Graphics(), -22, -22, 44, 44, WB.vermilion, { r: 4, offset: 3 });
      seal.addChild(sg);
      const st = new Text({ text: '应', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: WB.white } });
      st.anchor.set(0.5);
      seal.addChild(st);
      seal.position.set(CARD_W - 40, 44);
      seal.rotation = 0.08;
      L.addChild(seal);
    }
    if (d.rarity === 'legendary') {
      const lg = new Graphics();
      lg.roundRect(-5, -5, CARD_W + 10, CARD_H + 10, 15).stroke({ width: 4, color: WB.ochre });
      lg.roundRect(-8, -8, CARD_W + 16, CARD_H + 16, 17).stroke({ width: 2, color: WB.ink });
      L.addChildAt(lg, 0);
    }
    this.queueCache();
  }

  private watchLoad(key: string) { if (assets.has(key)) assets.with(key, () => this.queueCache()); }

  private artMaskShape(g: Graphics): Graphics {
    const { x, y, w, h } = ART;
    switch (this.def.type) {
      case 'unit': // arched top
        g.moveTo(x, y + h).lineTo(x, y + 50).quadraticCurveTo(x, y, x + 50, y).lineTo(x + w - 50, y).quadraticCurveTo(x + w, y, x + w, y + 50).lineTo(x + w, y + h).closePath();
        break;
      case 'response':
        g.poly([x + 20, y, x + w - 20, y, x + w, y + 20, x + w, y + h - 20, x + w - 20, y + h, x + 20, y + h, x, y + h - 20, x, y + 20]);
        break;
      case 'equip':
        g.moveTo(x, y + h).lineTo(x, y + 36).arcTo(x + w / 2, y - 26, x + w, y + 36, w * 0.9).lineTo(x + w, y + h).closePath();
        break;
      case 'delay':
        g.moveTo(x, y).lineTo(x + w, y).quadraticCurveTo(x + w - 22, y + h / 2, x + w, y + h).lineTo(x, y + h).quadraticCurveTo(x + 22, y + h / 2, x, y).closePath();
        break;
      default:
        g.rect(x, y, w, h);
    }
    return g;
  }

  private queueCache() {
    if (this.cacheQueued) return;
    this.cacheQueued = true;
    requestAnimationFrame(() => {
      this.cacheQueued = false;
      if (this.destroyed) return;
      try { this.staticLayer.cacheAsTexture(false); this.staticLayer.cacheAsTexture({ resolution: 2 } as never); } catch { /* ignore */ }
    });
  }

  update(live: CardLive) {
    const d = this.def;
    const cost = live.cost ?? { g: d.cost.g === 'X' ? 0 : d.cost.g, c: d.cost.c ?? [], x: d.cost.g === 'X' };
    const baseG = d.cost.g === 'X' ? 0 : d.cost.g;
    const costKey = JSON.stringify([cost, live.payable, live.missing]);
    if (costKey !== this.lastCost) {
      this.lastCost = costKey;
      this.costLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      const disc = uiSprite('cost_disc', 70, 70, WB.azurite, true);
      disc.position.set(40, 40);
      if (live.payable === false) disc.alpha = 0.75;
      this.costLayer.addChild(disc);
      const numCol = cost.g < baseG ? 0x9aff8a : cost.g > baseG ? 0xff8a6a : live.payable === false ? 0xc8b8a8 : WB.white;
      const n = new Text({ text: cost.x ? 'X' : String(cost.g), style: { fontFamily: FONT_NUM, fontWeight: '900', fontSize: 34, fill: numCol, stroke: { color: WB.ink, width: 6 } } });
      n.anchor.set(0.5);
      n.position.set(40, 39);
      this.costLayer.addChild(n);
      if (cost.c.length) {
        const cv = document.createElement('canvas');
        const per = 26;
        cv.width = (per * cost.c.length + 8) * 2; cv.height = 34 * 2;
        const ctx = cv.getContext('2d')!;
        ctx.scale(2, 2);
        const missing = [...(live.missing ?? [])];
        cost.c.forEach((c, i) => {
          const mi = missing.indexOf(c);
          const empty = mi >= 0;
          if (empty) missing.splice(mi, 1);
          drawPip(ctx, c, 15 + i * per, 17, 11, empty);
        });
        const s = new Sprite(new Texture({ source: new CanvasSource({ resource: cv, resolution: 2 }) }));
        s.position.set(72, 16);
        this.costLayer.addChild(s);
      }
    }
    const vars: Record<string, VarInfo> = {};
    for (const [k, v] of Object.entries(d.vars ?? {})) vars[k] = live.vars?.[k] ?? { value: v, base: v };
    const rulesKey = JSON.stringify([d.text, vars]);
    if (rulesKey !== this.lastRules) {
      this.lastRules = rulesKey;
      const old = this.rulesSprite.texture;
      const { texture } = richTexture(d.text, { width: RULES.w, height: RULES.h, fontSize: 19, minFontSize: 12, color: 0x241a12, vars, align: 'center', weight: '600' });
      this.rulesSprite.texture = texture;
      this.rulesSprite.position.set(RULES.x, RULES.y);
      if (old && old !== Texture.EMPTY) old.destroy(true);
    }
    const statKey = JSON.stringify([live.atk, live.hp]);
    if (statKey !== this.lastStats) {
      this.lastStats = statKey;
      this.statsLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      if (d.type === 'unit' && d.unit) {
        this.statsLayer.addChild(statBadge('atk', live.atk ?? d.unit.atk, d.unit.atk, 30, CARD_H - 28));
        this.statsLayer.addChild(statBadge('hp', live.hp ?? d.unit.hp, d.unit.hp, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'equip' && d.equip) {
        if (d.equip.atk !== undefined) this.statsLayer.addChild(statBadge('atk', d.equip.atk, d.equip.atk, 30, CARD_H - 28));
        if (d.equip.durability) this.statsLayer.addChild(statBadge('dur', d.equip.durability, d.equip.durability, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'delay' && d.delay) {
        this.statsLayer.addChild(statBadge('turns', d.delay.turns, d.delay.turns, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'field' && d.field?.duration) {
        this.statsLayer.addChild(statBadge('turns', d.field.duration, d.field.duration, CARD_W - 30, CARD_H - 28));
      }
    }
  }

  setGlow(state: CardView['glowState']) {
    if (state === this.glowState) return;
    this.glowState = state;
    this.glow.clear();
    if (state === 'none') return;
    const col = state === 'playable' ? WB.ochre : state === 'response' ? WB.vermilion : state === 'danger' ? 0xe02a1a : 0x6ac8e0;
    printOutline(this.glow, 0, 0, CARD_W, CARD_H, col, 12);
  }

  setFaceDown(down: boolean) {
    this.faceDown = down;
    if (down && !this.back) {
      this.back = new Sprite(cardBackTexture());
      this.back.width = CARD_W; this.back.height = CARD_H;
      this.addChild(this.back);
      assets.with(K.ui('card_back'), (t) => { if (this.back) { this.back.texture = t; this.back.width = CARD_W; this.back.height = CARD_H; } });
    }
    if (this.back) this.back.visible = down;
    this.staticLayer.visible = !down;
    this.dyn.visible = !down;
  }

  get rulesTerms(): string[] {
    const out: string[] = [];
    for (const m of this.def.text.matchAll(/\[([^\]]+)\]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
    return out;
  }
}

export function statBadge(kind: 'atk' | 'hp' | 'dur' | 'turns', value: number, base: number, x: number, y: number, size = 54): Container {
  const c = new Container();
  const id = kind === 'atk' ? 'stat_atk' : kind === 'hp' ? 'stat_hp' : null;
  if (id) c.addChild(uiSprite(id, size, size, kind === 'atk' ? WB.ochre : WB.vermilion, true));
  else {
    const g = new Graphics();
    if (kind === 'dur') printShape(g, (gg, dx, dy) => gg.poly([dx, -22 + dy, 19 + dx, -11 + dy, 19 + dx, 11 + dy, dx, 22 + dy, -19 + dx, 11 + dy, -19 + dx, -11 + dy]), 0x7a8a9a, { offset: 3 });
    else printShape(g, (gg, dx, dy) => gg.poly([-15 + dx, -21 + dy, 15 + dx, -21 + dy, 4 + dx, dy, 15 + dx, 21 + dy, -15 + dx, 21 + dy, -4 + dx, dy]), WB.ochre, { offset: 3 });
    c.addChild(g);
  }
  const col = value > base ? 0x9aff8a : value < base ? 0xff8a6a : WB.white;
  const t = new Text({ text: String(value), style: { fontFamily: FONT_NUM, fontWeight: '900', fontSize: Math.round(size * 0.48), fill: col, stroke: { color: WB.ink, width: 6 } } });
  t.anchor.set(0.5);
  t.y = 1;
  c.addChild(t);
  c.position.set(x, y);
  return c;
}

// ───────────── procedural fallbacks (flat printed) ─────────────
const artCache = new Map<string, Texture>();
export function fallbackArt(f: Color, name: string): Texture {
  const key = `${f}:${name[0]}`;
  const hit = artCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 248; cv.height = 180;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = hex(factionDark(f));
  ctx.fillRect(0, 0, 248, 180);
  // printed cloud bands
  ctx.fillStyle = hex(factionColor(f));
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(40 + i * 45, 150 - (i % 2) * 20, 50, 18, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = hex(factionLight(f));
  ctx.font = 'bold 120px "Noto Serif SC","SimSun",serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.85;
  ctx.fillText(name[0] ?? '命', 124, 84);
  const t = new Texture({ source: new CanvasSource({ resource: cv }) });
  artCache.set(key, t);
  return t;
}

let backTex: Texture | null = null;
export function cardBackTexture(): Texture {
  if (backTex) return backTex;
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 420;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#2a4f8a';
  ctx.beginPath(); ctx.roundRect(0, 0, 300, 420, 12); ctx.fill();
  ctx.strokeStyle = '#1b1512'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = '#d9a23a'; ctx.lineWidth = 4; ctx.strokeRect(18, 18, 264, 384);
  ctx.beginPath(); ctx.arc(150, 210, 70, 0, Math.PI * 2); ctx.fillStyle = '#c8321f'; ctx.fill(); ctx.strokeStyle = '#1b1512'; ctx.stroke();
  ctx.fillStyle = '#eadbb6'; ctx.font = 'bold 70px "Noto Serif SC","SimSun",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('命', 150, 214);
  backTex = new Texture({ source: new CanvasSource({ resource: cv }) });
  return backTex;
}
