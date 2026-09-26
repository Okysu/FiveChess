/**
 * Woodblock skin — the ONLY way UI visuals are rendered. Every visible element is a generated
 * woodblock texture (scripts/art/jobs.ts → assets/ui/*). No procedural shapes, no gradients,
 * no placeholder drawings: until a texture has loaded the element is simply empty.
 * The only Graphics allowed in the game layer are invisible masks and hit areas created here
 * (enforced by scripts/check-no-procedural.ts).
 */
import { Container, Graphics, NineSliceSprite, Sprite, Text, Texture, type ContainerChild } from 'pixi.js';
import type { Color, Suit } from '../../engine/defs';
import { assets, K } from '../assets';

/** palette for text / tints only (never for drawing shapes) */
export const WB = {
  ink: 0x1b1512,
  paper: 0xeadbb6,
  vermilion: 0xc8321f,
  vermilionDk: 0x8a1f12,
  malachite: 0x2f8a5f,
  azurite: 0x2a4f8a,
  ochre: 0xd9a23a,
  plum: 0x6e3a78,
  white: 0xfaf3e0,
  grey: 0x9a8e7a,
};

/** every UI texture id the game uses (preloaded at boot) */
export const UI_TEXTURES = [
  'panel_light', 'panel_dark', 'panel_row', 'panel_tile', 'menu_panel', 'topbar', 'banner_band', 'rules_box',
  'button_red', 'button_green', 'button_blue', 'button_grey',
  ...['R', 'B', 'G', 'Y', 'P', 'N'].flatMap((f) => [`card_frame_${f}`, `ribbon_${f}`, `pip_${f}`]),
  'cost_disc', 'stat_atk', 'stat_hp', 'stat_dur', 'stat_turns', 'gem_common', 'gem_rare', 'gem_epic', 'gem_legendary',
  'suit_sun', 'suit_thunder', 'suit_moon', 'suit_mountain', 'bar_frame', 'bar_fill_red', 'bar_fill_blue', 'bar_fill_gold',
  'frame_gold', 'frame_red', 'frame_blue', 'ring_gold', 'ring_red', 'token_frame', 'tag_red', 'tag_gold',
  'skill_disc', 'skill_disc_active', 'equip_slot', 'slot', 'altar', 'seal_response', 'ward_bubble', 'frost_overlay', 'smoke_overlay',
  'arrow_chevron', 'arrow_head', 'path_dot', 'path_dot_red', 'stamp_visited', 'toggle_on', 'toggle_off', 'slider_track', 'slider_knob',
  'logo', 'card_back', 'fate_back', 'fate_face', 'art_placeholder', 'tex_paper', 'tex_ink', 'dim_vignette', 'cloud_corner', 'divider', 'shopkeeper',
] as const;
export type UiTex = (typeof UI_TEXTURES)[number];

export async function preloadUi(onProgress?: (k: number) => void) {
  await assets.loadMany(UI_TEXTURES.map((id) => K.ui(id)), onProgress);
}

// ───────────── invisible geometry (masks / hit areas only) ─────────────

export function maskRect(x: number, y: number, w: number, h: number, r = 0): Graphics {
  const g = new Graphics();
  if (r > 0) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  return g.fill(0xffffff);
}

export function maskCircle(x: number, y: number, r: number): Graphics {
  return new Graphics().circle(x, y, r).fill(0xffffff);
}

export function maskPoly(points: number[]): Graphics {
  return new Graphics().poly(points).fill(0xffffff);
}

/** an invisible hit area rectangle */
export function hitRect(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics().rect(x, y, w, h).fill({ color: 0x000000, alpha: 0.001 });
  g.eventMode = 'static';
  return g;
}

/** a pie-sector mask (0..1), used to reveal a ring texture as a countdown */
export function sectorMask(g: Graphics, r: number, k: number) {
  g.clear();
  if (k <= 0) return g;
  g.moveTo(0, 0).arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k)).lineTo(0, 0).fill(0xffffff);
  return g;
}

