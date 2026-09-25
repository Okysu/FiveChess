/**
 * Canvas rich text for card rules: [术语] highlight, {var} live values (buffed = green, nerfed = red),
 * inline pip / suit icons, CJK line breaking with kinsoku, and auto-shrink to fit the text box.
 */
import { CanvasSource, Texture } from 'pixi.js';
import type { Color, Suit } from '../../engine/defs';
import { TERM_NAMES, KEYWORDS, STATUSES } from '../../engine/glossary';
import { imageSource } from './skin';
import { K } from '../assets';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** draw a generated icon texture inline (pips / suits); skipped if the texture isn't loaded yet */
function drawTex(c: CanvasRenderingContext2D, key: string, cx: number, cy: number, size: number) {
  const src = imageSource(key);
  if (!src) return;
  const { img, x, y, w: iw, h: ih } = src;
  const k = size / Math.max(iw, ih);
  c.drawImage(img, x, y, iw, ih, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
}
import { FONT_BODY } from './theme';

export interface VarInfo { value: number; base: number; better?: 'higher' | 'lower' }

export interface RichOpts {
  width: number;
  height: number;
  fontSize: number;
  minFontSize?: number;
  color?: number;
  termColor?: number;
  font?: string;
  align?: 'left' | 'center';
  vAlign?: 'top' | 'middle';
  lineHeight?: number; // multiplier
  vars?: Record<string, VarInfo>;
  resolution?: number;
  weight?: string;
  shadow?: boolean;
}

type Tok =
  | { k: 'ch'; s: string; term?: string; color?: string; bold?: boolean }
  | { k: 'pip'; c: Color }
  | { k: 'suit'; s: Suit }
  | { k: 'br' };

const PIPS = new Set(['R', 'B', 'G', 'Y', 'P', 'N']);
const SUITS = new Set(['sun', 'moon', 'thunder', 'mountain']);
const NO_START = new Set('，。、；：！？）」』》〉,.;:!?)]】…'.split(''));
const NO_END = new Set('（「『《〈([【'.split(''));

function termColor(name: string, fallback: string): string {
  const t = TERM_NAMES[name];
  if (!t) return fallback;
  if (t.kind === 'keyword' && t.id in KEYWORDS) return hex(KEYWORDS[t.id as keyof typeof KEYWORDS].tint);
  if (t.kind === 'status' && t.id in STATUSES) return hex(STATUSES[t.id as keyof typeof STATUSES].tint);
  return fallback;
}

export function tokenize(text: string, o: RichOpts): { toks: Tok[]; terms: string[] } {
  const toks: Tok[] = [];
  const terms: string[] = [];
  const base = hex(o.color ?? 0x2a1f18);
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\n') { toks.push({ k: 'br' }); i++; continue; }
    if (ch === '[') {
      const j = text.indexOf(']', i);
      if (j > i) {
        const name = text.slice(i + 1, j);
        if (!terms.includes(name)) terms.push(name);
        const col = o.termColor !== undefined ? hex(o.termColor) : termColor(name, '#7a3a10');
        for (const c of name) toks.push({ k: 'ch', s: c, term: name, color: col, bold: true });
        i = j + 1;
        continue;
      }
    }
    if (ch === '{') {
      const j = text.indexOf('}', i);
      if (j > i) {
        const key = text.slice(i + 1, j);
        if (PIPS.has(key)) { toks.push({ k: 'pip', c: key as Color }); i = j + 1; continue; }
        if (SUITS.has(key)) { toks.push({ k: 'suit', s: key as Suit }); i = j + 1; continue; }
        if (key === 'X' || key === 'x') { toks.push({ k: 'ch', s: 'X', bold: true, color: base }); i = j + 1; continue; }
        const v = o.vars?.[key];
        if (v) {
          let col = base;
          const better = v.better ?? 'higher';
          if (v.value !== v.base) col = (v.value > v.base) === (better === 'higher') ? '#1f8a3a' : '#c0281c';
          for (const c of String(v.value)) toks.push({ k: 'ch', s: c, bold: true, color: col });
          i = j + 1;
          continue;
        }
      }
    }
    toks.push({ k: 'ch', s: ch, color: base });
    i++;
  }
  return { toks, terms };
}

interface Placed { tok: Tok; x: number; w: number }

