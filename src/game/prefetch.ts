/**
 * Warm-up: after a screen has settled, fetch the art the player is likely to need next into the HTTP cache
 * (low priority, 2 at a time, only while the tab is idle-ish). Nothing is decoded, so no GPU memory is used;
 * the next scene's Assets.load then comes straight from cache.
 */
import { assets, K } from './assets';
import { session } from './state';
import { content } from '../engine/content';

const queue: string[] = [];
const seen = new Set<string>();
let active = 0;

function pump() {
  while (active < 2 && queue.length) {
    const url = queue.shift()!;
    active++;
    const done = () => { active--; schedule(); };
    fetch(url, { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).then(done, done);
  }
}
function schedule() {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(pump, { timeout: 1500 }); else setTimeout(pump, 200);
}

/** queue asset keys (texture keys, as used by assets.load) for background download */
export function prefetch(keys: string[]) {
  for (const k of keys) {
    const url = assets.urlOf(k);
    if (!url || seen.has(url) || assets.get(k)) continue;
    seen.add(url);
    queue.push(url);
  }
  schedule();
}

/** what the current screen is likely to lead to */
export function prefetchAfter(screen: string) {
  const r = session.run;
  const c = content();
  if (!r) {
    // title → commander select / continue
    prefetch([K.bg('recruit'), ...[...c.commanders.values()].map((x) => K.hero(x.id))]);
    return;
  }
  const act = Math.min(4, r.act);
  const deckCards = r.deck.map((d) => K.card(c.card(d.id).faction, d.id));
  const actEnemies = [...c.enemies.values()].filter((e) => e.act === r.act).map((e) => K.enemy(e.id, e.tier === 'boss'));
  if (screen === 'map' || screen === 'actStart' || screen === 'event' || screen === 'camp' || screen === 'shop') {
    prefetch([K.bg(`battle_${act}`), K.hero(r.commander), ...deckCards, ...actEnemies, K.bg('event'), K.bg('shop'), K.bg('camp'), K.bg('victory')]);
  } else if (screen === 'combat') {
    prefetch([K.bg('victory'), K.bg(`map_${act}`), ...[...c.relics.keys()].slice(0, 1).map((id) => K.relic(id)), ...[...c.potions.keys()].slice(0, 1).map((id) => K.potion(id))]);
  } else if (screen === 'reward' || screen === 'bossRelic') {
    prefetch([K.bg(`map_${act}`), K.bg(`map_${Math.min(4, r.act + 1)}`), K.bg(`battle_${Math.min(4, r.act + 1)}`)]);
  }
}
