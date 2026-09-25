/** Visual theme tokens (docs/美术风格圣经.md). */
import { COLOR_INFO } from '../../engine/glossary';
import type { Color } from '../../engine/defs';

/** carved Song-style headings (woodblock prints use heavy Song/Ming type) */
export const FONT_TITLE = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
/** brush calligraphy, reserved for the logo and act titles */
export const FONT_BRUSH = '"Ma Shan Zheng","STKaiti","KaiTi","Kaiti SC","楷体",serif';
export const FONT_BODY = '"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';
export const FONT_UI = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Source Han Sans SC",sans-serif';
export const FONT_NUM = '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';

export const C = {
  ink: 0x14100e,
  ink2: 0x221a16,
  panel: 0x1c1512,
  panelLight: 0x2c221c,
  paper: 0xefe4cc,
  paperDark: 0xd8c8a6,
  gold: 0xd9a23a,
  goldLight: 0xf3d488,
  goldDark: 0x8a5e1a,
  cinnabar: 0xc8321f,
  jade: 0x3fa870,
  red: 0xe0473a,
  green: 0x6fe08a,
  blue: 0x6aa8e8,
  white: 0xffffff,
  text: 0xf3e6c6,
  textDim: 0xb5a384,
  textDark: 0x2a1f18,
  hp: 0xd23a32,
  armor: 0x7fa6d6,
  shadow: 0x000000,
};

export const RARITY_COLOR: Record<string, number> = {
  basic: 0x8a7e6e, common: 0xa8906a, rare: 0x2f8a8a, epic: 0x7a3a8a, legendary: 0xe0762a, token: 0x8a7e6e, special: 0x9a8e7a,
};

export const RARITY_NAME: Record<string, string> = { basic: '基础', common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', token: '衍生', special: '特殊' };
export const TYPE_NAME: Record<string, string> = { unit: '随从', tactic: '策略', response: '应对', equip: '装备', delay: '延时', field: '阵地', status: '状态', curse: '诅咒' };

export function factionColor(f: Color) { return COLOR_INFO[f].hex; }
export function factionDark(f: Color) { return COLOR_INFO[f].dark; }
export function factionLight(f: Color) { return COLOR_INFO[f].light; }

/** frame metal per faction (style bible §4) */
export const FRAME_METAL: Record<Color, [number, number, number]> = {
  R: [0xc8321f, 0xe8603a, 0x8a1f12],
  B: [0x2a4f8a, 0x4a78b8, 0x16294a],
  G: [0x2f8a5f, 0x4fb07c, 0x1a4a32],
  Y: [0xd9a23a, 0xf0c060, 0x8a5e1a],
  P: [0x6e3a78, 0x9a5aa8, 0x3a1a42],
  N: [0x8a7e6a, 0xb0a488, 0x4a4234],
};

export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
