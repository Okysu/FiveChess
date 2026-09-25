/**
 * Woodblock-print skin (木版年画): flat mineral colors, bold carved black outlines, an offset
 * "misregistered" print layer, and generated woodblock textures drawn as 9-slice sprites.
 * Every UI surface goes through here — no gradients anywhere.
 */
import { Container, Graphics, NineSliceSprite, Sprite, Texture } from 'pixi.js';
import { assets, K } from '../assets';

export const WB = {
  ink: 0x1b1512,
  ink2: 0x2a211b,
  paper: 0xeadbb6,
  paperDk: 0xcdb88c,
  vermilion: 0xc8321f,
  vermilionDk: 0x8a1f12,
  malachite: 0x2f8a5f,
  azurite: 0x2a4f8a,
  ochre: 0xd9a23a,
  ochreDk: 0x9a6a1a,
  plum: 0x6e3a78,
  grey: 0x7a6e60,
  white: 0xfaf3e0,
};

/** flat shape + offset print shadow + black outline */
export function printShape(g: Graphics, draw: (g: Graphics, dx: number, dy: number) => void, fill: number, o: { shadow?: number; outline?: number; offset?: number; alpha?: number } = {}) {
  const off = o.offset ?? 4;
  draw(g, off, off);
  g.fill({ color: o.shadow ?? WB.ink, alpha: 0.85 * (o.alpha ?? 1) });
  draw(g, 0, 0);
  g.fill({ color: fill, alpha: o.alpha ?? 1 });
  draw(g, 0, 0);
  g.stroke({ width: o.outline ?? 3, color: WB.ink, alignment: 0.5 });
  return g;
}

export function printRect(g: Graphics, x: number, y: number, w: number, h: number, fill: number, o: Parameters<typeof printShape>[3] & { r?: number } = {}) {
  return printShape(g, (gg, dx, dy) => gg.roundRect(x + dx, y + dy, w, h, o.r ?? 6), fill, o);
}

// ───────────── 9-slice textures ─────────────

interface SliceSpec { l: number; r: number; t: number; b: number; corner: number }
/** slice margins as fractions of the texture size; corner = desired on-screen size of the left margin in design px */
const SLICES: Record<string, SliceSpec> = {
  panel_light: { l: 0.2, r: 0.2, t: 0.26, b: 0.26, corner: 64 },
  panel_dark: { l: 0.2, r: 0.2, t: 0.26, b: 0.26, corner: 64 },
  button_red: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_green: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_blue: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  button_grey: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 44 },
  ribbon: { l: 0.2, r: 0.2, t: 0.3, b: 0.3, corner: 50 },
  card_frame: { l: 0.17, r: 0.17, t: 0.12, b: 0.12, corner: 44 },
  bar_frame: { l: 0.12, r: 0.12, t: 0.3, b: 0.3, corner: 26 },
};

export function nine(key: string, w: number, h: number, spec: SliceSpec, tex: Texture): Container {
  const c = new Container();
  const L = tex.width * spec.l, R = tex.width * spec.r, T = tex.height * spec.t, B = tex.height * spec.b;
  let k = spec.corner / L;
  // corners must fit inside the target box
  k = Math.min(k, (w * 0.9) / (L + R), (h * 0.98) / (T + B));
  const ns = new NineSliceSprite({ texture: tex, leftWidth: L, rightWidth: R, topHeight: T, bottomHeight: B });
  ns.width = w / k;
  ns.height = h / k;
  ns.scale.set(k);
  c.addChild(ns);
  void key;
  return c;
}

/** a 9-slice surface from a generated texture, with a flat printed fallback until it loads */
export function surface(kind: keyof typeof SLICES | `ribbon_${string}` | `card_frame_${string}`, w: number, h: number, fallback: { fill: number; r?: number }): Container {
  const holder = new Container();
  const fb = printRect(new Graphics(), 0, 0, w, h, fallback.fill, { r: fallback.r ?? 8, offset: 3 });
  holder.addChild(fb);
  const specKey = kind.startsWith('ribbon_') ? 'ribbon' : kind.startsWith('card_frame_') ? 'card_frame' : kind;
  const spec = SLICES[specKey]!;
  const key = K.ui(kind);
  if (assets.has(key)) {
    assets.with(key, (t) => {
      holder.removeChildren().forEach((x) => x.destroy());
      holder.addChild(nine(kind, w, h, spec, t));
    });
  }
  return holder;
}

export function panelSurface(w: number, h: number, dark = true): Container {
  return surface(dark ? 'panel_dark' : 'panel_light', w, h, { fill: dark ? WB.ink2 : WB.paper, r: 10 });
}

/** a plain sprite of a generated UI texture scaled to fit a box (fallback: printed disc/rect) */
export function uiSprite(id: string, w: number, h: number, fallbackFill = WB.ochre, round = false): Container {
  const holder = new Container();
  const g = new Graphics();
  if (round) printShape(g, (gg, dx, dy) => gg.circle(dx, dy, Math.min(w, h) / 2), fallbackFill, { offset: 2 });
  else printRect(g, -w / 2, -h / 2, w, h, fallbackFill, { offset: 2 });
  holder.addChild(g);
  const key = K.ui(id);
  if (assets.has(key)) assets.with(key, (t) => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.scale.set(Math.min(w / t.width, h / t.height));
    holder.removeChildren().forEach((x) => x.destroy());
    holder.addChild(s);
  });
  return holder;
}

/** paper texture fill clipped to a rounded rect, with black outline */
export function paperRect(w: number, h: number, r = 6, tint = 0xffffff): Container {
  const c = new Container();
  const base = new Graphics().roundRect(0, 0, w, h, r).fill({ color: WB.paper });
  c.addChild(base);
  const mask = new Graphics().roundRect(0, 0, w, h, r).fill(0xffffff);
  assets.with(K.ui('tex_paper'), (t) => {
    const s = new Sprite(t);
    s.scale.set(Math.max(w / t.width, h / t.height));
    s.tint = tint;
    c.addChild(mask);
    s.mask = mask;
    c.addChildAt(s, 1);
  });
  const line = new Graphics().roundRect(0, 0, w, h, r).stroke({ width: 2.5, color: WB.ink });
  c.addChild(line);
  return c;
}

/** full-surface ink texture (for bars / backgrounds) */
export function inkRect(w: number, h: number, alpha = 0.92): Container {
  const c = new Container();
  c.addChild(new Graphics().rect(0, 0, w, h).fill({ color: WB.ink, alpha }));
  assets.with(K.ui('tex_ink'), (t) => {
    const s = new Sprite(t);
    s.scale.set(Math.max(w / t.width, h / t.height));
    s.width = w; s.height = h;
    s.alpha = alpha;
    c.addChildAt(s, 1);
  });
  return c;
}

/** a thick flat highlight outline (woodblock-style selection instead of soft glows) */
export function printOutline(g: Graphics, x: number, y: number, w: number, h: number, color: number, r = 14) {
  g.roundRect(x - 6, y - 6, w + 12, h + 12, r + 4).stroke({ width: 7, color: WB.ink });
  g.roundRect(x - 6, y - 6, w + 12, h + 12, r + 4).stroke({ width: 4, color });
  return g;
}
