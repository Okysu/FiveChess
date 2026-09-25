/** Procedural drawing helpers (panels, gems, ribbons, bars) shared by all UI. */
import { CanvasSource, Container, FillGradient, Graphics, Sprite, Texture } from 'pixi.js';
import { C } from './theme';
import { assets, K } from '../assets';
import { drawEmblem } from './canvasIcons';

export function vgrad(top: number, bottom: number, mid?: number): FillGradient {
  const stops = mid !== undefined
    ? [{ offset: 0, color: top }, { offset: 0.5, color: mid }, { offset: 1, color: bottom }]
    : [{ offset: 0, color: top }, { offset: 1, color: bottom }];
  return new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: stops, textureSpace: 'local' });
}

export function hgrad(left: number, right: number, mid?: number): FillGradient {
  const stops = mid !== undefined
    ? [{ offset: 0, color: left }, { offset: 0.5, color: mid }, { offset: 1, color: right }]
    : [{ offset: 0, color: left }, { offset: 1, color: right }];
  return new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, colorStops: stops, textureSpace: 'local' });
}

export function rgrad(inner: number, outer: number): FillGradient {
  return new FillGradient({ type: 'radial', center: { x: 0.5, y: 0.5 }, innerRadius: 0, outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.5, colorStops: [{ offset: 0, color: inner }, { offset: 1, color: outer }], textureSpace: 'local' } as never);
}

/** dark lacquer panel with double gold border */
export function drawPanel(g: Graphics, w: number, h: number, o: { r?: number; fill?: number; fill2?: number; border?: number; alpha?: number; inner?: boolean } = {}) {
  const r = o.r ?? 14;
  g.roundRect(0, 0, w, h, r).fill({ fill: vgrad(o.fill ?? 0x2a1f19, o.fill2 ?? 0x140e0b), alpha: o.alpha ?? 0.94 } as never);
  g.roundRect(0, 0, w, h, r).stroke({ width: 2.5, color: o.border ?? C.gold, alpha: 0.9 });
  if (o.inner !== false) g.roundRect(6, 6, w - 12, h - 12, Math.max(2, r - 5)).stroke({ width: 1, color: o.border ?? C.gold, alpha: 0.35 });
  return g;
}

export function panel(w: number, h: number, o: Parameters<typeof drawPanel>[3] = {}): Graphics {
  return drawPanel(new Graphics(), w, h, o);
}

/** faceted round gem */
export function drawGem(g: Graphics, x: number, y: number, r: number, color: number, light: number, dark: number) {
  g.circle(x, y, r + 2).fill({ color: 0x1a120c });
  g.circle(x, y, r).fill(rgrad(light, dark) as never);
  g.circle(x, y, r * 0.55).fill({ color, alpha: 0.55 });
  g.ellipse(x - r * 0.3, y - r * 0.38, r * 0.35, r * 0.2).fill({ color: 0xffffff, alpha: 0.55 });
  g.circle(x, y, r).stroke({ width: Math.max(1.5, r * 0.12), color: C.gold, alpha: 0.95 });
}

/** horizontal progress bar with ghost segment */
export function drawBar(g: Graphics, w: number, h: number, frac: number, color: number, o: { ghost?: number; back?: number; ghostColor?: number } = {}) {
  g.clear();
  g.roundRect(0, 0, w, h, h / 2).fill({ color: o.back ?? 0x120b08, alpha: 0.9 });
  const fw = Math.max(0, Math.min(1, frac)) * (w - 4);
  if (o.ghost && o.ghost > 0) {
    const gw = Math.min(fw, o.ghost * (w - 4));
    g.roundRect(2 + fw - gw, 2, gw, h - 4, (h - 4) / 2).fill({ color: o.ghostColor ?? 0xffe0a0, alpha: 0.75 });
    if (fw - gw > 0) g.roundRect(2, 2, fw - gw, h - 4, (h - 4) / 2).fill({ fill: vgrad(lighten(color, 0.35), color) } as never);
  } else if (fw > 0) g.roundRect(2, 2, fw, h - 4, (h - 4) / 2).fill({ fill: vgrad(lighten(color, 0.35), color) } as never);
  g.roundRect(0, 0, w, h, h / 2).stroke({ width: 1.5, color: C.goldDark, alpha: 0.9 });
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
