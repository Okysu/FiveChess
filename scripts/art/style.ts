/** Prompt building blocks — art direction: Chinese woodblock New Year print 木版年画 (docs/美术风格圣经.md). */
import type { Color } from '../../src/engine/defs';

export const STYLE_LOCK =
  'Made as a Chinese woodblock print in the traditional New Year print (nianhua) style: bold carved black outlines of even weight, ' +
  'flat saturated mineral colors (vermilion, malachite green, azurite blue, ochre, lamp black, paper white), visible rice-paper grain, ' +
  'slight color misregistration between print layers, decorative flat composition with patterned clouds, flames and waves, ' +
  'no shading gradients, no airbrush, no 3D rendering, no photorealism, no Western fantasy armor or architecture — Chinese costume and motifs only. ' +
  'Absolutely no text, no letters, no numbers, no calligraphy, no seals, no watermark, no signature.';

export const CARD_COMPOSITION =
  'Full-bleed square composition, main subject centered slightly above the middle, the lower third kept simple, decorative patterned background.';

export const CUTOUT =
  'Single subject isolated on a fully transparent background, the whole figure visible and not cropped, no ground, no background scenery.';

export const CUTOUT_MAGENTA =
  'Single subject isolated on a perfectly flat solid pure magenta (#FF00FF) background, no gradient, no shadow, no scenery, the whole figure visible.';

/** every school keeps the woodblock mineral palette, but one pigment dominates */
export const FACTION_TONE: Record<Color, string> = {
  R: 'Dominant pigments: vermilion and cinnabar red with lamp black, small touches of ochre gold; patterned flames.',
  B: 'Dominant pigments: azurite blue and lamp black with paper white; patterned waves, frost and mountains.',
  G: 'Dominant pigments: malachite green with ochre and lamp black; patterned leaves, vines and roots.',
  Y: 'Dominant pigments: ochre gold and warm yellow with azurite night blue accents; patterned stars and auspicious clouds.',
  P: 'Dominant pigments: plum purple and indigo with small malachite accents and lamp black; patterned smoke, silk and lanterns.',
  N: 'Dominant pigments: muted ochre, paper beige and grey-green with lamp black; restrained.',
};

export const ACT_TONE: Record<number, string> = {
  1: 'Setting: a forest of toppled ancient stone steles and gnarled pines, patterned mist, green ghost-fires; malachite and ochre with black.',
  2: 'Setting: a drowned underground royal city, patterned waves, sunken vermilion pillars; azurite and vermilion with black.',
  3: 'Setting: a celestial star palace library, patterned star clouds, fallen stars as lamps; night blue and ochre gold with black.',
  4: 'Setting: the black void at the heart of the Book of Fate, flowing golden ribbon-like light, suspended patterned dust; lamp black and gold.',
};

export function cardPrompt(subject: string, faction: Color, mood?: string) {
  return [subject.trim(), mood ?? '', FACTION_TONE[faction], CARD_COMPOSITION, STYLE_LOCK].filter(Boolean).join(' ');
}

export function cutoutPrompt(subject: string, tone: string, magenta = false) {
  return [subject.trim(), tone, magenta ? CUTOUT_MAGENTA : CUTOUT, STYLE_LOCK].join(' ');
}

export const ICON_STYLE =
  'A single round game-UI medallion icon made as a Chinese woodblock print: a thick carved black outline ring with a thin ochre-gold inner ring, ' +
  'a bold flat symbol in the center, flat mineral colors, rice-paper grain, slight misregistration, readable at small sizes, centered, ' +
  'isolated on a fully transparent background. No text, no letters, no numbers.';

export function iconPrompt(symbol: string, tint: string) {
  return `${ICON_STYLE} The symbol: ${symbol}. Symbol color: ${tint}; medallion background: dark lamp-black ink.`;
}

export const UI_STYLE =
  'Game UI element made as a Chinese woodblock print: bold carved black outlines, flat mineral colors (vermilion, malachite, azurite, ochre gold, paper beige), ' +
  'auspicious cloud and meander (huiwen) ornaments, rice-paper grain, slight misregistration, flat front view, no perspective, no shading gradients, ' +
  'isolated on a fully transparent background. No text, no letters, no numbers, no symbols in the empty areas.';
