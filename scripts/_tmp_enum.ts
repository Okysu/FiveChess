import { loadContent } from './load-content';
const c = loadContent();
const tally: Record<string, Record<string, number>> = {};
const rows: string[] = [];
function add(cat: string, owner: string, trigs: any[] | undefined) {
  for (const t of trigs ?? []) {
    const k = `${t.on}|who=${t.who ?? '-'}${t.status ? '|st=' + t.status : ''}${t.suit ? '|suit=' + t.suit : ''}${t.limit ? '|lim=' + t.limit : ''}`;
    (tally[cat] ??= {})[k] = ((tally[cat] ??= {})[k] ?? 0) + 1;
    rows.push(`${cat}\t${owner}\t${k}\t${JSON.stringify(t.effects).slice(0, 140)}${t.if ? ' IF ' + JSON.stringify(t.if) : ''}`);
  }
}
for (const d of c.cards.values()) {
  for (const up of [false, true]) {
    if (up && !d.upgrade) continue;
    const x = c.card(d.id, up); const tag = d.id + (up ? '+' : '');
    add('equip', tag, x.equip?.triggers); add('unit', tag, x.unit?.triggers); add('inHand', tag, x.inHand); add('field', tag, x.field?.triggers);
  }
}
for (const r of c.relics.values()) add('relic', r.id, r.triggers);
for (const cm of c.commanders.values()) for (const sk of cm.skills) { add('skill', cm.id + ':' + sk.id, sk.triggers); if (sk.awaken) { add('awaken', cm.id + ':' + sk.id, [{ ...sk.awaken, effects: sk.awaken.effects ?? [] }]); add('skill-awakened', cm.id + ':' + sk.id, (sk.awaken.becomes as any)?.triggers); } }
for (const l of c.lieutenants.values()) { const sk = l.skill; add('ltskill', l.id + ':' + sk.id, sk.triggers); if (sk.awaken) { add('awaken', l.id, [{ ...sk.awaken, effects: sk.awaken.effects ?? [] }]); add('skill-awakened', l.id, (sk.awaken.becomes as any)?.triggers); } }
for (const e of c.enemies.values()) add('enemy', e.id, e.passives);
console.log(JSON.stringify(tally, null, 1));
if (process.argv[2]) console.log(rows.filter(r => r.includes(process.argv[2]!)).join('\n'));
