/** Color math + icon alias. All visuals come from generated textures via ./skin (no procedural drawing). */
import type { Container } from 'pixi.js';
import { icon } from './skin';

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

/** generated icon (legacy signature: glyph/tint arguments are ignored — there is no procedural fallback) */
export function iconSprite(id: string, size: number, _glyph?: string, _tint?: number): Container {
  return icon(id, size);
}
