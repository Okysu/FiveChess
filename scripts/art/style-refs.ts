/** Generates the 5 style reference samples (docs/美术风格圣经.md §7). */
import fs from 'node:fs';
import { generate } from './api';
import { cardPrompt, cutoutPrompt, FACTION_TONE, ACT_TONE, STYLE_LOCK } from './style';

const OUT = 'art-src/style_refs';
const jobs = [
  { id: 'ref_commander', size: '1024x1536' as const, transparent: true,
    prompt: cutoutPrompt('Half-body portrait of a battle-hardened general in red-bronze lamellar armor with a flowing crimson cloak, holding a broad saber whose edge glows like embers, stern determined gaze toward the viewer\'s left.', FACTION_TONE.R) },
  { id: 'ref_unit', size: '1024x1024' as const, transparent: false,
    prompt: cardPrompt('A towering guardian spirit made of living wood and jade, moss draped over its shoulders, kneeling to shield a small glowing sapling with its hands, fireflies around.', 'G') },
  { id: 'ref_spell', size: '1024x1024' as const, transparent: false,
    prompt: cardPrompt('An astrologer\'s hand releasing a spinning armillary sphere of golden light above an open ancient star chart, constellations igniting in the air.', 'Y') },
  { id: 'ref_enemy', size: '1024x1024' as const, transparent: true,
    prompt: cutoutPrompt('A gaunt skeletal spearman wrapped in tattered funeral cloth and rusted bronze armor, faint green ghost-fire in its eye sockets, full body standing in a lunging stance.', ACT_TONE[1]!) },
  { id: 'ref_scene', size: '1536x1024' as const, transparent: false,
    prompt: `A wide battlefield landscape in a misty forest of toppled ancient stone steles and gnarled pines, pale moonlight and green will-o-wisps, a clear open flat ground in the middle for combat, depth and atmosphere. ${ACT_TONE[1]!} ${STYLE_LOCK}` },
];

await Promise.all(jobs.map(async (j) => {
  const t = Date.now();
  try {
    const buf = await generate({ prompt: j.prompt, size: j.size, quality: 'high', transparent: j.transparent });
    fs.writeFileSync(`${OUT}/${j.id}.png`, buf);
    fs.writeFileSync(`${OUT}/${j.id}.prompt.txt`, j.prompt);
    console.log('ok', j.id, (Date.now() - t) / 1000 + 's');
  } catch (e) { console.log('FAIL', j.id, (e as Error).message); }
}));
