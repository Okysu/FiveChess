/** Static (non-content) art jobs: backgrounds, icons, UI materials, effects. */
import { ACT_TONE, STYLE_LOCK, iconPrompt, FACTION_TONE } from './style';
import type { Size } from './api';

export interface ArtJob {
  id: string;
  category: 'card' | 'hero' | 'enemy' | 'boss' | 'relic' | 'potion' | 'event' | 'background' | 'icon' | 'ui' | 'effect' | 'fate';
  out: string; // path under assets/ without extension
  size: Size;
  transparent: boolean;
  prompt: string;
  ref?: string;
  /** output long-edge size in px */
  px: number;
  quality?: 'low' | 'medium' | 'high';
  magentaSubject?: boolean;
}

const bg = (id: string, prompt: string, out = `backgrounds/${id}`): ArtJob => ({
  id, category: 'background', out, size: '1536x1024', transparent: false, prompt: `${prompt} ${STYLE_LOCK}`, ref: 'assets/_style_refs/ref_scene.png', px: 1920, quality: 'high',
});

export const BACKGROUNDS: ArtJob[] = [
  bg('battle_1', `A wide battlefield in a misty forest of toppled ancient stone steles and gnarled pines at dusk, open flat mossy ground across the middle and lower half for units to stand on, the top third darker, faint green will-o-wisps. ${ACT_TONE[1]}`),
  bg('battle_2', `A wide battlefield on the flooded marble plaza of a sunken underground royal palace, ankle-deep still water reflecting broken vermilion pillars, shafts of teal light from above, open flat ground across the middle. ${ACT_TONE[2]}`),
  bg('battle_3', `A wide battlefield inside a vast celestial library hall, polished star-map floor, towering floating bookshelves and giant armillary spheres in the background, fallen stars glowing as lamps, open flat ground across the middle. ${ACT_TONE[3]}`),
  bg('battle_4', `A wide battlefield floating in an ink-black void at the binding of an enormous open book whose pages curve up on both sides like cliffs, golden light-trails drifting like flowing script, suspended dust, open flat ground in the middle. ${ACT_TONE[4]}`),
  bg('map_1', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash landscape of misty pine forest and broken steles painted faintly in grey and pale green, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_2', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash landscape of a sunken palace and flowing water painted faintly in teal and rust, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_3', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash of constellations, clouds and palace roofs in faint gold and midnight blue, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_4', 'An aged dark scroll texture seen from above, faint golden light-trails flowing across black ink, large calm empty areas, vignette.'),
  bg('title', 'Epic key art: a lone commander in a crimson cloak standing at the edge of a colossal inverted tower that grows downward into the earth, its levels glowing with golden script-like light, enormous torn pages of a book drifting in the night sky like clouds, moonlight, sense of fate and destiny, space in the upper middle for a title.'),
  bg('camp', 'A quiet campfire in a ruined mountain shrine at night, warm firelight on stone, a sword planted in the ground, sparks rising into a starry sky, calm and safe mood, open lower half.'),
  bg('shop', 'The interior of a mysterious wandering merchant\'s lantern-lit caravan shop hidden underground, shelves of curious relics, talismans, bottled pills and scrolls, warm amber light, cozy clutter, open center.'),
  bg('recruit', 'A grand pavilion hall with vermilion pillars and hanging banners of five colors, morning light streaming through lattice windows, an empty dais waiting for heroes, dignified mood.'),
  bg('stargaze', 'An ancient open-air observatory terrace at night, a giant bronze armillary sphere, a star chart carved in the floor, the Milky Way overhead, drifting golden talisman papers.'),
  bg('event', 'A misty forked road beside a weathered roadside shrine with a stone lantern, crows on a bare tree, mysterious mood.'),
  bg('codex', 'A scholar\'s study with endless bookshelves, scrolls and illustrated card albums laid on a lacquered desk, candlelight, calm.'),
  bg('defeat', 'A fallen sword and a torn crimson cloak lying on grey stone steps under falling ash, somber and quiet, cold light.'),
  bg('victory', 'Sunrise breaking over mountains beyond a colossal closed book of fate floating in the sky, golden light, clouds parting, triumphant mood.'),
];

const icon = (id: string, symbol: string, tint: string, out = `ui/icons/${id}`): ArtJob => ({
  id, category: 'icon', out, size: '1024x1024', transparent: true, prompt: iconPrompt(symbol, tint), px: 192, quality: 'medium',
});

export const ICONS: ArtJob[] = [
  // keywords
  icon('kw_taunt', 'a heavy stone tower shield', 'slate grey-blue'),
  icon('kw_ranged', 'a drawn longbow with an arrow', 'olive green'),
  icon('kw_leap', 'a leaping swallow in flight', 'lavender'),
  icon('kw_haste', 'a galloping horse hoof with speed streaks', 'amber'),
  icon('kw_twin', 'two crossed curved sabers', 'coral red'),
  icon('kw_ward', 'a glowing paper talisman barrier dome', 'pale gold'),
  icon('kw_lifesteal', 'a blood drop inside a crescent fang', 'crimson'),
  icon('kw_deathtouch', 'a skull-shaped jade pendant with a severed thread', 'poison green'),
  icon('kw_thorns', 'a thorny bramble vine', 'moss green'),
  icon('kw_battlecry', 'a war drum with a drumstick striking it', 'orange'),
  icon('kw_deathrattle', 'a floating soul flame leaving a lotus', 'violet'),
  icon('kw_growth', 'a sprouting seedling with two leaves', 'bright green'),
  icon('kw_aura', 'a radiant banner flag emitting rings', 'gold'),
  icon('kw_stealth', 'a closed eye within curling smoke', 'dusk blue'),
  icon('kw_response', 'a raised open palm with a ripple', 'vermilion'),
  icon('kw_judge', 'a single tarot-like fate card flipping', 'gold'),
  icon('kw_delay', 'an hourglass with a paper charm', 'tan gold'),
  icon('kw_omen', 'a knotted red thread tying a star', 'warm yellow'),
  icon('kw_exhaust', 'a card burning into ash', 'ember brown'),
  icon('kw_innate', 'a jade seal with a mountain inside', 'sky blue'),
  icon('kw_retain', 'a sheathed sword', 'steel blue'),
  icon('kw_ethereal', 'a translucent wisp of mist', 'icy white'),
  icon('kw_combo', 'three linked chain rings', 'orchid purple'),
  icon('kw_offering', 'a hand placing a card into a flame', 'flame orange'),
  icon('kw_resonance', 'two tuning forks vibrating', 'aquamarine'),
  // statuses
  icon('st_burn', 'a flame', 'orange red'),
  icon('st_poison', 'a dripping venom drop with bubbles', 'toxic green'),
  icon('st_freeze', 'a six-pointed ice crystal', 'ice blue'),
  icon('st_stun', 'three spinning stars circling', 'yellow'),
  icon('st_vulnerable', 'a cracked shield', 'rose red'),
  icon('st_weak', 'a broken sword blade drooping', 'dull purple'),
  icon('st_silence', 'a sealed paper talisman over a mouth', 'grey'),
  icon('st_might', 'a clenched fist with flame', 'scarlet'),
  icon('st_tenacity', 'a mountain peak shield', 'steel blue'),
  icon('st_regen', 'a leaf with a healing droplet', 'spring green'),
  // intents
  icon('in_attack1', 'a small dagger', 'vermilion red'),
  icon('in_attack2', 'a broad saber', 'vermilion red'),
  icon('in_attack3', 'a straight jian sword', 'vermilion red'),
  icon('in_attack4', 'a halberd ji', 'vermilion red'),
  icon('in_attack5', 'a huge long-handled glaive', 'vermilion red'),
  icon('in_defend', 'a round bronze shield', 'indigo blue'),
  icon('in_buff', 'an upward arrow wreathed in golden flame', 'gold'),
  icon('in_debuff', 'a downward arrow wrapped in purple mist', 'purple'),
  icon('in_summon', 'a glowing summoning circle rune', 'jade green'),
  icon('in_judge', 'a fate card with a star', 'gold'),
  icon('in_cast', 'a fan of three cards held in a hand', 'ivory'),
  icon('in_unknown', 'a question-mark-shaped curl of smoke', 'grey'),
  icon('in_escape', 'footprints running away', 'grey'),
  icon('in_sleep', 'a crescent moon with z-shaped clouds', 'pale blue'),
  icon('in_heal', 'a lotus with a healing glow', 'soft green'),
  // map nodes
  icon('node_combat', 'two crossed swords', 'black ink'),
  icon('node_elite', 'a horned demon mask', 'dark crimson'),
  icon('node_event', 'a question-mark-shaped scroll', 'black ink'),
  icon('node_shop', 'a square-holed ancient coin', 'bronze'),
  icon('node_camp', 'a campfire', 'orange'),
  icon('node_chest', 'an ornate treasure chest', 'gold'),
  icon('node_recruit', 'a banner flag with a helmet', 'teal'),
  icon('node_stargaze', 'an armillary sphere', 'gold'),
  icon('node_boss', 'a fierce dragon-headed demon face', 'crimson'),
  // misc ui
  icon('ui_gold', 'a stack of gold coins', 'gold'),
  icon('ui_hp', 'a red heart-shaped lotus', 'red'),
  icon('ui_armor', 'a hexagonal shield', 'steel blue'),
  icon('ui_ember', 'a small ember flame', 'orange'),
  icon('ui_sign', 'a bamboo fortune stick', 'gold'),
  icon('ui_deck', 'a stack of cards', 'ivory'),
  icon('ui_discard', 'cards scattered falling', 'grey'),
  icon('ui_map', 'a rolled scroll map', 'tan'),
  icon('ui_settings', 'a bronze gear wheel', 'bronze'),
  icon('ui_codex', 'a thick bound book', 'dark red'),
  icon('ui_log', 'a writing brush', 'black'),
  icon('ui_potion', 'a gourd bottle', 'green'),
  icon('ui_relic', 'a jade bi disc', 'jade'),
  icon('ui_attack', 'a single sword', 'white'),
  icon('ui_weapon', 'a curved dao saber', 'silver'),
  icon('ui_armorslot', 'a lamellar armor chest piece', 'silver'),
  icon('ui_mount', 'a horse head', 'silver'),
  icon('ui_treasure', 'a ruyi scepter', 'silver'),
  icon('ui_field', 'a flag planted on ground', 'silver'),
];

const ui = (id: string, prompt: string, transparent: boolean, px: number, size: Size = '1024x1024'): ArtJob => ({
  id, category: 'ui', out: `ui/${id}`, size, transparent, prompt: `${prompt} No text, no letters.`, px, quality: 'medium',
});

export const UI_MATERIALS: ArtJob[] = [
  ui('tex_paper', 'A seamless flat texture of aged cream xuan rice paper with subtle fibers and faint ink stains, evenly lit, top-down, no objects.', false, 1024),
  ui('tex_lacquer', 'A seamless flat texture of dark red-black lacquered wood with subtle grain and gentle sheen, evenly lit, top-down, no objects.', false, 1024),
  ui('tex_bronze', 'A seamless flat texture of aged dark bronze with engraved faint cloud patterns and patina, evenly lit, top-down.', false, 1024),
  ui('tex_jade', 'A seamless flat texture of polished green jade stone with soft veins, evenly lit, top-down.', false, 1024),
  ui('tex_ink', 'A seamless flat texture of dark indigo-black silk brocade with very faint cloud pattern, evenly lit, top-down.', false, 1024),
  ui('ornament_corner', 'An ornate gilded gold filigree corner ornament in Chinese cloud-scroll (xiangyun) style, for a UI frame corner, isolated on a transparent background.', true, 256),
  ui('ornament_divider', 'A long horizontal gilded gold divider ornament with a central jade bead and cloud scrolls, isolated on a transparent background.', true, 512, '1536x1024'),
  ui('card_back', 'The back design of a fantasy playing card: deep indigo lacquer with an intricate gold circular mandala of stars, clouds and a central eye-like fate seal, symmetric, full bleed.', false, 600, '1024x1536'),
  ui('fate_back', 'The back of an ancient fortune card: cinnabar red lacquer with a gold symmetric pattern of four suit symbols around a taiji circle, symmetric, full bleed.', false, 400, '1024x1536'),
  ui('fate_face', 'A blank ancient ivory card face with a thin gold inner border and subtle paper texture and faint cloud watermark, symmetric, full bleed, nothing in the center.', false, 400, '1024x1536'),
  ui('shopkeeper', `A mysterious masked merchant in layered robes with many pockets, holding an abacus and a lantern, friendly bow, half body. Isolated on a transparent background. ${STYLE_LOCK}`, true, 900, '1024x1536'),
  ui('seal_response', 'A single square vermilion cinnabar seal stamp impression with an abstract flame-and-hand emblem (no characters), isolated on a transparent background.', true, 128),
  ui('button_base', 'A horizontal oblong game UI button plate made of dark lacquered wood with a thin gold rim and small cloud ornaments at both ends, front view, isolated on a transparent background.', true, 512, '1536x1024'),
];

const fx = (id: string, prompt: string): ArtJob => ({
  id, category: 'effect', out: `effects/${id}`, size: '1024x1024', transparent: true, prompt: `${prompt} Isolated on a fully transparent background, no text.`, px: 256, quality: 'medium',
});

export const EFFECTS: ArtJob[] = [
  fx('ink_splash', 'A single black ink splash blot with dynamic droplets, sumi-e brush style.'),
  fx('ember', 'A single soft glowing orange ember particle with a tiny bright core.'),
  fx('spark', 'A single four-pointed bright white-gold sparkle star.'),
  fx('smoke', 'A single soft grey wisp of smoke puff.'),
  fx('slash', 'A single curved bright white sword slash arc streak with motion blur.'),
  fx('frost', 'A single cluster of sharp ice shards.'),
  fx('leaf', 'A single green leaf drifting.'),
  fx('petal', 'A single pink plum blossom petal.'),
  fx('glow', 'A single soft round radial glow, white center fading out.'),
  fx('ring', 'A single thin glowing golden circular shockwave ring.'),
  fx('flame', 'A single stylized tongue of fire flame.'),
  fx('rune', 'A single glowing golden magic circle with abstract geometric star patterns (no characters).'),
];

export const FACTION_EMBLEMS: ArtJob[] = (['R', 'B', 'G', 'Y', 'P', 'N'] as const).map((f) => ({
  id: `emblem_${f}`, category: 'icon' as const, out: `frames/emblem_${f}`, size: '1024x1024' as const, transparent: true, px: 256, quality: 'medium' as const,
  prompt: iconPrompt({ R: 'a sun-crow bird wreathed in flame', B: 'a mountain above ice waves', G: 'a great tree with spreading roots', Y: 'an armillary sphere with a star', P: 'a masked face behind a silk veil with dice', N: 'a plain jade bi disc' }[f], { R: 'vermilion', B: 'indigo', G: 'jade green', Y: 'gold', P: 'violet', N: 'ivory' }[f]) + ` ${FACTION_TONE[f]}`,
}));
