/** Static (non-content) art jobs: backgrounds, icons, UI materials, effects. */
import { ACT_TONE, STYLE_LOCK, iconPrompt, FACTION_TONE, UI_STYLE } from './style';
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
  /** short subject line, used to pack small items into one sprite-sheet request (atlas.ts) */
  subject?: string;
  /** items only share a sprite sheet within the same group (faction / act) so the shared tone fits all */
  group?: string;
}

/** battle backdrops sit behind the whole board: no figures, quiet low-contrast middle */
const BATTLE_CALM = 'No people, no soldiers, no creatures, no figures of any kind. The central band is calm, sparse and low in contrast so game pieces placed on it stay readable; detail only at the far edges.';

const bg = (id: string, prompt: string, out = `backgrounds/${id}`): ArtJob => ({
  id, category: 'background', out, size: '1536x1024', transparent: false, prompt: `${prompt} ${STYLE_LOCK}`, ref: 'art-src/style_refs/wb_background.png', px: 1920, quality: 'high',
});

export const BACKGROUNDS: ArtJob[] = [
  bg('battle_1', `A wide battlefield in a misty forest of toppled ancient stone steles and gnarled pines at dusk, open flat mossy ground across the middle and lower half for units to stand on, the top third darker, faint green will-o-wisps. ${BATTLE_CALM} ${ACT_TONE[1]}`),
  bg('battle_2', `A wide battlefield on the flooded marble plaza of a sunken underground royal palace, ankle-deep still water reflecting broken vermilion pillars, shafts of teal light from above, open flat ground across the middle. ${BATTLE_CALM} ${ACT_TONE[2]}`),
  bg('battle_3', `A wide battlefield inside a vast celestial library hall, polished star-map floor, towering floating bookshelves and giant armillary spheres in the background, fallen stars glowing as lamps, open flat ground across the middle. ${BATTLE_CALM} ${ACT_TONE[3]}`),
  bg('battle_4', `A wide battlefield floating in an ink-black void at the binding of an enormous open book whose pages curve up on both sides like cliffs, golden light-trails drifting like flowing script, suspended dust, open flat ground in the middle. ${BATTLE_CALM} ${ACT_TONE[4]}`),
  bg('map_1', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash landscape of misty pine forest and broken steles painted faintly in grey and pale green, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_2', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash landscape of a sunken palace and flowing water painted faintly in teal and rust, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_3', 'An aged xuan-paper scroll texture seen from above, subtle ink-wash of constellations, clouds and palace roofs in faint gold and midnight blue, large calm empty areas for drawing a route map, warm paper fibers, vignette.'),
  bg('map_4', 'An aged dark scroll texture seen from above, faint golden light-trails flowing across black ink, large calm empty areas, vignette. No people, no deities, no figures, no creatures.'),
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
  subject: `round medallion, symbol: ${symbol} in ${tint}`,
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
  icon('kw_sunder', 'a cracked lamellar armor plate split by a heavy hammer blow', 'iron grey'),
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

const UIREF = 'art-src/style_refs/wb_ui.png';
const ui = (id: string, prompt: string, transparent: boolean, px: number, size: Size = '1024x1024', ref: string | undefined = UIREF): ArtJob => ({
  id, category: 'ui', out: `ui/${id}`, size, transparent, prompt: transparent ? `${prompt} ${UI_STYLE}` : `${prompt} ${STYLE_LOCK}`, px, quality: 'medium', ref,
});

/** plain surface textures: no illustration style lock (it makes the model paint motifs) */
const TEX_STYLE = 'Photographic scan of a real material surface, filling the entire frame edge to edge, evenly lit, top-down, completely uniform with no focal point. ' +
  'Absolutely no drawings, no figures, no animals, no plants, no clouds, no patterns, no motifs, no border, no text.';
const tex = (id: string, prompt: string, px: number): ArtJob => ({ id, category: 'ui', out: `ui/${id}`, size: '1024x1024', transparent: false, prompt: `${prompt} ${TEX_STYLE}`, px, quality: 'medium' });

const PAPER = 'The empty center is a completely flat plain paper-beige area with no pattern, no marks and no text.';
const FACTION_PIGMENT: Record<string, string> = { R: 'vermilion red', B: 'azurite blue', G: 'malachite green', Y: 'ochre gold', P: 'plum purple', N: 'paper beige and grey-green' };

export const UI_MATERIALS: ArtJob[] = [
  // 9-slice panels: ornament concentrated at the border, uniform border width
  ui('panel_light', `A wide rectangular dialog panel: an ornate border of even thickness (about one tenth of the height) made of meander pattern and small auspicious cloud corners, black outlines, ochre and vermilion accents. ${PAPER}`, true, 1024, '1536x1024'),
  ui('panel_dark', 'A wide rectangular dialog panel: an ornate border of even thickness (about one tenth of the height) with meander pattern and cloud corners in ochre gold and vermilion, black outlines. The empty center is completely flat plain dark indigo-black with no pattern and no text.', true, 1024, '1536x1024'),
  ui('button_red', 'A single horizontal oblong button plate with auspicious cloud scroll ends, flat vermilion red face, thick black outline, thin ochre-gold inner border. The face is completely empty.', true, 768, '1536x1024'),
  ui('button_green', 'A single horizontal oblong button plate with auspicious cloud scroll ends, flat malachite green face, thick black outline, thin ochre-gold inner border. The face is completely empty.', true, 768, '1536x1024'),
  ui('button_blue', 'A single horizontal oblong button plate with auspicious cloud scroll ends, flat azurite blue face, thick black outline, thin ochre-gold inner border. The face is completely empty.', true, 768, '1536x1024'),
  ui('button_grey', 'A single horizontal oblong button plate with auspicious cloud scroll ends, flat faded grey-brown face, thick black outline, dull inner border. The face is completely empty.', true, 768, '1536x1024'),
  ...(['R', 'B', 'G', 'Y', 'P', 'N'] as const).map((f) => ui(`card_frame_${f}`, `A vertical playing-card border frame only: a decorative border of even thickness in ${FACTION_PIGMENT[f]} with black carved outlines, small auspicious cloud ornaments at the four corners and a meander band. The whole inner area inside the border is fully transparent and empty.`, true, 600, '1024x1536')),
  ...(['R', 'B', 'G', 'Y', 'P', 'N'] as const).map((f) => ui(`ribbon_${f}`, `A single long horizontal name banner ribbon with folded cloud-scroll ends, flat ${FACTION_PIGMENT[f]} face, thick black outline, thin ochre-gold edge. The face is completely empty.`, true, 640, '1536x1024')),
  ui('cost_disc', 'A single round medallion coin: flat dark indigo face surrounded by a thick ochre-gold ring with a black outline and eight small cloud nubs. The face is completely empty.', true, 192),
  ui('stat_atk', 'A single small shield-shaped badge pointing downward like a blade, flat ochre-gold face with black outline. The face is completely empty.', true, 160),
  ui('stat_hp', 'A single small peach-shaped badge (longevity peach), flat vermilion red face with black outline and one green leaf. The face is completely empty.', true, 160),
  ui('slot', 'A single square battlefield tile: a carved stone plinth seen from the front, meander border, flat grey-green stone with black outlines, the center flat and empty.', true, 256),
  ui('altar', 'A single bronze tripod incense burner (ding) with a small flame and rising patterned smoke, front view.', true, 256),
  ui('seal_response', 'A single square vermilion cinnabar seal stamp impression with an abstract flame-and-open-palm emblem, no characters.', true, 128),
  ui('bar_frame', 'A single long thin horizontal gauge frame with cloud-scroll ends, black outline, ochre-gold rim; the inside channel is completely empty and transparent.', true, 640, '1536x1024'),
  ui('cloud_corner', 'A single auspicious cloud (xiangyun) corner ornament, ochre gold and vermilion with black outlines.', true, 192),
  ui('divider', 'A single long horizontal divider ornament: a meander band with a central lotus and cloud scrolls, ochre gold with black outlines.', true, 768, '1536x1024'),
  tex('tex_paper', 'Blank aged beige mulberry rice paper, visible long fibers, a few faint ink specks.', 1024),
  tex('tex_ink', 'Blank rice paper completely soaked with dark indigo-black ink, subtle fiber grain, slightly uneven ink density.', 1024),
  ui('card_back', 'The back design of a playing card as a woodblock print: dark azurite blue field, a symmetric arrangement of the eight trigrams (bagua) in ochre gold around a central vermilion taiji disc, auspicious cloud corners, meander border, full bleed.', false, 600, '1024x1536'),
  ui('fate_back', 'The back of an ancient fortune card as a woodblock print: vermilion field with a symmetric ochre-gold pattern of a sun, a lightning bolt, a crescent moon and a mountain around a taiji circle, meander border, full bleed.', false, 400, '1024x1536'),
  ui('fate_face', 'A blank fortune card face as a woodblock print: plain paper-beige center with a thin black and ochre meander border, small cloud corners, nothing in the center, full bleed.', false, 400, '1024x1536'),
  ui('shopkeeper', 'Half-body portrait of a friendly masked wandering merchant in layered patterned robes, holding an abacus and a paper lantern, bowing slightly.', true, 900, '1024x1536', 'art-src/style_refs/wb_commander.png'),
  // ── every remaining UI element is a generated texture (no procedural UI) ──
  ui('panel_row', 'A long thin horizontal list-row plate: a narrow ornate meander border with tiny cloud corners in ochre gold and vermilion, black outlines; the long center is completely flat plain dark indigo-black with no pattern and no text.', true, 1024, '1536x1024'),
  ui('panel_tile', 'A small square tile frame: an ornate square border with cloud corners in ochre gold, malachite and vermilion, black outlines; the center is completely flat plain dark indigo-black with no pattern.', true, 384),
  ui('topbar', 'A very wide and short horizontal header band: flat dark indigo-black field, along its bottom edge a meander border in ochre gold with a thin vermilion rule, small cloud ornaments at both ends, black outlines. The field is completely empty.', true, 1024, '1536x1024'),
  ui('banner_band', 'A very long horizontal hanging scroll band with rolled wooden scroll ends at left and right, flat dark indigo-black face, ochre-gold meander trim along top and bottom edges. The face is completely empty.', true, 1024, '1536x1024'),
  ui('bar_fill_red', 'A single long thin horizontal gauge fill strip with rounded ends: flat vermilion red with a fine carved wave pattern, thin black outline, nothing else.', true, 640, '1536x1024'),
  ui('bar_fill_blue', 'A single long thin horizontal gauge fill strip with rounded ends: flat azurite blue with a fine carved wave pattern, thin black outline, nothing else.', true, 640, '1536x1024'),
  ui('bar_fill_gold', 'A single long thin horizontal gauge fill strip with rounded ends: flat ochre gold with a fine carved cloud pattern, thin black outline, nothing else.', true, 640, '1536x1024'),
  ui('gem_common', 'A single small round faceted gem as a woodblock print: flat bronze-brown color, black carved outline, one small paper-white fleck.', true, 96),
  ui('gem_rare', 'A single small round faceted gem as a woodblock print: flat malachite teal-green color, black carved outline, one small paper-white fleck.', true, 96),
  ui('gem_epic', 'A single small round faceted gem as a woodblock print: flat plum purple color, black carved outline, one small paper-white fleck.', true, 96),
  ui('gem_legendary', 'A single small round faceted gem as a woodblock print: flat vermilion and ochre-gold flame-patterned gem, black carved outline, one small paper-white fleck.', true, 96),
  ui('pip_R', 'A single small round resource token: flat vermilion red disc with a stylized flame symbol, black carved outline.', true, 96),
  ui('pip_B', 'A single small square resource token: flat azurite blue square seal with a stylized mountain symbol, black carved outline.', true, 96),
  ui('pip_G', 'A single small leaf-shaped resource token: flat malachite green leaf with carved veins, black carved outline.', true, 96),
  ui('pip_Y', 'A single small star-shaped resource token: flat ochre gold five-pointed star, black carved outline.', true, 96),
  ui('pip_P', 'A single small crescent-shaped resource token: flat plum purple crescent moon, black carved outline.', true, 96),
  ui('pip_N', 'A single small round resource token: flat paper-beige ring with a hole in the middle like an ancient coin, black carved outline.', true, 96),
  ui('suit_sun', 'A single fate-suit emblem: a flat ochre-orange sun disc with eight short rays, black carved outline.', true, 128),
  ui('suit_thunder', 'A single fate-suit emblem: a flat violet zigzag lightning bolt, black carved outline.', true, 128),
  ui('suit_moon', 'A single fate-suit emblem: a flat pale ice-blue crescent moon, black carved outline.', true, 128),
  ui('suit_mountain', 'A single fate-suit emblem: a flat malachite green triple mountain peak, black carved outline.', true, 128),
  ui('stat_dur', 'A single small hexagonal iron plate badge, flat grey-blue face with black outline. The face is completely empty.', true, 160),
  ui('stat_turns', 'A single small hourglass-shaped badge, flat ochre face with black outline. The face is completely empty.', true, 160),
  ui('rules_box', 'A wide rectangular paper text panel: thin black carved border with small ochre cloud corners, the center completely flat plain paper-beige with no pattern and no text.', true, 768, '1536x1024'),
  ui('art_placeholder', 'A decorative square panel of muted auspicious cloud pattern in faded ochre and grey-green, completely abstract, no figures.', false, 512, '1024x1024', undefined),
  ui('frame_gold', 'A rectangular selection frame only: a thick ochre-gold carved border with small cloud nubs at the four corners and a thin black outline. Everything inside the border is fully transparent and empty.', true, 512, '1024x1536'),
  ui('frame_red', 'A rectangular selection frame only: a thick vermilion red carved border with small cloud nubs at the four corners and a thin black outline. Everything inside the border is fully transparent and empty.', true, 512, '1024x1536'),
  ui('frame_blue', 'A rectangular selection frame only: a thick azurite blue carved border with small cloud nubs at the four corners and a thin black outline. Everything inside the border is fully transparent and empty.', true, 512, '1024x1536'),
  ui('ring_gold', 'A single circular ring only: a thick ochre-gold carved ring with small cloud nubs and a thin black outline. The inside of the ring is fully transparent and empty.', true, 256),
  ui('ring_red', 'A single circular ring only: a thick vermilion red carved ring with small cloud nubs and a thin black outline. The inside of the ring is fully transparent and empty.', true, 256),
  ui('token_frame', 'A vertical arched frame only (rounded arch at the top, flat bottom) for a character portrait: carved border in ochre gold and black with small cloud ornaments at the base corners. Everything inside the frame is fully transparent and empty.', true, 384, '1024x1536'),
  ui('tag_red', 'A single small horizontal label plate with notched ends, flat vermilion red face, thick black outline. The face is completely empty.', true, 256, '1536x1024'),
  ui('tag_gold', 'A single small horizontal label plate with notched ends, flat ochre gold face, thick black outline. The face is completely empty.', true, 256, '1536x1024'),
  ui('skill_disc', 'A single round medallion frame: thick ochre-gold ring with cloud nubs and black outline around a flat dark indigo face. The face is completely empty.', true, 192),
  ui('skill_disc_active', 'A single round medallion frame: thick vermilion ring with cloud nubs and black outline around a flat dark indigo face. The face is completely empty.', true, 192),
  ui('equip_slot', 'A single small square slot frame: carved meander border in muted ochre and black, the center completely flat plain dark indigo-black.', true, 160),
  ui('ward_bubble', 'A single protective shield of overlapping golden paper talisman charms arranged in an arch-shaped dome, flat ochre and paper colors with black outlines, the center open and transparent.', true, 384, '1024x1536'),
  ui('frost_overlay', 'A single crust of carved ice crystals and frost patterns arranged in a rectangle frame, flat pale blue and white with black outlines, the center open and transparent.', true, 384, '1024x1536'),
  ui('smoke_overlay', 'A single swirling patterned ink smoke cloud, flat grey and indigo with black outlines, loosely filling a vertical oval.', true, 384, '1024x1536'),
  ui('arrow_chevron', 'A single chevron arrow segment pointing right, flat vermilion with a black carved outline and an ochre inner line.', true, 96),
  ui('arrow_head', 'A single arrow head pointing right, flat vermilion with a black carved outline and an ochre inner line, sharp and bold.', true, 128),
  ui('path_dot', 'A single small plain round stepping-stone disc, flat ochre-gold face, thick black carved outline, one thin inner ring, nothing else, no objects.', true, 64),
  ui('path_dot_red', 'A single small round dot as a woodblock print, flat vermilion red with black outline.', true, 48),
  ui('stamp_visited', 'A single round vermilion cinnabar seal-stamp ring impression with a blank center, slightly uneven like a real stamp, no characters.', true, 192),
  ui('toggle_on', 'A single horizontal pill-shaped toggle switch in the ON state: flat malachite green track with an ochre-gold round knob on the right side, black carved outlines.', true, 192, '1536x1024'),
  ui('toggle_off', 'A single horizontal pill-shaped toggle switch in the OFF state: flat dark grey-brown track with a pale round knob on the left side, black carved outlines.', true, 192, '1536x1024'),
  ui('slider_track', 'A single long thin horizontal slider track with rounded ends, flat dark indigo channel with an ochre-gold rim and black outline. Empty.', true, 640, '1536x1024'),
  ui('slider_knob', 'A single round slider knob: ochre-gold coin with a carved cloud ring and black outline.', true, 96),
  ui('menu_panel', 'A tall vertical hanging scroll panel: dark indigo-black flat center, ornate ochre-gold and vermilion meander border, wooden scroll rods at top and bottom. The center is completely empty.', true, 768, '1024x1536'),
  tex('dim_vignette', 'Blank near-black ink-soaked paper, very dark and even, faint fiber grain only.', 512),
];

const fx = (id: string, prompt: string): ArtJob => ({
  id, category: 'effect', out: `effects/${id}`, size: '1024x1024', transparent: true, prompt: `${prompt} Made as a flat Chinese woodblock-print element: bold black outline, flat mineral colors, no gradients. Isolated on a fully transparent background, no text.`, px: 256, quality: 'medium',
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
