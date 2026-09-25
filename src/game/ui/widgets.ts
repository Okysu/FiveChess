/** Reusable widgets: buttons, labels, tooltips, toasts, modal frames. */
import { Container, Graphics, Text, type TextStyleOptions, Sprite } from 'pixi.js';
import { C, FONT_BODY, FONT_TITLE, FONT_UI } from './theme';
import { darken } from './draw';
import { WB, nine, frame as selFrame, panel, dim as dimLayer, hitRect, INSET } from './skin';
import { tweens, ease } from '../core/tween';
import { G } from '../core/app';
import { richTexture } from './richtext';
import { KEYWORDS, STATUSES, TERM_NAMES, EXTRA_TERMS } from '../../engine/glossary';
import { sfx } from '../audio/audio';

export function label(text: string, style: TextStyleOptions = {}): Text {
  return new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 22, fill: C.text, ...style } });
}

export function title(text: string, size = 48, style: TextStyleOptions = {}): Text {
  // carved heading: heavy Song type, paper-ochre fill, thick black outline, offset print shadow (no blur)
  return new Text({ text, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: size, fill: C.goldLight, stroke: { color: WB.ink, width: Math.max(5, size * 0.12) }, letterSpacing: 6, dropShadow: { color: WB.vermilionDk, blur: 0, distance: Math.max(3, size * 0.07), alpha: 1, angle: Math.PI / 4 }, ...style } });
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

const PLATE: Record<string, string> = { primary: 'button_red', danger: 'button_red', normal: 'button_blue', ghost: 'button_green', disabled: 'button_grey' };

/** woodblock button: printed plate texture (9-slice), pressing shifts the print onto its shadow layer */
export class Button extends Container {
  private face = new Container();
  private shadow = new Container();
  private ring = new Container();
  private plateKey = '';
  private txt: Text;
  private subTxt?: Text;
  private hover = false;
  private down = false;
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
    this.txt = new Text({ text, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: o.fontSize ?? 30, fill: WB.white, stroke: { color: WB.ink, width: 5 }, letterSpacing: 3 } });
    this.txt.anchor.set(0.5);
    this.txt.position.set(this.bw / 2, this.bh / 2 + (o.sub ? -8 : 0));
    this.face.addChild(this.txt);
    this.addChild(this.ring, this.shadow, this.face);
    if (o.sub) {
      this.subTxt = new Text({ text: o.sub, style: { fontFamily: FONT_BODY, fontWeight: '700', fontSize: 15, fill: WB.paper, stroke: { color: WB.ink, width: 3 } } });
      this.subTxt.anchor.set(0.5);
      this.subTxt.position.set(this.bw / 2, this.bh / 2 + 18);
      this.face.addChild(this.subTxt);
    }
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = { contains: (x: number, y: number) => x >= 0 && y >= 0 && x <= this.bw && y <= this.bh };
    this.on('pointerover', () => { this.hover = true; this.draw(); if (!this.disabled) sfx('hover'); });
    this.on('pointerout', () => { this.hover = false; this.down = false; this.draw(); });
    this.on('pointerdown', () => { if (!this.disabled) { this.down = true; this.draw(); } });
    this.on('pointerup', () => { this.down = false; this.draw(); });
    this.on('pointerupoutside', () => { this.down = false; this.draw(); });
    this.on('pointertap', (e) => { if (e.button === 2) return; if (this.disabled) { sfx('deny'); return; } sfx('click'); this.onClick?.(); });
    this.fitText();
    this.draw();
  }

  setText(t: string, sub?: string) {
    this.txt.text = t;
    if (this.subTxt && sub !== undefined) this.subTxt.text = sub;
    this.fitText();
  }

  /** keep the label inside the plate face (the cloud-scroll ends take ~20% on each side) */
  private fitText() {
    this.txt.scale.set(1);
    // the scroll ends scale with plate height, so short plates lose proportionally more width
    const maxW = Math.max(this.bw * 0.4, Math.min(this.bw * 0.62, this.bw - this.bh * 1.15)), maxH = this.bh * 0.62;
    const k = Math.min(1, maxW / Math.max(1, this.txt.width), maxH / Math.max(1, this.txt.height));
    this.txt.scale.set(k);
  }

  setDisabled(d: boolean) { if (d !== this.disabled) { this.disabled = d; this.draw(); } }
  setKind(k: Button['kind']) { if (k !== this.kind) { this.kind = k; this.draw(); } }

  tick(dt: number) {
    if (!this.pulse) { if (this.ring.visible) this.ring.visible = false; return; }
    this.pulseT += dt;
    const a = 0.5 + 0.5 * Math.sin(this.pulseT / 260);
    this.ring.visible = true;
    this.ring.alpha = a;
  }

  draw() {
    const w = this.bw, h = this.bh;
    const state = this.disabled ? 'disabled' : this.kind;
    const key = PLATE[state]!;
    if (key !== this.plateKey) {
      this.plateKey = key;
      this.face.children.filter((c) => c !== this.txt && c !== this.subTxt).forEach((c) => { this.face.removeChild(c); c.destroy({ children: true }); });
      this.face.addChildAt(nine(key, w, h), 0);
      // the print layer: the same plate texture inked black, offset under the plate
      this.shadow.removeChildren().forEach((c) => c.destroy({ children: true }));
      this.shadow.addChild(nine(key, w, h, { tint: WB.ink, alpha: 0.8 }));
      if (!this.ring.children.length) this.ring.addChild(selFrame('gold', w, h, 8));
    }
    this.shadow.position.set(4, 5);
    this.face.position.set(this.down ? 3 : 0, this.down ? 3 : this.hover && !this.disabled ? -2 : 0);
    this.ring.visible = this.pulse;
    this.txt.style.fill = this.disabled ? 0xc8bca8 : WB.white;
  }
}

// ───────────── tooltip ─────────────

export class Tooltip extends Container {
  constructor(lines: { title?: string; body: string; color?: number }[], width = 380) {
    super();
    // a lighter border (half-scale corners) keeps small tooltips from being all frame
    const CS = 0.5;
    const pad = Math.round(INSET.dark.x * CS) + 4;
    let y = Math.round(INSET.dark.y * CS) + 4;
    const parts: Container[] = [];
    for (const l of lines) {
      if (l.title) {
        const t = new Text({ text: l.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: l.color ?? C.goldLight } });
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
    const bg = panel(width, y + Math.round(INSET.dark.y * CS), 'dark', { cornerScale: CS });
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
  const t = new Text({ text, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: color, stroke: { color: 0x000000, width: 5 } } });
  t.anchor.set(0.5);
  const bg = nine('banner_band', t.width + 160, t.height + 40);
  bg.position.set(-(t.width + 160) / 2, -(t.height + 40) / 2);
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
  private dim: Container;
  private popKeys: () => void;
  onClose?: () => void;

  constructor(w: number, h: number, o: { title?: string; closable?: boolean; dim?: number } = {}) {
    super();
    this.dim = new Container();
    this.dim.addChild(dimLayer(1920, 1080, o.dim ?? 0.75), hitRect(0, 0, 1920, 1080));
    this.dim.eventMode = 'static';
    this.addChild(this.dim);
    const frame = new Container();
    frame.position.set((1920 - w) / 2, (1080 - h) / 2);
    const bg = panel(w, h, 'dark');
    frame.addChild(bg, this.body);
    if (o.title) {
      const t = title(o.title, 40);
      t.anchor.set(0.5, 0);
      t.position.set(w / 2, INSET.dark.y - 18);
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
