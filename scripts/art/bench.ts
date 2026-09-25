/** Model benchmark: same card + icon prompt per model; prints latency, writes PNGs to art-src/style_lab/bench/. */
import fs from 'node:fs';
import { generate } from './api';
import { cardPrompt, iconPrompt } from './style';

const models = process.argv.slice(2);
const out = 'art-src/style_lab/bench';
fs.mkdirSync(out, { recursive: true });
const card = cardPrompt('a crimson-robed martial artist crossing forearms as a translucent shell of orange flame wraps around the body, embers swirling', 'R');
const icon = iconPrompt('a round bronze shield with a cloud boss', 'gold');

await Promise.all(models.flatMap((m) => [
  (async () => {
    const t = Date.now();
    try {
      const b = await generate({ model: m, prompt: card, size: '1024x1536', quality: 'medium', ref: 'art-src/style_refs/wb_card.png' });
      fs.writeFileSync(`${out}/${m}_card.png`, b);
      console.log(m, 'card', ((Date.now() - t) / 1000).toFixed(1), 's');
    } catch (e) { console.log(m, 'card FAIL', ((Date.now() - t) / 1000).toFixed(1), 's', (e as Error).message.slice(0, 160)); }
  })(),
  (async () => {
    const t = Date.now();
    try {
      const b = await generate({ model: m, prompt: icon, size: '1024x1024', quality: 'medium', transparent: true, ref: 'art-src/style_refs/ref_icon.png' });
      fs.writeFileSync(`${out}/${m}_icon.png`, b);
      console.log(m, 'icon', ((Date.now() - t) / 1000).toFixed(1), 's');
    } catch (e) { console.log(m, 'icon FAIL', ((Date.now() - t) / 1000).toFixed(1), 's', (e as Error).message.slice(0, 160)); }
  })(),
]));
