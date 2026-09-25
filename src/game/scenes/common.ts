/** Shared base for run screens: backdrop, top bar, title, continue button. */
import { Container, Graphics, Text } from 'pixi.js';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { TopBar } from '../ui/hud';
import { Button, title } from '../ui/widgets';
import { session } from '../state';
import { audio, type MusicMood } from '../audio/audio';
import { C } from '../ui/theme';

export abstract class RunScreen extends Scene {
  top!: TopBar;
  protected content = new Container();

  async setup(o: { bg: string; music?: MusicMood; tint?: number; heading?: string; dim?: number }) {
    await assets.load(K.bg(o.bg));
    G.setBackdrop(assets.get(K.bg(o.bg)), o.tint ?? 0xffffff);
    if (o.music) audio.playMusic(o.music);
    if (o.dim) this.addChild(new Graphics().rect(0, 0, 1920, 1080).fill({ color: 0, alpha: o.dim }));
    this.addChild(this.content);
    this.top = new TopBar(session.run!, {
      onSettings: () => void import('./settings').then((m) => m.openSettings()),
      onCodex: () => void import('./codex').then((m) => m.openCodexModal()),
    });
    this.addChild(this.top);
    if (o.heading) {
      const t = title(o.heading, 64);
      t.anchor.set(0.5, 0);
      t.position.set(960, 150);
      this.addChild(t);
    }
  }

  continueButton(text: string, onClick: () => void, x = 1600, y = 960): Button {
    const b = new Button(text, { width: 280, height: 76, fontSize: 32, kind: 'primary', onClick });
    b.position.set(x, y);
    this.addChild(b);
    return b;
  }
}

export function note(text: string, size = 24, color = C.text): Text {
  return new Text({ text, style: { fontFamily: '"Noto Serif SC","Songti SC","SimSun",serif', fontSize: size, fill: color, stroke: { color: 0, width: 4 } } });
}