function layoutLines(ctx: CanvasRenderingContext2D, toks: Tok[], width: number, fs: number, font: string, weight: string): Placed[][] {
  const lines: Placed[][] = [[]];
  let x = 0;
  const iconW = fs * 1.05;
  const measure = (t: Tok): number => {
    if (t.k === 'pip' || t.k === 'suit') return iconW;
    if (t.k === 'br') return 0;
    ctx.font = `${t.bold ? 'bold' : weight} ${fs}px ${font}`;
    return ctx.measureText(t.s).width;
  };
  // group latin/digit runs into unbreakable words
  const words: Tok[][] = [];
  for (const t of toks) {
    const last = words[words.length - 1];
    const isWordChar = t.k === 'ch' && /[A-Za-z0-9+\-%]/.test(t.s);
    const lastIsWord = last && last[0]!.k === 'ch' && /[A-Za-z0-9+\-%]/.test((last[last.length - 1] as { s: string }).s);
    if (isWordChar && lastIsWord) last!.push(t);
    else words.push([t]);
  }
  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi]!;
    if (word[0]!.k === 'br') { lines.push([]); x = 0; continue; }
    const ww = word.reduce((a, t) => a + measure(t), 0);
    const first = word[0]!;
    const cur = lines[lines.length - 1]!;
    const isNoStart = first.k === 'ch' && NO_START.has(first.s);
    if (x + ww > width && cur.length && !isNoStart) {
      // don't leave an opening bracket at the end of a line
      const tail = cur[cur.length - 1];
      const carry: Placed[] = [];
      if (tail && tail.tok.k === 'ch' && NO_END.has(tail.tok.s)) carry.push(cur.pop()!);
      lines.push([]);
      x = 0;
      for (const c of carry) { lines[lines.length - 1]!.push({ tok: c.tok, x, w: c.w }); x += c.w; }
    }
    for (const t of word) {
      const w = measure(t);
      lines[lines.length - 1]!.push({ tok: t, x, w });
      x += w;
    }
  }
  return lines;
}

let measureCanvas: HTMLCanvasElement | null = null;
function mctx() {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d')!;
}

export interface RichResult { canvas: HTMLCanvasElement; fontSize: number; terms: string[]; lines: number; usedHeight: number }

export function renderRich(text: string, o: RichOpts): RichResult {
  const res = o.resolution ?? 2;
  const font = o.font ?? FONT_BODY;
  const weight = o.weight ?? 'normal';
  const lh = o.lineHeight ?? 1.32;
  const { toks, terms } = tokenize(text, o);
  let fs = o.fontSize;
  const minFs = o.minFontSize ?? Math.max(9, Math.round(o.fontSize * 0.6));
  const ctx = mctx();
  let lines = layoutLines(ctx, toks, o.width, fs, font, weight);
  while (fs > minFs && lines.length * fs * lh > o.height) {
    fs -= 1;
    lines = layoutLines(ctx, toks, o.width, fs, font, weight);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(o.width * res);
  canvas.height = Math.ceil(o.height * res);
  const c = canvas.getContext('2d')!;
  c.scale(res, res);
  c.textBaseline = 'middle';
  const totalH = lines.length * fs * lh;
  let y0 = (o.vAlign ?? 'middle') === 'middle' ? Math.max(0, (o.height - totalH) / 2) : 0;
  for (const line of lines) {
    const lw = line.length ? line[line.length - 1]!.x + line[line.length - 1]!.w : 0;
    const ox = (o.align ?? 'center') === 'center' ? (o.width - lw) / 2 : 0;
    const cy = y0 + (fs * lh) / 2;
    for (const p of line) {
      const t = p.tok;
      if (t.k === 'pip') drawTex(c, K.ui(`pip_${t.c}`), ox + p.x + p.w / 2, cy, fs * 1.0);
      else if (t.k === 'suit') drawTex(c, K.ui(`suit_${t.s}`), ox + p.x + p.w / 2, cy, fs * 1.05);
      else if (t.k === 'ch') {
        c.font = `${t.bold ? 'bold' : weight} ${fs}px ${font}`;
        if (o.shadow) { c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 3; }
        c.fillStyle = t.color ?? '#000';
        c.fillText(t.s, ox + p.x, cy + fs * 0.04);
        c.shadowBlur = 0;
      }
    }
    y0 += fs * lh;
  }
  return { canvas, fontSize: fs, terms, lines: lines.length, usedHeight: totalH };
}

export function richTexture(text: string, o: RichOpts): { texture: Texture; result: RichResult } {
  const result = renderRich(text, o);
  const texture = new Texture({ source: new CanvasSource({ resource: result.canvas, resolution: o.resolution ?? 2 }) });
  return { texture, result };
}

/** list of glossary terms referenced in a text (for tooltips) */
export function termsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}
