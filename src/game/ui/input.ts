/** Minimal in-canvas text input (no DOM): click to focus, type, Backspace, Enter/Esc to blur. */
import { Container, Graphics, Text } from 'pixi.js';
import { G } from '../core/app';
import { C, FONT_UI } from './theme';

export class TextInput extends Container {
  value = '';
  private bg = new Graphics();
  private txt: Text;
  private caret = new Graphics();
  private focused = false;
  private pop: (() => void) | null = null;
  private t = 0;

  constructor(private w: number, private h: number, private placeholder = '', private maxLen = 24) {
    super();
    this.txt = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: Math.round(h * 0.45), fill: C.text } });
    this.txt.position.set(14, h / 2);
    this.txt.anchor.set(0, 0.5);
    this.addChild(this.bg, this.txt, this.caret);
    this.eventMode = 'static';
    this.cursor = 'text';
    this.on('pointertap', () => this.focus());
    this.draw();
  }

  focus() {
    if (this.focused) return;
    this.focused = true;
    this.pop = G.pushKeys((e) => {
      if (!this.focused) return false;
      if (e.key === 'Enter' || e.key === 'Escape') { this.blur(); return true; }
      if (e.key === 'Backspace') { this.value = this.value.slice(0, -1); this.draw(); return true; }
      if (e.key.length === 1 && this.value.length < this.maxLen && /[\w\-]/.test(e.key)) { this.value += e.key.toUpperCase(); this.draw(); return true; }
      return true;
    });
    this.draw();
  }

  blur() {
    this.focused = false;
    this.pop?.();
    this.pop = null;
    this.draw();
  }

  tick(dt: number) {
    this.t += dt;
    this.caret.visible = this.focused && Math.floor(this.t / 500) % 2 === 0;
  }

  draw() {
    this.bg.clear().roundRect(0, 0, this.w, this.h, 8).fill({ color: 0x0d0907, alpha: 0.85 }).stroke({ width: 2, color: this.focused ? C.goldLight : C.goldDark });
    this.txt.text = this.value || (this.focused ? '' : this.placeholder);
    this.txt.style.fill = this.value ? C.text : C.textDim;
    this.caret.clear().rect(0, -this.h * 0.3, 2, this.h * 0.6).fill(C.goldLight);
    this.caret.position.set(16 + (this.value ? this.txt.width : 0), this.h / 2);
  }

  override destroy(o?: Parameters<Container['destroy']>[0]) { this.pop?.(); super.destroy(o); }
}
