/**
 * Chinese-aware word wrap for every Pixi Text, plus a helper that shrinks a text until it fits its box.
 *
 * Pixi wraps at spaces, so "· 每回合……" moves the whole unspaced run to the next line (the bullet is left alone on
 * its line) and breaks it anywhere, even before "。" or "】". Here CJK characters are break points of their own,
 * Latin words and numbers stay whole, and the usual 禁则 apply: no line starts with closing punctuation and no
 * line ends with an opening bracket.
 */
import { CanvasTextMetrics, type Text, type TextStyle } from 'pixi.js';

const NO_START = new Set([...'，。、；：！？）】」』》〉”’…—·%,.;:!?)]}>～~']);
const NO_END = new Set([...'（【「『《〈“‘([{<']);
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿—…·“”‘’]/;

/** split a paragraph into unbreakable pieces: one CJK char each, Latin words / numbers whole, spaces separate */
function pieces(p: string): string[] {
  const out: string[] = [];
  let word = '';
  for (const ch of p) {
    if (ch === ' ') { if (word) out.push(word); word = ''; out.push(' '); continue; }
    if (CJK.test(ch)) { if (word) out.push(word); word = ''; out.push(ch); continue; }
    word += ch;
  }
  if (word) out.push(word);
  // glue 禁则 punctuation to its neighbour so it never starts / ends a line
  const glued: string[] = [];
  for (const t of out) {
    const prev = glued[glued.length - 1];
    if (prev !== undefined && prev !== ' ' && (NO_START.has(t[0]!) || NO_END.has(prev[prev.length - 1]!))) glued[glued.length - 1] = prev + t;
    else glued.push(t);
  }
  return glued;
}

function wrap(text: string, style: TextStyle, canvas: ICanvasLike): string {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = style._fontString;
  const ls = style.letterSpacing ?? 0;
  const max = style.wordWrapWidth;
  const cache = new Map<string, number>();
  const w = (t: string) => { let v = cache.get(t); if (v === undefined) { v = ctx.measureText(t).width + ls * [...t].length; cache.set(t, v); } return v; };
  const lines: string[] = [];
  for (const para of text.split(/\r\n|\r|\n/)) {
    let line = '';
    let width = 0;
    for (const t of pieces(para)) {
      const tw = w(t);
      if (t === ' ') { if (line) { line += t; width += tw; } continue; }
      if (width + tw > max && line.trim()) {
        lines.push(line.trimEnd());
        line = ''; width = 0;
      }
      if (tw > max) {
        // a piece wider than the box (a very long Latin word): break it by characters
        for (const ch of t) {
          const cw = w(ch);
          if (width + cw > max && line) { lines.push(line); line = ''; width = 0; }
          line += ch; width += cw;
        }
        continue;
      }
      line += t; width += tw;
    }
    lines.push(line.trimEnd());
  }
  return lines.join('\n');
}

type ICanvasLike = { getContext(id: '2d'): unknown };

let installed = false;
/** replace Pixi's word wrap (once, at startup) */
export function installCjkWrap() {
  if (installed) return;
  installed = true;
  (CanvasTextMetrics as unknown as { _wordWrap: (t: string, s: TextStyle, c?: ICanvasLike) => string })._wordWrap =
    (t, s, c = (CanvasTextMetrics as unknown as { _canvas: ICanvasLike })._canvas) => wrap(t, s, c);
}

/** shrink a single-line text until it is at most `maxW` wide */
export function fitWidth(t: Text, maxW: number, minSize = 12) {
  const st = t.style;
  let size = Number(st.fontSize);
  while (t.width > maxW && size > minSize) { size -= 1; st.fontSize = size; }
  return t;
}

/**
 * Shrink a wrapped text until it is at most `maxH` tall (line height shrinks with it). For fixed-size boxes whose
 * text is enlarged on phones (fs()) and would otherwise spill out.
 */
export function fitText(t: Text, maxH: number, minSize = 14) {
  const st = t.style;
  const size0 = Number(st.fontSize);
  const ratio = st.lineHeight ? st.lineHeight / size0 : 0;
  let size = size0;
  while (t.height > maxH && size > minSize) {
    size -= 1;
    st.fontSize = size;
    if (ratio) st.lineHeight = Math.round(size * ratio);
  }
  return t;
}
