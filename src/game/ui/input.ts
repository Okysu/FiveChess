/**
 * In-canvas text input: click to focus, type, Enter / Esc to finish. While focused a hidden native <input> takes
 * the typing, so phones get their soft keyboard and paste works (Ctrl+V, long-press). Game hotkeys ignore keys
 * typed into it (core/app.ts). Letters are upper-cased; only letters, digits, '_' and '-' are kept.
 */
import { Container, Text } from 'pixi.js';
import { fs } from './profile';
import { nine, INSET } from './skin';
import { C, FONT_UI } from './theme';

const clean = (v: string, max: number) => v.toUpperCase().replace(/[^\w-]/g, '').slice(0, max);

export class TextInput extends Container {
  value = '';
  /** Enter pressed */
  onSubmit?: () => void;
  private bg = new Container();
  private txt: Text;
  private caret = new Text({ text: '｜', style: { fontFamily: FONT_UI, fontSize: fs(28), fill: C.goldLight } });
  private focused = false;
  private dom: HTMLInputElement | null = null;
  private t = 0;

  constructor(private w: number, private h: number, private placeholder = '', private maxLen = 24) {
    super();
    this.txt = new Text({ text: '', style: { fontFamily: FONT_UI, fontSize: Math.round(h * 0.45), fill: C.text } });
    this.txt.position.set(INSET.row.x + 6, h / 2);
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
    const el = document.createElement('input');
    el.type = 'text';
    el.value = this.value;
    el.maxLength = this.maxLen;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', 'characters');
    // 16px keeps iOS from zooming; invisible but in the viewport so the soft keyboard opens
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;';
    el.addEventListener('input', () => {
      const v = clean(el.value, this.maxLen);
      if (v !== el.value) el.value = v;
      this.value = v;
      this.draw();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); this.onSubmit?.(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.blur(); }
    });
    el.addEventListener('blur', () => { if (this.dom === el) this.blur(); });
    document.body.appendChild(el);
    this.dom = el;
    el.focus();
    this.draw();
  }

  blur() {
    this.focused = false;
    const el = this.dom;
    this.dom = null;
    if (el) { el.blur(); el.remove(); }
    this.draw();
  }

  /** set the text from code (e.g. a paste button) */
  setValue(v: string) {
    this.value = clean(v, this.maxLen);
    if (this.dom) this.dom.value = this.value;
    this.draw();
  }

  tick(dt: number) {
    this.t += dt;
    this.caret.visible = this.focused && Math.floor(this.t / 500) % 2 === 0;
  }

  draw() {
    if (this.destroyed) return;
    if (!this.bg.children.length) this.bg.addChild(nine('panel_row', this.w, this.h));
    (this.bg.children[0] as Container).alpha = this.focused ? 1 : 0.8;
    this.txt.text = this.value || (this.focused ? '' : this.placeholder);
    this.txt.style.fill = this.value ? C.text : C.textDim;
    this.caret.anchor.set(0, 0.5);
    this.caret.position.set(INSET.row.x + 8 + (this.value ? this.txt.width : 0), this.h / 2);
  }

  override destroy(o?: Parameters<Container['destroy']>[0]) {
    const el = this.dom;
    this.dom = null;
    this.focused = false;
    if (el) el.remove();
    super.destroy(o);
  }
}
