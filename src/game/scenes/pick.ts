/** Deck selection screen for remove / upgrade / transform / duplicate, and event card choices. */
import { Text } from 'pixi.js';
import { RunScreen } from './common';
import { session } from '../state';
import { act } from '../router';
import { pickCandidates } from '../../engine/run/run';
import { pickCards } from '../ui/hud';
import { Button } from '../ui/widgets';
import { C, FONT_TITLE } from '../ui/theme';
import { CardView } from '../ui/card';
import { tweens } from '../core/tween';
import { sfx } from '../audio/audio';

const KIND: Record<string, { title: string; confirm: string }> = {
  remove: { title: '选择要移除的牌', confirm: '移除' },
  upgrade: { title: '选择要升级的牌（悬停预览升级后）', confirm: '升级' },
  transform: { title: '选择要变化的牌', confirm: '变化' },
  duplicate: { title: '选择要复制的牌', confirm: '复制' },
  loseRelic: { title: '选择', confirm: '确定' },
};

export class PickScene extends RunScreen {
  override async enter() {
    const r = session.run!;
    const sc = r.screen;
    await this.setup({ bg: sc.k === 'pick' && sc.source === 'camp' ? 'camp' : sc.k === 'pick' && sc.source === 'shop' ? 'shop' : 'event', dim: 0.55 });
    if (sc.k === 'cardChoice') {
      const t = new Text({ text: `选择 ${sc.n} 张加入牌组`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 48, fill: C.goldLight, stroke: { color: 0, width: 5 } } });
      t.anchor.set(0.5); t.position.set(960, 190);
      this.addChild(t);
      const picked = new Set<number>();
      sc.options.forEach((c, i) => {
        const v = new CardView(c);
        v.scale.set(0.8);
        v.position.set(960 + (i - (sc.options.length - 1) / 2) * 300, 540);
        v.eventMode = 'static';
        v.cursor = 'pointer';
        v.on('pointertap', () => {
          if (picked.has(c.uid)) { picked.delete(c.uid); v.setGlow('none'); }
          else if (picked.size < sc.n) { picked.add(c.uid); v.setGlow('selected'); }
          sfx('click');
        });
        v.on('pointerover', () => void tweens.to(v.scale, { x: 0.86, y: 0.86 }, 100));
        v.on('pointerout', () => void tweens.to(v.scale, { x: 0.8, y: 0.8 }, 100));
        this.addChild(v);
      });
      const ok = new Button('确定', { width: 240, height: 72, kind: 'primary', onClick: () => void act({ t: 'pick', uids: [...picked] }) });
      ok.position.set(840, 900);
      this.addChild(ok);
      return;
    }
    if (sc.k !== 'pick') return;
    const info = KIND[sc.kind] ?? KIND.remove!;
    const cands = pickCandidates(r, sc.kind, sc.filter);
    pickCards(cands, {
      title: info.title, n: sc.n, confirm: info.confirm, upgradePreview: sc.kind === 'upgrade', optional: sc.optional,
      onDone: (uids) => { sfx(sc.kind === 'upgrade' ? 'buff' : 'discard'); void act(uids.length ? { t: 'pick', uids } : { t: 'proceed' }); },
    });
  }
}
