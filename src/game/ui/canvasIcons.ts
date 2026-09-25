/**
 * Crisp procedural glyphs drawn on a 2D canvas: color pips (shape-coded per school), fate suits
 * (shape-coded), used inline in rich text and on card cost discs. Color + shape double coding.
 */
import type { Color, Suit } from '../../engine/defs';
import { COLOR_INFO, SUIT_INFO } from '../../engine/glossary';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export { hex };

/** draw a school pip centered at (x,y) with radius r */
export function drawPip(ctx: CanvasRenderingContext2D, color: Color, x: number, y: number, r: number, empty = false) {
  const info = COLOR_INFO[color];
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  switch (color) {
    case 'R': // flame lozenge
      ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.95, -r * 0.1, r * 0.55, r * 0.55); ctx.quadraticCurveTo(0, r * 1.05, -r * 0.55, r * 0.55); ctx.quadraticCurveTo(-r * 0.95, -r * 0.1, 0, -r);
      break;
    case 'B': // square seal
      ctx.rect(-r * 0.78, -r * 0.78, r * 1.56, r * 1.56);
      break;
    case 'G': // leaf
      ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 1.05, 0, 0, r); ctx.quadraticCurveTo(-r * 1.05, 0, 0, -r);
      break;
    case 'Y': { // star
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
      break;
    }
    case 'P': // crescent
      ctx.arc(0, 0, r, Math.PI * 0.25, Math.PI * 1.75, false);
      ctx.arc(r * 0.45, -r * 0.05, r * 0.72, Math.PI * 1.6, Math.PI * 0.4, true);
      ctx.closePath();
      break;
    case 'N':
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
      break;
  }
  if (empty) {
    ctx.setLineDash([r * 0.35, r * 0.25]);
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.strokeStyle = hex(info.hex);
    ctx.stroke();
  } else {
    // offset print layer, flat pigment, carved black outline
    ctx.save(); ctx.translate(r * 0.16, r * 0.16); ctx.fillStyle = '#1b1512'; ctx.fill(); ctx.restore();
    ctx.fillStyle = hex(info.hex);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.strokeStyle = '#1b1512';
    ctx.stroke();
    if (color === 'N') { ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = hex(info.dark); ctx.fill(); }
  }
  ctx.restore();
}

/** draw a fate suit glyph; yang suits get a solid ring, yin suits a hollow ring */
export function drawSuit(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, r: number, withRing = false) {
  const info = SUIT_INFO[suit];
  const col = hex(info.color);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineJoin = 'round';
  if (withRing) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.14;
    if (info.yang) { ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
  }
  ctx.beginPath();
  switch (suit) {
    case 'sun': {
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = r * 0.14;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      }
      ctx.stroke();
      break;
    }
    case 'thunder':
      ctx.moveTo(r * 0.25, -r * 0.95); ctx.lineTo(-r * 0.45, r * 0.1); ctx.lineTo(-r * 0.02, r * 0.1);
      ctx.lineTo(-r * 0.3, r * 0.95); ctx.lineTo(r * 0.5, -r * 0.15); ctx.lineTo(r * 0.05, -r * 0.15); ctx.closePath();
      ctx.fill();
      break;
    case 'moon':
      ctx.arc(0, 0, r * 0.85, Math.PI * 0.3, Math.PI * 1.7, false);
      ctx.arc(r * 0.35, -r * 0.1, r * 0.66, Math.PI * 1.55, Math.PI * 0.45, true);
      ctx.closePath();
      ctx.fill();
      break;
    case 'mountain':
      ctx.moveTo(-r * 0.95, r * 0.7); ctx.lineTo(-r * 0.45, -r * 0.2); ctx.lineTo(-r * 0.15, r * 0.2);
      ctx.lineTo(r * 0.2, -r * 0.8); ctx.lineTo(r * 0.95, r * 0.7); ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** a generic round emblem with a single glyph (fallback icon) */
export function drawEmblem(ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, r: number, tint: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath(); ctx.arc(r * 0.08, r * 0.08, r, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = '#1b1512'; ctx.fill();
  ctx.lineWidth = r * 0.14; ctx.strokeStyle = '#d9a23a'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 1.02, 0, Math.PI * 2); ctx.lineWidth = r * 0.05; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.fillStyle = hex(tint);
  ctx.font = `900 ${Math.round(r * 1.0)}px "Noto Serif SC","SimSun",serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 0, r * 0.06);
  ctx.restore();
}