// ───────────── sprites ─────────────

/** a UI texture scaled to fit (w,h) keeping aspect; anchored at center; empty until loaded */
export function uiSprite(id: string, w: number, h: number, o: { tint?: number; alpha?: number; stretch?: boolean } = {}): Container {
  const holder = new Container();
  const key = K.ui(id);
  const put = (t: Texture) => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    if (o.stretch) { s.width = w; s.height = h; } else s.scale.set(Math.min(w / t.width, h / t.height));
    if (o.tint !== undefined) s.tint = o.tint;
    if (o.alpha !== undefined) s.alpha = o.alpha;
    holder.removeChildren().forEach((x) => x.destroy());
    holder.addChild(s);
  };
  const t = assets.get(key);
  if (t) put(t); else assets.with(key, put);
  return holder;
}

/** a UI texture stretched to exactly (w,h), top-left anchored */
export function uiFill(id: string, w: number, h: number, o: { tint?: number; alpha?: number } = {}): Container {
  const holder = new Container();
  const put = (t: Texture) => {
    const s = new Sprite(t);
    s.width = w; s.height = h;
    if (o.tint !== undefined) s.tint = o.tint;
    if (o.alpha !== undefined) s.alpha = o.alpha;
    holder.removeChildren().forEach((x) => x.destroy());
    holder.addChild(s);
  };
  const t = assets.get(K.ui(id));
  if (t) put(t); else assets.with(K.ui(id), put);
  return holder;
}

/** a texture cover-fitted into a (masked) box, e.g. paper fills */
export function uiCover(id: string, w: number, h: number, r = 0): Container {
  const c = new Container();
  const m = maskRect(0, 0, w, h, r);
  const put = (t: Texture) => {
    const s = new Sprite(t);
    s.scale.set(Math.max(w / t.width, h / t.height));
    c.removeChildren().forEach((x) => x.destroy());
    c.addChild(m, s);
    s.mask = m;
  };
  const t = assets.get(K.ui(id));
  if (t) put(t); else assets.with(K.ui(id), put);
  return c;
}

// ───────────── 9-slice ─────────────

interface SliceSpec { l: number; r: number; t: number; b: number; corner: number }
const SLICES: Record<string, SliceSpec> = {
  panel_light: { l: 0.2, r: 0.2, t: 0.26, b: 0.26, corner: 64 },
  panel_dark: { l: 0.2, r: 0.2, t: 0.26, b: 0.26, corner: 64 },
  panel_row: { l: 0.12, r: 0.12, t: 0.3, b: 0.3, corner: 36 },
  panel_tile: { l: 0.22, r: 0.22, t: 0.22, b: 0.22, corner: 30 },
  menu_panel: { l: 0.18, r: 0.18, t: 0.14, b: 0.14, corner: 60 },
  topbar: { l: 0.15, r: 0.15, t: 0.3, b: 0.4, corner: 70 },
  banner_band: { l: 0.14, r: 0.14, t: 0.3, b: 0.3, corner: 80 },
  rules_box: { l: 0.12, r: 0.12, t: 0.2, b: 0.2, corner: 22 },
  button_red: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_green: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_blue: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_grey: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  ribbon: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 50 },
  card_frame: { l: 0.17, r: 0.17, t: 0.12, b: 0.12, corner: 44 },
  bar_frame: { l: 0.12, r: 0.12, t: 0.3, b: 0.3, corner: 20 },
  bar_fill: { l: 0.08, r: 0.08, t: 0.2, b: 0.2, corner: 8 },
  frame: { l: 0.2, r: 0.2, t: 0.14, b: 0.14, corner: 30 },
  tag: { l: 0.22, r: 0.22, t: 0.3, b: 0.3, corner: 14 },
  equip_slot: { l: 0.25, r: 0.25, t: 0.25, b: 0.25, corner: 14 },
  slider_track: { l: 0.1, r: 0.1, t: 0.3, b: 0.3, corner: 14 },
  token_frame: { l: 0.2, r: 0.2, t: 0.2, b: 0.12, corner: 24 },
};

