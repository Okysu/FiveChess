/** Reusable widgets: buttons, labels, tooltips, toasts, modal frames. */
import { Container, Graphics, Text, type TextStyleOptions, Sprite } from 'pixi.js';
import { C, FONT_BODY, FONT_TITLE, FONT_UI } from './theme';
import { drawPanel, vgrad, lighten, darken } from './draw';
import { tweens, ease } from '../core/tween';
import { G } from '../core/app';
import { richTexture } from './richtext';
import { KEYWORDS, STATUSES, TERM_NAMES, EXTRA_TERMS } from '../../engine/glossary';
import { sfx } from '../audio/audio';

export function label(text: string, style: TextStyleOptions = {}): Text {
  return new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 22, fill: C.text, ...style } });
}

export function title(text: string, size = 48, style: TextStyleOptions = {}): Text {
  return new Text({ text, style: { fontFamily: FONT_TITLE, fontSize: size, fill: C.goldLight, stroke: { color: 0x1a0c06, width: 6 }, letterSpacing: 6, dropShadow: { color: 0x000000, blur: 8, distance: 2, alpha: 0.7, angle: Math.PI / 2 }, ...style } });
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  kind?: 'primary' | 'normal' | 'danger' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
  hotkey?: string;
  sub?: string;
}

export class Button extends Container {
  private bg = new Graphics();
  private txt: Text;
  private subTxt?: Text;
  private hover = false;
  disabled: boolean;
  onClick?: () => void;
  readonly bw: number;
  readonly bh: number;
  kind: NonNullable<ButtonOpts['kind']>;
  pulse = false;
  private pulseT = 0;

  constructor(text: string, o: ButtonOpts = {}) {
    super();
    this.bw = o.width ?? 240;
    this.bh = o.height ?? 72;
    this.kind = o.kind ?? 'normal';
    this.disabled = !!o.disabled;
    this.onClick = o.onClick;
    this.txt = new Text({ text, style: { fontFamily: FONT_TITLE, fontSize: o.fontSize ?? 30, fill: C.goldLight, stroke: { color: 0x120804, width: 4 }, letterSpacing: 3 } });
    this.txt.anchor.set(0.5);
    this.txt.position.set(this.bw / 2, this.bh / 2 + (o.sub ? -8 : 0));
    this.addChild(this.bg, this.txt);
    if (o.sub) {
      this.subTxt = new Text({ text: o.sub, style: { fontFamily: FONT_UI, fontSize: 15, fill: C.textDim } });
      this.subTxt.anchor.set(0.5);
      this.subTxt.position.set(this.bw / 2, this.bh / 2 + 18);
      this.addChild(this.subTxt);
    }
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerover', () => { this.hover = true; this.draw(); if (!this.disabled) sfx('hover'); });
    this.on('pointerout', () => { this.hover = false; this.draw(); this.scale.set(1); });
    this.on('pointerdown', () => { if (!this.disabled) { this.scale.set(0.97); } });
    this.on('pointerup', () => { this.scale.set(1); });
    this.on('pointertap', (e) => { if (e.button === 2) return; if (this.disabled) { sfx('deny'); return; } sfx('click'); this.onClick?.(); });
    this.pivot.set(0, 0);
    this.draw();
  }

  setText(t: string, sub?: string) {
    this.txt.text = t;
    if (this.subTxt && sub !== undefined) this.subTxt.text = sub;
  }

  setDisabled(d: boolean) { this.disabled = d; this.draw(); }
  setKind(k: Button['kind']) { this.kind = k; this.draw(); }

  tick(dt: number) {
    if (!this.pulse) return;
    this.pulseT += dt;
    this.draw();
  }

  draw() {
    const g = this.bg;
    const w = this.bw, h = this.bh;
    g.clear();
    let top = 0x3a2a20, bot = 0x160e0a, border = C.gold;
    if (this.kind === 'primary') { top = 0x8a2a1a; bot = 0x3a0e08; border = C.goldLight; }
    if (this.kind === 'danger') { top = 0x5a1a1a; bot = 0x200606; }
    if (this.kind === 'ghost') { top = 0x241c18; bot = 0x100a08; border = C.goldDark; }
    if (this.disabled) { top = 0x2a2624; bot = 0x141210; border = 0x5a5048; }
    if (this.hover && !this.disabled) { top = lighten(top, 0.15); bot = lighten(bot, 0.1); }
    if (this.pulse && !this.disabled) {
      const a = 0.35 + 0.35 * Math.sin(this.pulseT / 260);
      for (let i = 0; i < 3; i++) g.roundRect(-4 - i * 4, -4 - i * 4, w + 8 + i * 8, h + 8 + i * 8, 16 + i * 4).stroke({ width: 3, color: 0xffcf5a, alpha: a * (1 - i * 0.3) });
    }
    g.roundRect(0, 0, w, h, 12).fill({ fill: vgrad(top, bot) } as never);
    g.roundRect(0, 0, w, h, 12).stroke({ width: 2.5, color: border });
    g.roundRect(5, 5, w - 10, h - 10, 8).stroke({ width: 1, color: border, alpha: 0.35 });
    // cloud-tip ornaments
    for (const x of [14, w - 14]) g.circle(x, h / 2, 4).fill({ color: border, alpha: 0.8 });
    this.txt.style.fill = this.disabled ? 0x8a7e70 : C.goldLight;
    this.alpha = 1;
  }
}

// ───────────── tooltip ─────────────

