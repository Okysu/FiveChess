/** 招贤 (UI研究笔记 §14.9): three lieutenant cards, or a small boon if one is already recruited. */
import { Container, Sprite, Text } from 'pixi.js';
import { panel as uiPanel, maskRect } from '../ui/skin';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { content } from '../../engine/content';
import { COLOR_INFO } from '../../engine/glossary';
import { Button, Tooltip, glossLines, hideTip, showTip } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE, factionColor } from '../ui/theme';
import { assets, K } from '../assets';
import { tweens } from '../core/tween';
import { richTexture } from '../ui/richtext';
import { termsOf } from '../ui/hud';
import { sfx } from '../audio/audio';

const SKILL_TYPE: Record<string, string> = { passive: '被动', active: '主动', limited: '限定技', awaken: '觉醒技' };

export class RecruitScene extends RunScreen {
  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    if (sc.k !== 'recruit') return;
    await this.setup({ bg: 'recruit', music: 'camp', heading: '「 招 贤 」', dim: 0.3 });
    if (sc.done) { this.continueButton('继续前进 →', () => void act({ t: 'proceed' })); return; }
    if (!sc.options.length) {
      const t = new Text({ text: '已有副将随行。贤士们赠你盘缠，祝你一路顺风。', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 34, fill: C.text, stroke: { color: 0, width: 5 } } });
      t.anchor.set(0.5); t.position.set(960, 500);
      this.addChild(t);
      this.continueButton('收下（+50 金）', () => void act({ t: 'recruit', i: null }), 820, 640);
      return;
    }
    await assets.loadMany(sc.options.map((id) => K.hero(id)));
    const cmdColor = content().commander(r.commander).faction;
    sc.options.forEach((id, i) => {
      const lt = content().lieutenants.get(id)!;
      const c = new Container();
      c.position.set(960 + (i - 1) * 420 - 180, 250);
      const bg = uiPanel(360, 690, 'dark');
      c.addChild(bg);
      const m = maskRect(36, 36, 288, 250, 0);
      const tex = assets.get(K.hero(id));
      if (tex) { c.addChild(m); const s = new Sprite(tex); const k = 420 / tex.height; s.scale.set(k); s.anchor.set(0.5, 0); s.position.set(180, 6); s.mask = m; c.addChild(s); }
      const nm = new Text({ text: `${lt.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 42, fill: C.goldLight, stroke: { color: 0, width: 5 } } });
      nm.position.set(50, 284);
      const tt = new Text({ text: `「${lt.title}」 ${COLOR_INFO[lt.faction].school}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 22, fill: factionColor(lt.faction), stroke: { color: 0, width: 4 } } });
      tt.position.set(50, 336);
      const sk = new Text({ text: `【${SKILL_TYPE[lt.skill.type]}】${lt.skill.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: 0xffc88a } });
      sk.position.set(50, 374);
      const { texture } = richTexture(lt.skill.text, { width: 260, height: 150, fontSize: 20, minFontSize: 14, color: 0xeadfc8, align: 'left', vAlign: 'top' });
      const st = new Sprite(texture);
      st.position.set(50, 412);
      const extra = new Text({ text: `招募后：1 枚素源变为${COLOR_INFO[lt.faction].name}源\n奖励卡池加入${COLOR_INFO[lt.faction].name}色（${COLOR_INFO[cmdColor].name}${COLOR_INFO[lt.faction].name}双色）`, style: { fontFamily: FONT_BODY, fontSize: 18, fill: C.textDim, lineHeight: 26 } });
      extra.position.set(50, 576);
      c.addChild(nm, tt, sk, st, extra);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      c.on('pointerover', (e) => { void tweens.to(c.scale, { x: 1.03, y: 1.03 }, 120); const g = glossLines(termsOf(lt.skill.text)); if (g.length) showTip(new Tooltip([...g, { title: '生平', body: lt.lore }], 380), c.x + 380, 300); void e; });
      c.on('pointerout', () => { void tweens.to(c.scale, { x: 1, y: 1 }, 120); hideTip(); });
      c.on('pointertap', () => { sfx('relic'); void act({ t: 'recruit', i }); });
      this.content.addChild(c);
    });
    const skip = new Button('不招募', { width: 220, height: 64, kind: 'ghost', onClick: () => void act({ t: 'recruit', i: null }) });
    skip.position.set(850, 968);
    this.addChild(skip);
  }
}
