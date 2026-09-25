/** Prompt building blocks from the art style bible (docs/美术风格圣经.md). */
import type { Color } from '../../src/engine/defs';

export const STYLE_LOCK =
  'Eastern fantasy illustration in a semi-realistic thick impasto painting style: visible confident brush strokes and palette-knife texture, ' +
  'rich harmonious colors, dramatic warm key light from the upper left with a cool rim light from behind, cool blue-violet shadows, ' +
  'subtle gold-leaf accents, cinematic depth, masterful commercial card-game illustration quality. ' +
  'Absolutely no text, no letters, no numbers, no calligraphy, no seals, no watermark, no signature, no border, no frame, no UI.';

export const CARD_COMPOSITION =
  'Full-bleed square composition, the main subject centered slightly above the middle, the lower third kept simple and uncluttered.';

export const CUTOUT =
  'Isolated single subject on a fully transparent background, the whole figure visible and not cropped, no ground shadow, no background scenery.';

export const CUTOUT_MAGENTA =
  'Isolated single subject on a perfectly flat solid pure magenta (#FF00FF) background, no gradient, no shadow, no scenery, the whole figure visible.';

export const FACTION_TONE: Record<Color, string> = {
  R: 'Palette of vermilion, crimson and ember orange with charcoal shadows; flames, heat haze and drifting sparks; red bronze and scorched wood.',
  B: 'Palette of deep indigo, slate blue and frost white; heavy stone, dark iron, ice crystals, cold mist and mountain silhouettes.',
  G: 'Palette of jade green, moss and warm amber light; living wood, vines, glowing spores and fireflies, polished jade.',
  Y: 'Palette of burnished gold, ivory and night-sky navy; stars, armillary spheres, bronze mirrors and floating paper talismans with glowing lines.',
  P: 'Palette of violet, plum and smoky black with poison-green accents; silk veils, masks, lanterns in shadow and curling smoke.',
  N: 'Palette of warm parchment tones, weathered wood and muted teal; soft even light.',
};

export const ACT_TONE: Record<number, string> = {
  1: 'Setting: a misty forest of broken ancient steles, pale greens, bone white and cold grey, old pines and will-o-wisps.',
  2: 'Setting: a drowned underground royal city, deep teal water light, rusted gold and rotting vermilion lacquer, shafts of light through water.',
  3: 'Setting: a celestial star palace library, midnight blue and silver, fallen stars used as lamps, floating bookshelves and armillary spheres.',
  4: 'Setting: the ink-black void at the heart of the Book of Fate, glowing golden light-trails like flowing script, suspended dust where time has stopped.',
};

export function cardPrompt(subject: string, faction: Color, mood?: string) {
  return [subject.trim(), mood ?? '', FACTION_TONE[faction], CARD_COMPOSITION, STYLE_LOCK].filter(Boolean).join(' ');
}

export function cutoutPrompt(subject: string, tone: string, magenta = false) {
  return [subject.trim(), tone, magenta ? CUTOUT_MAGENTA : CUTOUT, STYLE_LOCK].join(' ');
}

export const ICON_STYLE =
  'A single game UI emblem icon: a gilded gold outline around a bold simple silhouette symbol, on a small dark round lacquer disc, ' +
  'clean readable shape at small sizes, soft top-left highlight, painterly but crisp, centered, isolated on a fully transparent background. ' +
  'No text, no letters, no numbers.';

export function iconPrompt(symbol: string, tint: string) {
  return `${ICON_STYLE} The symbol: ${symbol}. Symbol color: ${tint}.`;
}