function specFor(id: string): SliceSpec {
  if (id.startsWith('ribbon_')) return SLICES.ribbon!;
  if (id.startsWith('card_frame_')) return SLICES.card_frame!;
  if (id.startsWith('bar_fill_')) return SLICES.bar_fill!;
  if (id.startsWith('frame_')) return SLICES.frame!;
  if (id.startsWith('tag_')) return SLICES.tag!;
  return SLICES[id] ?? { l: 0.2, r: 0.2, t: 0.2, b: 0.2, corner: 24 };
}

/** 9-slice a generated texture into a (w,h) box (top-left anchored); empty until loaded */
export function nine(id: string, w: number, h: number, o: { tint?: number; alpha?: number; cornerScale?: number } = {}): Container {
  const holder = new Container();
  const spec = specFor(id);
  const put = (t: Texture) => {
    const L = t.width * spec.l, R = t.width * spec.r, T = t.height * spec.t, B = t.height * spec.b;
    let k = (spec.corner * (o.cornerScale ?? 1)) / L;
    k = Math.min(k, (w * 0.92) / (L + R), (h * 0.98) / (T + B));
    const ns = new NineSliceSprite({ texture: t, leftWidth: L, rightWidth: R, topHeight: T, bottomHeight: B });
    ns.width = Math.max(L + R, w / k);
    ns.height = Math.max(T + B, h / k);
    ns.scale.set(k);
    if (o.tint !== undefined) ns.tint = o.tint;
    if (o.alpha !== undefined) ns.alpha = o.alpha;
    holder.removeChildren().forEach((x) => x.destroy());
    holder.addChild(ns);
  };
  const t = assets.get(K.ui(id));
  if (t) put(t); else assets.with(K.ui(id), put);
  return holder;
}

export type PanelKind = 'dark' | 'light' | 'row' | 'tile' | 'menu';
/** safe content inset inside each panel kind: the carved border + corner ornaments */
export const INSET: Record<PanelKind, { x: number; y: number }> = {
  dark: { x: 60, y: 52 }, light: { x: 60, y: 52 }, row: { x: 64, y: 10 }, tile: { x: 22, y: 22 }, menu: { x: 90, y: 90 },
};
export function panel(w: number, h: number, kind: PanelKind = 'dark', o: { alpha?: number; tint?: number; cornerScale?: number } = {}): Container {
  const id = kind === 'dark' ? 'panel_dark' : kind === 'light' ? 'panel_light' : kind === 'row' ? 'panel_row' : kind === 'tile' ? 'panel_tile' : 'menu_panel';
  return nine(id, w, h, o);
}

// ───────────── composite widgets ─────────────

export type BarColor = 'red' | 'blue' | 'gold';

/** gauge: frame + stretched fill + optional ghost (preview) segment. Call .set(frac, ghost) to update. */
export class Bar extends Container {
  private fill: Container;
  private ghost: Container;
  private frame: Container;
  private fillMask = new Graphics();
  private ghostMask = new Graphics();
  constructor(readonly bw: number, readonly bh: number, color: BarColor = 'red') {
    super();
    const inset = Math.max(3, bh * 0.22);
    this.fill = nine(`bar_fill_${color}`, bw - inset * 2, bh - inset * 2);
    this.fill.position.set(inset, inset);
    this.ghost = nine('bar_fill_gold', bw - inset * 2, bh - inset * 2, { alpha: 0.75 });
    this.ghost.position.set(inset, inset);
    this.frame = nine('bar_frame', bw, bh);
    this.addChild(this.ghost, this.fill, this.fillMask, this.ghostMask, this.frame);
    this.fill.mask = this.fillMask;
    this.ghost.mask = this.ghostMask;
    this.set(1);
  }
  set(frac: number, ghostFrac = 0) {
    const f = Math.max(0, Math.min(1, frac));
    const g = Math.max(0, Math.min(f, ghostFrac));
    const w = this.bw;
    this.fillMask.clear().rect(0, 0, w * (f - g), this.bh).fill(0xffffff);
    this.ghostMask.clear().rect(w * (f - g), 0, w * g, this.bh).fill(0xffffff);
  }
}

