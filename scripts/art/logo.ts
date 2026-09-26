/** Logo candidates: title logo (with the characters 命阙) and an app icon emblem. Output: art-src/logo/*.png */
import fs from 'node:fs';
import { generate } from './api';

const OUT = 'art-src/logo';
fs.mkdirSync(OUT, { recursive: true });
const REF = 'art-src/style_refs/wb_ui.png';
const WOOD = 'Chinese woodblock New Year print (nianhua) style: bold carved black outlines, flat mineral colors (vermilion, malachite green, azurite blue, ochre gold, paper white), rice-paper grain, slight print misregistration, auspicious clouds, no gradients, no glow, no 3D.';

const jobs: { name: string; size: '1536x1024' | '1024x1024'; prompt: string }[] = [
  { name: 'title_a', size: '1536x1024', prompt: `A game title logo reading exactly the two Chinese characters "命阙" (ming que), large bold brush-calligraphy characters carved as a woodblock, ochre-gold characters with thick black outline and a vermilion offset shadow, framed by a horizontal cartouche of auspicious clouds and a half-open ancient book, a small red square seal to the lower right. ${WOOD} Isolated on a fully transparent background. Only these two characters, no other text, no latin letters.` },
  { name: 'title_b', size: '1536x1024', prompt: `A game title logo: the two Chinese characters "命阙" written vertically-balanced side by side in heavy seal-carving style inside an ornate gate-tower (que 阙) silhouette made of red lacquer pillars and a tiled roof, fate cards fanning behind it, stars above. ${WOOD} Isolated on a fully transparent background. Only the two characters 命阙, no other text.` },
  { name: 'title_c', size: '1536x1024', prompt: `A game title logo reading "命阙" in bold running-script calligraphy, black ink characters with gold inlay edges on a torn vermilion paper banner, flanked by two small fate cards (sun and moon) and swirling auspicious clouds. ${WOOD} Isolated on a fully transparent background. Exactly two Chinese characters 命阙, nothing else written.` },
  { name: 'icon_a', size: '1024x1024', prompt: `An app icon emblem, square with rounded corners: a stylized ancient gate tower (que) standing on an open book whose pages turn into clouds, a single glowing-free golden brush crossing it, deep azurite night background with a few stars, bold carved outline border. ${WOOD} No text, no letters.` },
  { name: 'icon_b', size: '1024x1024', prompt: `An app icon emblem, square with rounded corners: a round bronze fate medallion with the four fate symbols (sun, thunder, moon, mountain) around a central red taiji eye, on a vermilion background with gold cloud corners, bold carved outline border. ${WOOD} No text, no letters.` },
  { name: 'icon_c', size: '1024x1024', prompt: `An app icon emblem, square with rounded corners: a fanned hand of three playing cards with Chinese woodblock art (a general, a flame, a mountain) in front of a red gate tower silhouette, ochre-gold sky, bold carved outline border. ${WOOD} No text, no letters.` },
];

await Promise.all(jobs.map(async (j) => {
  const t = Date.now();
  try {
    const buf = await generate({ prompt: j.prompt, size: j.size, quality: 'high', transparent: j.name.startsWith('title'), ref: REF });
    fs.writeFileSync(`${OUT}/${j.name}.png`, buf);
    console.log('ok', j.name, ((Date.now() - t) / 1000).toFixed(0) + 's');
  } catch (e) { console.log('FAIL', j.name, (e as Error).message.slice(0, 160)); }
}));
