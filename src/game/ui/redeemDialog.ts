/** 兑换码 dialog (设置 → 通用): paste or type a code; shows what it contains and what it unlocked. */
import { Sprite, Text } from 'pixi.js';
import { fs } from './profile';
import { INSET } from './skin';
import { Button, Modal, toast } from './widgets';
import { C, FONT_BODY } from './theme';
import { TextInput } from './input';
import { richTexture } from './richtext';
import { G } from '../core/app';
import { session } from '../state';
import { expiryDate, redeem, type RedeemOutcome } from '../../engine/redeem';

const ERRORS: Record<Exclude<RedeemOutcome, { ok: true }>['error'], string> = {
  format: '格式不对：兑换码是 5 组、每组 5 个字符（如 XXXXX-XXXXX-XXXXX-XXXXX-XXXXX）。',
  check: '兑换码无效：请检查是否有输错的字符。',
  version: '这个兑换码需要更新游戏后才能使用。',
  type: '这个兑换码需要更新游戏后才能使用。',
  expired: '兑换码已过期。',
  used: '这个兑换码已经在本存档兑换过了。',
};

const fmtExpiry = (day: number) => (day === 0 ? '永久有效' : `有效期至 ${expiryDate(day).toISOString().slice(0, 10)}`);

export function openRedeem() {
  const W = 1160, H = 620;
  const m = new Modal(W, H, { title: '兑换码' });
  const tip = new Text({ text: '输入官方发放的兑换码，每个兑换码在一个存档里只能使用一次。', style: { fontFamily: FONT_BODY, fontSize: fs(21), fill: C.textDim, wordWrap: true, wordWrapWidth: W - INSET.dark.x * 2, breakWords: true } });
  tip.position.set(INSET.dark.x, 110);
  const input = new TextInput(W - INSET.dark.x * 2 - 170, 76, 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX', 32);
  input.position.set(INSET.dark.x, 168);
  const paste = new Button('粘贴', { width: 150, height: 76, fontSize: fs(24), kind: 'ghost', onClick: () => {
    void navigator.clipboard?.readText?.().then((t) => input.setValue(t.trim())).catch(() => toast('无法读取剪贴板，请长按输入框粘贴'));
  } });
  paste.position.set(W - INSET.dark.x - 150, 168);
  let result: Sprite | null = null;
  let changed = false;
  const show = (text: string) => {
    result?.destroy({ texture: true });
    const { texture } = richTexture(text, { width: W - INSET.dark.x * 2, height: 220, fontSize: fs(22), minFontSize: 16, color: 0xeadfc8, align: 'left', vAlign: 'top', lineHeight: 1.5 });
    result = new Sprite(texture);
    result.position.set(INSET.dark.x, 272);
    m.body.addChild(result);
  };
  const submit = () => {
    const r = redeem(session.profile, input.value);
    if (!r.ok) {
      const extra = r.error === 'expired' && r.code ? `（${fmtExpiry(r.code.expiry)}）` : '';
      show(`${ERRORS[r.error]}${extra}`);
      return;
    }
    changed = true;
    void session.saveProfile();
    // a big grant can open the whole unlock track: keep the list to what fits
    const shown = r.notices.length > 5 ? r.notices.slice(0, 4) : r.notices;
    const lines = [`兑换成功：${r.typeDef.describe(r.code.amount, r.code.param)}（${fmtExpiry(r.code.expiry)}）`, ...shown.map((n) => `✦ ${n}`)];
    if (shown.length < r.notices.length) lines.push(`✦ 另有 ${r.notices.length - shown.length} 项解锁，可在图鉴中查看`);
    show(lines.join('\n'));
    input.setValue('');
  };
  input.onSubmit = submit;
  const ok = new Button('兑　换', { width: 240, height: 72, fontSize: fs(28), kind: 'primary', onClick: submit });
  ok.position.set((W - 240) / 2, H - 110);
  m.body.addChild(tip, input, paste, ok);
  const tick = (t: { deltaMS: number }) => { if (!input.destroyed) input.tick(t.deltaMS); };
  G.app.ticker.add(tick);
  m.onClose = () => {
    G.app.ticker.remove(tick);
    // the title shows 命数 and the next unlock: rebuild it after a successful redeem (instanceof: names are minified)
    if (changed) void import('../scenes/title').then((t) => { if (G.scene instanceof t.TitleScene) G.go(new t.TitleScene()); });
  };
  input.focus();
}
