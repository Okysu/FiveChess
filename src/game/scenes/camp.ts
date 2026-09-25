/** 营地 (UI研究笔记 §14.5): 升级 / 删牌 / 休憩 三选一 */
import { Container, Graphics, Text } from 'pixi.js';
import { panel as uiPanel } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { iconSprite } from '../ui/draw';
import { tweens } from '../core/tween';
import { sfx } from '../audio/audio';
import { Particles } from '../fx/fx';
import { content } from '../../engine/content';
import { toast } from '../ui/widgets';

export class CampScene extends RunScreen {
  private parts = new Particles();
  private spawn?: () => void;
  private acc = 0;

  override async enter() {
    await this.setup({ bg: 'camp', music: 'camp', dim: 0.2 });
    this.addChildAt(this.parts, 1);
    this.spawn = this.parts.ambient('embers', 1920, 1080, 0.8);
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'camp') return;
    const noHeal = r.relics.some((x) => content().relics.get(x.id)?.run?.some((rr) => rr.rule === 'noHealAtRest'));
    const bonus = r.relics.reduce((s, x) => s + (content().relics.get(x.id)?.run?.filter((rr) => rr.rule === 'restHealBonus').reduce((a, rr) => a + ((rr as { amount: number }).amount), 0) ?? 0), 0);
    const heal = Math.round(r.maxHp * 0.3) + bonus;
    const opts = [
      { key: 'upgrade' as const, title: '修　炼', sub: '升级 1 张卡牌', icon: 'kw_growth', glyph: '修', disabled: !r.deck.some((d) => !d.up && content().card(d.id).upgrade) },
      { key: 'remove' as const, title: '斩　念', sub: '移除 1 张卡牌', icon: 'kw_exhaust', glyph: '斩', disabled: r.deck.length === 0 },
      { key: 'heal' as const, title: '调　息', sub: noHeal ? '无法恢复' : r.hp >= r.maxHp ? '生命已满' : `恢复 ${heal} 生命\n${r.hp} → ${Math.min(r.maxHp, r.hp + heal)}`, icon: 'st_regen', glyph: '息', disabled: noHeal || r.hp >= r.maxHp },
    ];
    opts.forEach((o, i) => {
      const c = new Container();
      c.position.set(420 + i * 380, 580);
      const bg = uiPanel(340, 340, 'dark');
      c.addChild(bg);
      const ic = iconSprite(o.icon, 96, o.glyph, C.goldLight);
      ic.position.set(170, 104);
      const t = new Text({ text: o.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 44, fill: o.disabled ? C.textDim : C.goldLight } });
      t.anchor.set(0.5); t.position.set(170, 196);
      const s = new Text({ text: o.sub, style: { fontFamily: FONT_BODY, fontSize: 22, fill: C.text, align: 'center' } });
      s.anchor.set(0.5, 0); s.position.set(170, 228);
      c.addChild(ic, t, s);
      if (o.disabled || sc.done) c.alpha = 0.5;
      c.eventMode = 'static';
      c.cursor = o.disabled || sc.done ? 'default' : 'pointer';
      c.on('pointerover', () => { if (!o.disabled && !sc.done) void tweens.to(c.scale, { x: 1.04, y: 1.04 }, 120); });
      c.on('pointerout', () => void tweens.to(c.scale, { x: 1, y: 1 }, 120));
      c.on('pointertap', async () => {
        if (o.disabled || sc.done) { sfx('deny'); return; }
        sfx(o.key === 'heal' ? 'heal' : 'click');
        const err = await act({ t: 'rest', opt: o.key });
        if (err) toast(err);
      });
      this.content.addChild(c);
    });
    if (sc.done) this.continueButton('继续前进 →', () => void act({ t: 'proceed' }), 1560, 960);
    const hint = new Text({ text: '篝火边，命数暂歇。', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 40, fill: C.text, stroke: { color: 0, width: 5 } } });
    hint.anchor.set(0.5); hint.position.set(960, 300);
    this.addChild(hint);
  }

  override update(dt: number) {
    this.acc += dt;
    while (this.acc > 50) { this.acc -= 50; this.spawn?.(); }
    this.parts.update(dt);
  }
}
