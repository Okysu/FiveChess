/** Minimal in-canvas text input (no DOM): click to focus, type, Backspace, Enter/Esc to blur. */
import { Container, Text } from 'pixi.js';
import { nine } from './skin';
import { G } from '../core/app';
import { C, FONT_UI } from './theme';

export class TextInput extends Container {
  value = '';
  private bg = new Container();
  private txt: Text;
  private caret = new Text({ text: '｜', style: { fontFamily: FONT_UI, fontSize: 28, fill: C.goldLight } });
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
    if (!this.bg.children.length) this.bg.addChild(nine('panel_row', this.w, this.h));
    (this.bg.children[0] as Container).alpha = this.focused ? 1 : 0.8;
    this.txt.text = this.value || (this.focused ? '' : this.placeholder);
    this.txt.style.fill = this.value ? C.text : C.textDim;
    this.caret.anchor.set(0, 0.5);
    this.caret.position.set(16 + (this.value ? this.txt.width : 0), this.h / 2);
  }

  override destroy(o?: Parameters<Container['destroy']>[0]) { this.pop?.(); super.destroy(o); }
}