export class Tooltip extends Container {
  constructor(lines: { title?: string; body: string; color?: number }[], width = 380) {
    super();
    const pad = 16;
    let y = pad;
    const parts: Container[] = [];
    for (const l of lines) {
      if (l.title) {
        const t = new Text({ text: l.title, style: { fontFamily: FONT_TITLE, fontSize: 24, fill: l.color ?? C.goldLight } });
        t.position.set(pad, y);
        parts.push(t);
        y += t.height + 4;
      }
      const { texture, result } = richTexture(l.body, { width: width - pad * 2, height: 400, fontSize: 18, minFontSize: 18, color: 0xeadfc8, align: 'left', vAlign: 'top', termColor: 0xffd27a });
      const s = new Sprite(texture);
      s.position.set(pad, y);
      s.height = texture.height;
      parts.push(s);
      y += result.usedHeight + 10;
    }
    const bg = new Graphics();
    drawPanel(bg, width, y + pad - 8, { r: 10, alpha: 0.96 });
    this.addChild(bg, ...parts);
    for (const p of parts) if (p instanceof Sprite) { p.height = Math.min(p.height, 400); }
  }
}

let current: Container | null = null;

/** show a tooltip near a design-space point; auto-flips to stay on screen */
export function showTip(tip: Container, x: number, y: number, prefer: 'right' | 'left' | 'above' = 'right') {
  hideTip();
  current = tip;
  const b = tip.getLocalBounds();
  let tx = prefer === 'left' ? x - b.width - 12 : prefer === 'above' ? x - b.width / 2 : x + 12;
  let ty = prefer === 'above' ? y - b.height - 12 : y;
  tx = Math.max(8, Math.min(1920 - b.width - 8, tx));
  ty = Math.max(8, Math.min(1080 - b.height - 8, ty));
  tip.position.set(tx, ty);
  tip.alpha = 0;
  tip.eventMode = 'none';
  G.tipLayer.addChild(tip);
  void tweens.to(tip, { alpha: 1 }, 120, { unscaled: true });
}

export function hideTip() {
  if (current) { current.destroy({ children: true }); current = null; }
  G.tipLayer.removeChildren();
}

/** glossary tooltip lines for a set of bracket terms */
export function glossLines(terms: string[]): { title: string; body: string; color?: number }[] {
  const out: { title: string; body: string; color?: number }[] = [];
  for (const name of terms) {
    const t = TERM_NAMES[name];
    if (!t) continue;
    if (t.kind === 'keyword' && t.id in KEYWORDS) { const k = KEYWORDS[t.id as keyof typeof KEYWORDS]; out.push({ title: k.name, body: k.text, color: k.tint }); }
    else if (t.kind === 'status' && t.id in STATUSES) { const k = STATUSES[t.id as keyof typeof STATUSES]; out.push({ title: k.name, body: k.text, color: k.tint }); }
    else if (EXTRA_TERMS[name]) out.push({ title: name, body: EXTRA_TERMS[name]! });
  }
  return out;
}

// ───────────── toast ─────────────

export function toast(text: string, color = C.goldLight, y = 200) {
  const c = new Container();
  const t = new Text({ text, style: { fontFamily: FONT_TITLE, fontSize: 30, fill: color, stroke: { color: 0x000000, width: 5 } } });
  t.anchor.set(0.5);
  const bg = new Graphics().roundRect(-t.width / 2 - 30, -t.height / 2 - 10, t.width + 60, t.height + 20, 12).fill({ color: 0x000000, alpha: 0.55 });
  c.addChild(bg, t);
  c.position.set(960, y);
  c.alpha = 0;
  G.toastLayer.addChild(c);
  void (async () => {
    await tweens.to(c, { alpha: 1, y: y - 10 }, 180, { unscaled: true });
    await tweens.wait(1100);
    await tweens.to(c, { alpha: 0, y: y - 30 }, 300, { unscaled: true });
    c.destroy({ children: true });
  })();
}

// ───────────── modal ─────────────

export class Modal extends Container {
  readonly body = new Container();
  private dim = new Graphics();
  private popKeys: () => void;
  onClose?: () => void;

  constructor(w: number, h: number, o: { title?: string; closable?: boolean; dim?: number } = {}) {
    super();
    this.dim.rect(0, 0, 1920, 1080).fill({ color: 0x000000, alpha: o.dim ?? 0.7 });
    this.dim.eventMode = 'static';
    this.addChild(this.dim);
    const frame = new Container();
    frame.position.set((1920 - w) / 2, (1080 - h) / 2);
    const bg = new Graphics();
    drawPanel(bg, w, h, { r: 18 });
    frame.addChild(bg, this.body);
    if (o.title) {
      const t = title(o.title, 40);
      t.anchor.set(0.5, 0);
      t.position.set(w / 2, 22);
      frame.addChild(t);
    }
    if (o.closable !== false) {
      const x = new Button('✕', { width: 56, height: 56, fontSize: 28, kind: 'ghost', onClick: () => this.close() });
      x.position.set(w - 70, 14);
      frame.addChild(x);
      this.dim.on('pointertap', () => this.close());
    }
    this.addChild(frame);
    this.popKeys = G.pushKeys((e) => { if (e.key === 'Escape' && o.closable !== false) { this.close(); return true; } return false; });
    this.alpha = 0;
    G.modalLayer.addChild(this);
    void tweens.to(this as Container, { alpha: 1 }, 160, { unscaled: true, ease: ease.outQuad });
  }

  close() {
    this.popKeys();
    hideTip();
    this.onClose?.();
    this.destroy({ children: true });
  }
}

export { darken };
