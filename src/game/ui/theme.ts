/** Visual theme tokens (docs/美术风格圣经.md). */
import { COLOR_INFO } from '../../engine/glossary';
import type { Color } from '../../engine/defs';

export const FONT_TITLE = '"Ma Shan Zheng","STKaiti","KaiTi","Kaiti SC","楷体",serif';
export const FONT_BODY = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
export const FONT_UI = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Source Han Sans SC",sans-serif';
export const FONT_NUM = '"Cinzel","Noto Serif SC","Georgia",serif';

export const C = {
  ink: 0x14100e,
  ink2: 0x221a16,
  panel: 0x1c1512,
  panelLight: 0x2c221c,
  paper: 0xefe4cc,
  paperDark: 0xd8c8a6,
  gold: 0xd9b25f,
  goldLight: 0xf5dc9a,
  goldDark: 0x8a6a2a,
  cinnabar: 0xc8321f,
  jade: 0x5fbf8a,
  red: 0xe0473a,
  green: 0x6fe08a,
  blue: 0x6aa8e8,
  white: 0xffffff,
  text: 0xf2e8d4,
  textDim: 0xa99a82,
  textDark: 0x2a1f18,
  hp: 0xd23a32,
  armor: 0x7fa6d6,
  shadow: 0x000000,
};

export const RARITY_COLOR: Record<string, number> = {
  basic: 0x9a8a72, common: 0xb08d57, rare: 0x4fb0a8, epic: 0xa66ae0, legendary: 0xf0a52a, token: 0x9a8a72, special: 0xb0a090,
};

export const RARITY_NAME: Record<string, string> = { basic: '基础', common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', token: '衍生', special: '特殊' };
export const TYPE_NAME: Record<string, string> = { unit: '随从', tactic: '策略', response: '应对', equip: '装备', delay: '延时', field: '阵地', status: '状态', curse: '诅咒' };

export function factionColor(f: Color) { return COLOR_INFO[f].hex; }
export function factionDark(f: Color) { return COLOR_INFO[f].dark; }
export function factionLight(f: Color) { return COLOR_INFO[f].light; }

/** frame metal per faction (style bible §4) */
export const FRAME_METAL: Record<Color, [number, number, number]> = {
  R: [0x9a4a2a, 0xe0925a, 0x4a1a10], // red bronze
  B: [0x4a5668, 0xa8b8d0, 0x1a2230], // dark iron
  G: [0x3f7a5a, 0x9ad8b0, 0x12301f], // green jade
  Y: [0xb08a2a, 0xf8e08a, 0x4a3408], // gilt
  P: [0x5e4a78, 0xc8b0e8, 0x201630], // black silver
  N: [0x7a6448, 0xd8c09a, 0x2e2418], // old wood
};

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
