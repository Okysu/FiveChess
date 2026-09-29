/** 冒险结算：胜利（含主帅专属结局）、失败、隐藏首领抉择。 */
import { Container, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, dim, INSET } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { runScore } from '../../engine/meta';
import { Button, Modal, title } from '../ui/widgets';
import { ScrollBox } from '../ui/scroll';
import { hintOnce } from '../ui/hints';
import { fitText } from '../ui/textwrap';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { tweens } from '../core/tween';
import { audio, sfx } from '../audio/audio';
import { Particles } from '../fx/fx';
import intro from '../../data/lore/intro.json';
import epilogues from '../../data/lore/epilogues.json';

export class RunEndScene extends Scene {
  private parts = new Particles();
  private spawn?: () => void;
  private acc = 0;

  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k === 'hiddenChoice') { await this.hidden(); return; }
    if (sc.k === 'finalChoice') { await this.finalPage(); return; }
    const win = sc.k === 'victory';
    await assets.load(K.bg(win ? 'victory' : 'defeat'));
    G.setBackdrop(assets.get(K.bg(win ? 'victory' : 'defeat')));
    audio.playMusic(win ? 'victory' : 'defeat');
    this.addChild(dim(G.view.width, G.view.height, 0.5, G.view.left, G.view.top), this.parts);
    this.spawn = this.parts.ambient(win ? 'petals' : 'ink', 1920, 1080, 0.5);
    sfx(win ? 'victory' : 'defeat');
    if (r.result && !session.lastUnlocks.length && !(r as { _recorded?: boolean })._recorded) { /* recorded by session.finishCombat */ }
    const t = title(win ? '改 命 · 功 成' : '命 数 已 尽', 110, { fill: win ? 0xffd27a : 0xc8b0b0 });
    t.anchor.set(0.5); t.position.set(960, 170);
    this.addChild(t);
    const cmd = content().commander(r.commander);
    const lore = intro as { victory: string; defeat: string[] };
    // story choices made during the run (event flags) each add a closing passage
    const epi = win ? (epilogues as { victory: { flag: string; text: string }[] }).victory.filter((e) => r.flags.includes(e.flag)).map((e) => e.text) : [];
    // 主帅命途: the last choice of the commander's story adds its own paragraph to the ending
    const paths = (epilogues as { paths?: Record<string, { a: string; b: string }> }).paths?.[cmd.id];
    const pathText = paths ? (r.flags.includes(`path_${cmd.id}_a`) ? paths.a : r.flags.includes(`path_${cmd.id}_b`) ? paths.b : '') : '';
    const body = win ? [lore.victory, cmd.ending, pathText, ...epi].filter(Boolean).join('\n\n') : lore.defeat[r.act % lore.defeat.length] ?? '';
    const panel = uiPanel(1100, 480, 'dark');
    panel.position.set(410, 280);
    this.addChild(panel);
    const bt = new Text({ text: body, style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: C.text, wordWrap: true, wordWrapWidth: 1100 - INSET.dark.x * 2, lineHeight: 40, breakWords: true } });
    const maxH = 480 - INSET.dark.y * 2;
    if (bt.height > maxH) {
      // a long ending (commander ending + 命途 + story passages) scrolls instead of shrinking to nothing on phones
      const box = new ScrollBox(1100 - INSET.dark.x * 2, maxH);
      box.position.set(410 + INSET.dark.x, 280 + INSET.dark.y);
      box.content.addChild(bt);
      box.refresh();
      this.addChild(box);
    } else {
      bt.position.set(410 + INSET.dark.x, 280 + INSET.dark.y);
      this.addChild(bt);
    }
    const stats = `${cmd.name} · 逆命 ${r.ascension} · 第${r.act}幕 第${r.floor}层 · 精英 ${r.stats.elites} · 首领 ${r.stats.bosses} · 最高单场伤害 ${r.stats.maxDamage} · 命数 +${runScore(r)}`;
    const st = new Text({ text: stats, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.goldLight, stroke: { color: 0, width: 4 } } });
    st.anchor.set(0.5); st.position.set(960, 800);
    this.addChild(st);
    if (!win && r.nemesis) {
      const n = content().encounters.get(r.nemesis);
      const names = n?.enemies.map((e) => content().enemies.get(e.id)?.name).join('、');
      const nt = new Text({ text: `折戟于：${names}`, style: { fontFamily: FONT_BODY, fontSize: fs(22), fill: 0xd0a0a0 } });
      nt.anchor.set(0.5); nt.position.set(960, 840);
      this.addChild(nt);
    }
    // unlocks, 精通 levels and 命途 can be many: three lines, then a link to the full list
    const unlocks = session.lastUnlocks;
    const shown = unlocks.length > 4 ? unlocks.slice(0, 3) : unlocks;
    const lines = [...shown.map((u) => `✦ ${u}`), ...(unlocks.length > shown.length ? [`……另有 ${unlocks.length - shown.length} 项新解锁（点此查看全部）`] : [])];
    lines.forEach((u, i) => {
      const more = i === shown.length;
      const ut = new Text({ text: u, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(more ? 22 : 26), fill: more ? C.goldLight : 0x9adfa8, stroke: { color: 0, width: 4 } } });
      ut.anchor.set(0.5); ut.position.set(960, 890 + i * 36);
      ut.alpha = 0;
      if (more) { ut.eventMode = 'static'; ut.cursor = 'pointer'; ut.on('pointertap', () => this.allUnlocks(unlocks)); }
      this.addChild(ut);
      void tweens.to(ut, { alpha: 1 }, 400, { delay: 800 + i * 300 });
    });
    const b = new Button('回到标题', { width: 260, height: 72, kind: 'primary', onClick: () => { session.run = null; session.combat = null; session.lastUnlocks = []; void import('./title').then((m) => G.go(new m.TitleScene())); } });
    b.position.set(1620, 980);
    this.addChild(b);
  }

  private allUnlocks(list: string[]) {
    const m = new Modal(1100, 820, { title: '本局解锁' });
    const box = new ScrollBox(1100 - INSET.dark.x * 2, 820 - 110 - INSET.dark.y);
    box.position.set(INSET.dark.x, 110);
    let y = 0;
    for (const u of list) {
      const t = new Text({ text: `✦ ${u}`, style: { fontFamily: FONT_BODY, fontSize: fs(23), fill: C.text, wordWrap: true, wordWrapWidth: 1100 - INSET.dark.x * 2 - 40, breakWords: true } });
      t.position.set(10, y);
      box.content.addChild(t);
      y += t.height + 10;
    }
    box.refresh();
    m.body.addChild(box);
  }

  /** first 精通 level-up: explain what 精通 gives */
  override shown() { if (session.lastUnlocks.some((u) => / 精通 \d/.test(u))) hintOnce('mastery'); }

  /** 真结局: the last line of the book — close it, or leave it open */
  private async finalPage() {
    await assets.load(K.bg('battle_4'));
    G.setBackdrop(assets.get(K.bg('battle_4')));
    audio.playMusic('map4');
    this.addChild(dim(G.view.width, G.view.height, 0.7, G.view.left, G.view.top));
    const t = title('最 后 一 页', 90);
    t.anchor.set(0.5); t.position.set(960, 220);
    const text = '司命把笔放进你手里，翻到命书的最后一页。页上只有一行字，是三百年前被抄错的那一句：「此书未终」。那个“未”字的墨，到今天还没有干。\n\n你拼回了十五页残卷，知道了那一夜的全部：王的一问，宰辅的一道矫诏，一场不在军令里的火，和一个抄书吏手抖写下的错字。\n\n你可以把它改回原样——命书合上，众生的命数重新写定，命阙随之崩塌，执命者也将从书中消失；也可以让这个字，就这样错下去。';
    const body = new Text({ text, style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.text, wordWrap: true, wordWrapWidth: 1200, align: 'left', lineHeight: Math.round(fs(26) * 1.6), breakWords: true } });
    fitText(body, 700 - 330);
    body.anchor.set(0.5, 0); body.position.set(960, 320);
    this.addChild(t, body);
    const a = new Button('写下「此书终」', { width: 360, height: 84, fontSize: fs(30), onClick: () => void act({ t: 'final', close: true }) });
    a.position.set(560, 800);
    const b = new Button('留下「此书未终」', { width: 360, height: 84, fontSize: fs(30), kind: 'primary', onClick: () => void act({ t: 'final', close: false }) });
    b.position.set(1000, 800);
    this.addChild(a, b);
  }

  private async hidden() {
    await assets.load(K.bg('battle_4'));
    G.setBackdrop(assets.get(K.bg('battle_4')));
    audio.playMusic('map4');
    this.addChild(dim(G.view.width, G.view.height, 0.6, G.view.left, G.view.top));
    const t = title('命 书 合 上 之 前', 90);
    t.anchor.set(0.5); t.position.set(960, 260);
    const body = new Text({ text: '司命的笔落在你手里。书页深处，有什么东西在等你——它有你的脸，也有你的执念。\n\n合上命书，就此改命；或者，直视那无名之物。', style: { fontFamily: FONT_BODY, fontSize: fs(28), fill: C.text, wordWrap: true, wordWrapWidth: 1100, align: 'center', lineHeight: 46, breakWords: true } });
    body.anchor.set(0.5, 0); body.position.set(960, 380);
    this.addChild(t, body);
    const a = new Button('合上命书', { width: 300, height: 80, fontSize: fs(32), onClick: () => void act({ t: 'hidden', go: false }) });
    a.position.set(600, 760);
    const b = new Button('直视无名', { width: 300, height: 80, fontSize: fs(32), kind: 'danger', onClick: () => void act({ t: 'hidden', go: true }) });
    b.position.set(1020, 760);
    this.addChild(a, b);
    void Container;
  }

  override update(dt: number) {
    this.acc += dt;
    while (this.acc > 70) { this.acc -= 70; this.spawn?.(); }
    this.parts.update(dt);
  }
}