export function gem(rarity: string, size: number): Container {
  const id = rarity === 'legendary' ? 'gem_legendary' : rarity === 'epic' ? 'gem_epic' : rarity === 'rare' ? 'gem_rare' : 'gem_common';
  return uiSprite(id, size, size);
}

/** a school resource token; `empty` shows a faded outline-like version for a missing color */
/** 色觉模式: sources and suits also carry their name glyph, so nothing depends on hue alone */
let glyphs = false;
export function setColorGlyphs(on: boolean) { glyphs = on; }
const PIP_GLYPH: Record<Color, string> = { R: '赤', B: '玄', G: '青', Y: '金', P: '紫', N: '素' };
const SUIT_GLYPH: Record<Suit, string> = { sun: '日', thunder: '雷', moon: '月', mountain: '山' };
function withGlyph(c: Container, ch: string, size: number): Container {
  if (!glyphs || size < 18) return c;
  const t = new Text({ text: ch, style: { fontFamily: '"Noto Serif SC","Songti SC",serif', fontWeight: '900', fontSize: Math.round(size * 0.5), fill: 0xffffff, stroke: { color: 0x000000, width: Math.max(2, size * 0.1) } } });
  t.anchor.set(0.5);
  c.addChild(t);
  return c;
}

export function pip(color: Color, size: number, empty = false): Container {
  const c = uiSprite(`pip_${color}`, size, size, empty ? { tint: 0x5a5048, alpha: 0.55 } : {});
  return withGlyph(c, PIP_GLYPH[color], size);
}

export function suitIcon(s: Suit, size: number): Container {
  return withGlyph(uiSprite(`suit_${s}`, size, size), SUIT_GLYPH[s], size);
}

export type FrameColor = 'gold' | 'red' | 'blue';
/** selection / highlight frame around a (w,h) box, drawn slightly outside it */
export function frame(color: FrameColor, w: number, h: number, pad = 10): Container {
  const c = nine(`frame_${color}`, w + pad * 2, h + pad * 2);
  c.position.set(-pad, -pad);
  return c;
}

export function ring(color: 'gold' | 'red', size: number): Container {
  return uiSprite(`ring_${color}`, size, size);
}

export function tag(color: 'red' | 'gold', w: number, h: number): Container {
  return nine(`tag_${color}`, w, h);
}

/** a full-screen dim made from the ink texture */
export function dim(w: number, h: number, alpha: number, x = 0, y = 0): Container {
  const c = uiFill('dim_vignette', w, h, { alpha });
  c.position.set(x, y);
  return c;
}

/** icon from the generated icon set (no fallback) */
export function icon(id: string, size: number, o: { tint?: number; alpha?: number } = {}): Container {
  const holder = new Container();
  const put = (t: Texture) => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.scale.set((size / Math.max(t.width, t.height)) * 1.06);
    if (o.tint !== undefined) s.tint = o.tint;
    if (o.alpha !== undefined) s.alpha = o.alpha;
    holder.removeChildren().forEach((x) => x.destroy());
    holder.addChild(s);
  };
  const t = assets.get(K.icon(id));
  if (t) put(t); else assets.with(K.icon(id), put);
  return holder;
}

/** raw image source of a loaded UI/icon texture, for drawing inline in rich-text canvases */
/** the image behind a texture plus its frame (textures may live inside a packed atlas) */
export function imageSource(key: string): { img: CanvasImageSource; x: number; y: number; w: number; h: number } | null {
  const t = assets.get(key);
  const r = (t?.source as { resource?: unknown } | undefined)?.resource;
  if (!t || !r) return null;
  return { img: r as CanvasImageSource, x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height };
}

export function addAll(parent: Container, ...kids: ContainerChild[]) { for (const k of kids) parent.addChild(k); return parent; }
