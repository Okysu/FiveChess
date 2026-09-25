/** Procedural drawing helpers in the woodblock-print language: flat mineral colors, carved black outlines, offset print layer. */
import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { C } from './theme';
import { assets, K } from '../assets';
import { drawEmblem } from './canvasIcons';
import { WB, printShape } from './skin';

/** flat woodblock panel: ink (or paper) field, offset print shadow, black carved outline, ochre inner rule, cloud-nub corners */
export function drawPanel(g: Graphics, w: number, h: number, o: { r?: number; fill?: number; fill2?: number; border?: number; alpha?: number; inner?: boolean } = {}) {
  const r = o.r ?? 10;
  const a = o.alpha ?? 0.95;
  g.roundRect(5, 5, w, h, r).fill({ color: WB.ink, alpha: 0.6 * a });
  g.roundRect(0, 0, w, h, r).fill({ color: o.fill ?? WB.ink2, alpha: a });
  g.roundRect(0, 0, w, h, r).stroke({ width: 3.5, color: WB.ink });
  if (o.inner !== false) {
    g.roundRect(7, 7, w - 14, h - 14, Math.max(2, r - 4)).stroke({ width: 2, color: o.border ?? WB.ochre, alpha: 0.95 });
    for (const [x, y] of [[7, 7], [w - 7, 7], [7, h - 7], [w - 7, h - 7]] as const) {
      g.circle(x, y, 6).fill({ color: WB.vermilion }).stroke({ width: 2, color: WB.ink });
    }
  }
  return g;
}

export function panel(w: number, h: number, o: Parameters<typeof drawPanel>[3] = {}): Graphics {
  return drawPanel(new Graphics(), w, h, o);
}

/** flat printed gem: colored disc, black outline, paper highlight fleck */
export function drawGem(g: Graphics, x: number, y: number, r: number, color: number, _light?: number, _dark?: number) {
  printShape(g, (gg, dx, dy) => gg.circle(x + dx, y + dy, r), color, { offset: Math.max(1.5, r * 0.18), outline: Math.max(2, r * 0.22) });
  g.circle(x - r * 0.3, y - r * 0.3, r * 0.22).fill({ color: WB.white, alpha: 0.9 });
}

/** flat gauge bar: ink channel, flat fill, optional ghost (preview) segment, carved outline */
export function drawBar(g: Graphics, w: number, h: number, frac: number, color: number, o: { ghost?: number; back?: number; ghostColor?: number } = {}) {
  g.clear();
  g.roundRect(3, 3, w, h, 3).fill({ color: WB.ink, alpha: 0.7 });
  g.roundRect(0, 0, w, h, 3).fill({ color: o.back ?? 0x2a1f19 });
  const fw = Math.max(0, Math.min(1, frac)) * (w - 4);
  const ghost = o.ghost && o.ghost > 0 ? Math.min(fw, o.ghost * (w - 4)) : 0;
  if (fw - ghost > 0) {
    g.rect(2, 2, fw - ghost, h - 4).fill({ color });
    g.rect(2, 2, fw - ghost, Math.max(1, (h - 4) * 0.3)).fill({ color: lighten(color, 0.3) });
  }
  if (ghost > 0) g.rect(2 + fw - ghost, 2, ghost, h - 4).fill({ color: o.ghostColor ?? WB.paper, alpha: 0.85 });
  g.roundRect(0, 0, w, h, 3).stroke({ width: 2.5, color: WB.ink });
}

export function lighten(c: number, k: number): number {
  const r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
  const f = (x: number) => Math.min(255, Math.round(x + (255 - x) * k));
  return (f(r) << 16) | (f(gg) << 8) | f(b);
}

export function darken(c: number, k: number): number {
  const r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
  const f = (x: number) => Math.max(0, Math.round(x * (1 - k)));
  return (f(r) << 16) | (f(gg) << 8) | f(b);
}

/** an icon sprite from generated art, with a procedural glyph fallback */
export function iconSprite(id: string, size: number, fallbackGlyph = '?', tint = C.gold): Container {
  const holder = new Container();
  const key = K.icon(id);
  const fb = new Sprite(fallbackIcon(fallbackGlyph, tint));
  fb.anchor.set(0.5);
  fb.width = fb.height = size;
  holder.addChild(fb);
  if (assets.has(key)) {
    assets.with(key, (t) => {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      const k = size / Math.max(t.width, t.height);
      s.scale.set(k * 1.08);
      holder.removeChildren();
      holder.addChild(s);
    });
  }
  return holder;
}

const fbCache = new Map<string, Texture>();
export function fallbackIcon(glyph: string, tint: number): Texture {
  const key = `${glyph}:${tint}`;
  const hit = fbCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  drawEmblem(cv.getContext('2d')!, glyph, 64, 64, 58, tint);
  const t = new Texture({ source: new CanvasSource({ resource: cv }) });
  fbCache.set(key, t);
  return t;
}

/** tiled material background clipped to a rounded rect */
export function materialRect(key: string, w: number, h: number, r: number, tint = 0xffffff, alpha = 1): Container {
  const c = new Container();
  const mask = new Graphics().roundRect(0, 0, w, h, r).fill(0xffffff);
  c.addChild(mask);
  const fallback = new Graphics().roundRect(0, 0, w, h, r).fill({ color: tint === 0xffffff ? 0x2a1f19 : tint, alpha });
  c.addChild(fallback);
  assets.with(K.ui(key), (t) => {
    const s = new Sprite(t);
    s.tint = tint;
    s.alpha = alpha;
    const k = Math.max(w / t.width, h / t.height);
    s.scale.set(k);
    s.mask = mask;
    c.addChild(s);
  });
  return c;
}
