/**
 * Card renderer (docs/UI研究笔记.md §1.3, style bible §4). Base size 300×420; scale for other tiers.
 * Static parts (frame, art, banner, type line) are cached as a texture; cost, rules text and stats are live.
 */
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CardDef, Color } from '../../engine/defs';
import { content } from '../../engine/content';
import { assets, K } from '../assets';
import { C, FONT_BODY, FONT_NUM, FONT_TITLE, FRAME_METAL, RARITY_COLOR, RARITY_NAME, TYPE_NAME, factionColor, factionDark, factionLight } from './theme';
import { drawGem, hgrad, lighten, darken, vgrad } from './draw';
import { richTexture, type VarInfo } from './richtext';
import { drawPip, hex } from './canvasIcons';
import { COLOR_INFO } from '../../engine/glossary';

export const CARD_W = 300;
export const CARD_H = 420;
const ART = { x: 14, y: 14, w: 272, h: 206 };
const RULES = { x: 24, y: 282, w: 252, h: 100 };

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
  private artSprite?: Sprite;
  faceDown = false;
  glowState: 'none' | 'playable' | 'response' | 'selected' | 'danger' = 'none';

  constructor(card: { id: string; up: boolean; uid?: number }, opts: { live?: CardLive; noCache?: boolean } = {}) {
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
    const [metal, metalLight, metalDark] = FRAME_METAL[f];
    const L = this.staticLayer;
    // drop shadow
    const sh = new Graphics().roundRect(4, 8, CARD_W, CARD_H, 18).fill({ color: 0x000000, alpha: 0.35 });
    L.addChild(sh);
    // outer metal frame
    const frame = new Graphics();
    frame.roundRect(0, 0, CARD_W, CARD_H, 18).fill({ fill: vgrad(metalLight, metalDark, metal) } as never);
    frame.roundRect(0, 0, CARD_W, CARD_H, 18).stroke({ width: 2, color: d.rarity === 'legendary' ? 0xffd27a : C.goldDark });
    frame.roundRect(6, 6, CARD_W - 12, CARD_H - 12, 13).fill({ color: 0x120c09 });
    L.addChild(frame);
    // art
    const artHolder = new Container();
    const mask = this.artMask();
    artHolder.addChild(mask);
    const fb = new Sprite(fallbackArt(f, d.name));
    fb.position.set(ART.x, ART.y);
    fb.width = ART.w; fb.height = ART.h;
    fb.mask = mask;
    artHolder.addChild(fb);
    L.addChild(artHolder);
    const key = K.card(f, d.id);
    assets.with(key, (t) => {
      const s = new Sprite(t);
      // crop the square art to the window (centered slightly above middle)
      const k = Math.max(ART.w / t.width, ART.h / t.height);
      s.scale.set(k);
      s.position.set(ART.x + (ART.w - t.width * k) / 2, ART.y + (ART.h - t.height * k) * 0.35);
      s.mask = mask;
      artHolder.addChild(s);
      fb.visible = false;
      this.artSprite = s;
      this.refreshCache();
    });
    // art window rim
    const rim = this.artMaskShape(new Graphics()).stroke({ width: 3, color: lighten(metal, 0.2) });
    L.addChild(rim);
    // name banner ribbon
    const fc = factionColor(f);
    const ribbon = new Graphics();
    const by = 212;
    ribbon.poly([-6, by + 4, 10, by, CARD_W - 10, by, CARD_W + 6, by + 4, CARD_W - 4, by + 22, CARD_W + 6, by + 40, CARD_W - 10, by + 44, 10, by + 44, -6, by + 40, 4, by + 22])
      .fill({ fill: vgrad(lighten(fc, 0.25), darken(fc, 0.45), fc) } as never);
    ribbon.poly([-6, by + 4, 10, by, CARD_W - 10, by, CARD_W + 6, by + 4, CARD_W - 4, by + 22, CARD_W + 6, by + 40, CARD_W - 10, by + 44, 10, by + 44, -6, by + 40, 4, by + 22])
      .stroke({ width: 1.5, color: C.goldLight, alpha: 0.8 });
    L.addChild(ribbon);
    const nameText = new Text({
      text: d.name + (this.up && !d.name.endsWith('+') ? '+' : ''),
      style: { fontFamily: FONT_TITLE, fontSize: d.name.length > 6 ? 21 : 25, fill: this.up ? 0xb8ffc8 : 0xfff4dc, stroke: { color: 0x1a0c06, width: 4 }, fontWeight: 'bold', letterSpacing: 2 },
    });
    nameText.anchor.set(0.5);
    nameText.position.set(CARD_W / 2, by + 22);
    if (nameText.width > CARD_W - 60) nameText.scale.set((CARD_W - 60) / nameText.width);
    L.addChild(nameText);
    // rarity gem
    const rg = new Graphics();
    if (d.rarity !== 'basic' && d.rarity !== 'token' && d.rarity !== 'special') {
      const rc = RARITY_COLOR[d.rarity]!;
      drawGem(rg, CARD_W / 2, by + 46, 7, rc, lighten(rc, 0.5), darken(rc, 0.4));
    }
    L.addChild(rg);
    // type line
    const typeText = new Text({
      text: `${TYPE_NAME[d.type] ?? ''} · ${COLOR_INFO[f].name} · ${RARITY_NAME[d.rarity] ?? ''}`,
      style: { fontFamily: FONT_BODY, fontSize: 13, fill: 0xd8c8a8, letterSpacing: 1 },
    });
    typeText.anchor.set(0.5);
    typeText.position.set(CARD_W / 2, 268);
    L.addChild(typeText);
    // rules parchment
    const parch = new Graphics();
    parch.roundRect(RULES.x - 6, RULES.y - 4, RULES.w + 12, RULES.h + 10, 8).fill({ fill: vgrad(0xf3e8cf, 0xd9c7a2) } as never);
    parch.roundRect(RULES.x - 6, RULES.y - 4, RULES.w + 12, RULES.h + 10, 8).stroke({ width: 1, color: 0x8a6a3a, alpha: 0.7 });
    L.addChild(parch);
    // response seal
    if (d.type === 'response' || (d.keywords ?? []).includes('response')) {
      const seal = new Container();
      const sg = new Graphics().roundRect(-21, -21, 42, 42, 5).fill({ color: C.cinnabar }).stroke({ width: 2, color: 0x7a1408 });
      seal.addChild(sg);
      const st = new Text({ text: '应', style: { fontFamily: FONT_TITLE, fontSize: 30, fill: 0xfff0e0, fontWeight: 'bold' } });
      st.anchor.set(0.5);
      seal.addChild(st);
      seal.position.set(CARD_W - 34, 36);
      seal.rotation = 0.08;
      L.addChild(seal);
    }
    // legendary cloud frame accent
    if (d.rarity === 'legendary') {
      const lg = new Graphics();
      lg.roundRect(-3, -3, CARD_W + 6, CARD_H + 6, 21).stroke({ width: 3, color: 0xffc85a, alpha: 0.9 });
      for (const [x, y] of [[12, 12], [CARD_W - 12, 12], [12, CARD_H - 12], [CARD_W - 12, CARD_H - 12]] as const) lg.circle(x, y, 6).fill({ color: 0xffd27a }).stroke({ width: 1.5, color: 0x6a3a08 });
      L.addChild(lg);
    }
    this.refreshCache();
  }

  private artMaskShape(g: Graphics): Graphics {
    const { x, y, w, h } = ART;
    switch (this.def.type) {
      case 'unit': // arched top
        g.moveTo(x, y + h).lineTo(x, y + 60).quadraticCurveTo(x, y, x + 60, y).lineTo(x + w - 60, y).quadraticCurveTo(x + w, y, x + w, y + 60).lineTo(x + w, y + h).closePath();
        break;
      case 'response': // notched corners
        g.poly([x + 22, y, x + w - 22, y, x + w, y + 22, x + w, y + h - 22, x + w - 22, y + h, x + 22, y + h, x, y + h - 22, x, y + 22]);
        break;
      case 'equip': // round fan
        g.moveTo(x, y + h).lineTo(x, y + 40).arcTo(x + w / 2, y - 30, x + w, y + 40, w * 0.9).lineTo(x + w, y + h).closePath();
        break;
      case 'delay': // hourglass waist
        g.moveTo(x, y).lineTo(x + w, y).quadraticCurveTo(x + w - 26, y + h / 2, x + w, y + h).lineTo(x, y + h).quadraticCurveTo(x + 26, y + h / 2, x, y).closePath();
        break;
      default:
        g.roundRect(x, y, w, h, 10);
    }
    return g;
  }

  private artMask(): Graphics {
    return this.artMaskShape(new Graphics()).fill(0xffffff);
  }

  private refreshCache() {
    // static layer is cached as a texture once art is present (only redraws when art arrives)
    try { this.staticLayer.cacheAsTexture(false); this.staticLayer.cacheAsTexture({ resolution: 2 } as never); } catch { /* ignore */ }
  }

  /** update live values (cost affordability, var colors, stats) */
  update(live: CardLive) {
    const d = this.def;
    // cost disc
    const cost = live.cost ?? { g: d.cost.g === 'X' ? 0 : d.cost.g, c: d.cost.c ?? [], x: d.cost.g === 'X' };
    const baseG = d.cost.g === 'X' ? 0 : d.cost.g;
    const costKey = JSON.stringify([cost, live.payable, live.missing]);
    if (costKey !== this.lastCost) {
      this.lastCost = costKey;
      this.costLayer.removeChildren().forEach((c) => c.destroy());
      const disc = new Graphics();
      const col = live.payable === false ? 0x5a4a44 : 0x1c2a44;
      disc.circle(38, 38, 30).fill({ color: 0x0a0806 });
      disc.circle(38, 38, 27).fill({ fill: vgrad(lighten(col, 0.35), darken(col, 0.3)) } as never);
      disc.circle(38, 38, 27).stroke({ width: 3, color: live.payable ? 0xffe39a : C.gold });
      this.costLayer.addChild(disc);
      const numCol = cost.g < baseG ? 0x7dff9a : cost.g > baseG ? 0xff8a7a : live.payable === false ? 0xd0b0a8 : 0xffffff;
      const n = new Text({ text: cost.x ? 'X' : String(cost.g), style: { fontFamily: FONT_NUM, fontSize: 34, fontWeight: 'bold', fill: numCol, stroke: { color: 0x000000, width: 5 } } });
      n.anchor.set(0.5);
      n.position.set(38, 39);
      this.costLayer.addChild(n);
      if (cost.c.length) {
        const cv = document.createElement('canvas');
        const per = 26;
        cv.width = (per * cost.c.length + 6) * 2; cv.height = 32 * 2;
        const ctx = cv.getContext('2d')!;
        ctx.scale(2, 2);
        const missing = [...(live.missing ?? [])];
        cost.c.forEach((c, i) => {
          const mi = missing.indexOf(c);
          const empty = mi >= 0;
          if (empty) missing.splice(mi, 1);
          drawPip(ctx, c, 15 + i * per, 16, 11, empty);
        });
        const s = new Sprite(new Texture({ source: new CanvasSource({ resource: cv, resolution: 2 }) }));
        s.position.set(64, 22);
        this.costLayer.addChild(s);
      }
    }
    // rules text
    const vars: Record<string, VarInfo> = {};
    for (const [k, v] of Object.entries(d.vars ?? {})) vars[k] = live.vars?.[k] ?? { value: v, base: v };
    const rulesKey = JSON.stringify([d.text, vars]);
    if (rulesKey !== this.lastRules) {
      this.lastRules = rulesKey;
      const old = this.rulesSprite.texture;
      const { texture } = richTexture(d.text, { width: RULES.w, height: RULES.h, fontSize: 19, minFontSize: 12, color: 0x2a1c12, vars, align: 'center' });
      this.rulesSprite.texture = texture;
      this.rulesSprite.position.set(RULES.x, RULES.y);
      if (old && old !== Texture.EMPTY) old.destroy(true);
    }
    // stats
    const statKey = JSON.stringify([live.atk, live.hp]);
    if (statKey !== this.lastStats) {
      this.lastStats = statKey;
      this.statsLayer.removeChildren().forEach((c) => c.destroy());
      if (d.type === 'unit' && d.unit) {
        this.statsLayer.addChild(statBadge('atk', live.atk ?? d.unit.atk, d.unit.atk, 30, CARD_H - 26));
        this.statsLayer.addChild(statBadge('hp', live.hp ?? d.unit.hp, d.unit.hp, CARD_W - 30, CARD_H - 26));
      } else if (d.type === 'equip' && d.equip) {
        if (d.equip.atk !== undefined) this.statsLayer.addChild(statBadge('atk', d.equip.atk, d.equip.atk, 30, CARD_H - 26));
        if (d.equip.durability) this.statsLayer.addChild(statBadge('dur', d.equip.durability, d.equip.durability, CARD_W - 30, CARD_H - 26));
      } else if (d.type === 'delay' && d.delay) {
        this.statsLayer.addChild(statBadge('turns', d.delay.turns, d.delay.turns, CARD_W - 30, CARD_H - 26));
      } else if (d.type === 'field' && d.field?.duration) {
        this.statsLayer.addChild(statBadge('turns', d.field.duration, d.field.duration, CARD_W - 30, CARD_H - 26));
      }
    }
  }

  setGlow(state: CardView['glowState']) {
    if (state === this.glowState) return;
    this.glowState = state;
    this.glow.clear();
    if (state === 'none') return;
    const col = state === 'playable' ? 0xffd46a : state === 'response' ? 0xff5a3a : state === 'danger' ? 0xff3030 : 0x9ae8ff;
    for (let i = 0; i < 4; i++) this.glow.roundRect(-3 - i * 3, -3 - i * 3, CARD_W + 6 + i * 6, CARD_H + 6 + i * 6, 20 + i * 3).stroke({ width: 3, color: col, alpha: 0.5 - i * 0.11 });
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

function statBadge(kind: 'atk' | 'hp' | 'dur' | 'turns', value: number, base: number, x: number, y: number): Container {
  const c = new Container();
  const g = new Graphics();
  if (kind === 'atk') {
    g.poly([0, -26, 20, -8, 14, 22, -14, 22, -20, -8]).fill({ fill: vgrad(0xf2c46b, 0x8a5a14) } as never).stroke({ width: 2.5, color: 0x2a1606 });
  } else if (kind === 'hp') {
    g.moveTo(0, -24).bezierCurveTo(22, -14, 24, 10, 0, 24).bezierCurveTo(-24, 10, -22, -14, 0, -24).fill({ fill: vgrad(0xff7a6a, 0x8a1a12) } as never).stroke({ width: 2.5, color: 0x2a0806 });
  } else if (kind === 'dur') {
    g.poly([0, -24, 21, -12, 21, 12, 0, 24, -21, 12, -21, -12]).fill({ fill: vgrad(0xb8c8d8, 0x3a4858) } as never).stroke({ width: 2.5, color: 0x101820 });
  } else {
    g.poly([-16, -22, 16, -22, 4, 0, 16, 22, -16, 22, -4, 0]).fill({ fill: vgrad(0xf0d890, 0x8a6a2a) } as never).stroke({ width: 2.5, color: 0x2a1c06 });
  }
  c.addChild(g);
  const col = value > base ? 0x8aff9a : value < base ? 0xff7a6a : 0xffffff;
  const t = new Text({ text: String(value), style: { fontFamily: FONT_NUM, fontSize: 26, fontWeight: 'bold', fill: col, stroke: { color: 0x000000, width: 5 } } });
  t.anchor.set(0.5);
  t.y = 1;
  c.addChild(t);
  c.position.set(x, y);
  return c;
}

// ───────────── procedural fallbacks ─────────────
const artCache = new Map<string, Texture>();
export function fallbackArt(f: Color, name: string): Texture {
  const key = `${f}:${name[0]}`;
  const hit = artCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 272; cv.height = 206;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 206);
  g.addColorStop(0, hex(factionLight(f)));
  g.addColorStop(0.5, hex(factionColor(f)));
  g.addColorStop(1, hex(factionDark(f)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 272, 206);
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 272, Math.random() * 206, 10 + Math.random() * 60, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? '#000' : '#fff';
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#1a0e08';
  ctx.font = 'bold 150px "STKaiti","KaiTi",serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name[0] ?? '命', 136, 110);
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
  const g = ctx.createLinearGradient(0, 0, 0, 420);
  g.addColorStop(0, '#1c2a4a'); g.addColorStop(1, '#0a1020');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(0, 0, 300, 420, 18); ctx.fill();
  ctx.strokeStyle = '#d9b25f'; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(150, 210, 80, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(150, 210, 50, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#d9b25f'; ctx.font = 'bold 60px "STKaiti","KaiTi",serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('命', 150, 212);
  backTex = new Texture({ source: new CanvasSource({ resource: cv }) });
  return backTex;
}

export { hgrad };
