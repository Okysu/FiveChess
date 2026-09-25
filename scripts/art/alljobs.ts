/** Every art job: content-derived (cards, heroes, enemies, relics, potions, events) + static lists. */
import fs from 'node:fs';
import { loadContent } from '../load-content';
import { ACT_TONE, cardPrompt, cutoutPrompt, FACTION_TONE, STYLE_LOCK, flatSubject, OBJECT_FORM } from './style';
import { BACKGROUNDS, EFFECTS, ICONS, UI_MATERIALS, FACTION_EMBLEMS, type ArtJob } from './jobs';

const REF = (n: string) => `art-src/style_refs/${n}.png`;

export function buildJobs(): ArtJob[] {
  const c = loadContent();
  const jobs: ArtJob[] = [];

  for (const card of c.cards.values()) {
    const isUnit = card.type === 'unit';
    const faction = card.faction;
    jobs.push({
      id: card.id, category: 'card', out: `cards/${faction}/${card.id}`, size: '1024x1024', transparent: false,
      prompt: cardPrompt(card.art.subject, faction, card.art.mood), ref: REF('wb_card'), px: 640,
    });
  }
  for (const cm of c.commanders.values()) {
    jobs.push({ id: cm.id, category: 'hero', out: `heroes/${cm.id}`, size: '1024x1536', transparent: true,
      prompt: cutoutPrompt(`Full-body heroic portrait: ${cm.art.subject}`, FACTION_TONE[cm.faction]), ref: REF('wb_commander'), px: 1100, quality: 'high' });
  }
  for (const lt of c.lieutenants.values()) {
    jobs.push({ id: lt.id, category: 'hero', out: `heroes/${lt.id}`, size: '1024x1536', transparent: true,
      prompt: cutoutPrompt(`Full-body portrait: ${lt.art.subject}`, FACTION_TONE[lt.faction]), ref: REF('wb_commander'), px: 900 });
  }
  for (const e of c.enemies.values()) {
    const act = Math.min(4, Math.max(1, e.act));
    const boss = e.tier === 'boss';
    jobs.push({ id: e.id, category: boss ? 'boss' : 'enemy', out: `${boss ? 'bosses' : 'enemies'}/${e.id}`, size: boss ? '1024x1536' : '1024x1024', transparent: true,
      prompt: cutoutPrompt(`Full body: ${e.art.subject}`, ACT_TONE[act]!), ref: REF('wb_enemy'), px: boss ? 1100 : 640, quality: boss ? 'high' : 'medium' });
    (e.phases ?? []).forEach((ph, i) => {
      if (!ph.art) return;
      jobs.push({ id: `${e.id}_p${i + 2}`, category: 'boss', out: `bosses/${e.id}_p${i + 2}`, size: '1024x1536', transparent: true,
        prompt: cutoutPrompt(`Full body: ${ph.art.subject}`, ACT_TONE[act]!), ref: REF('wb_enemy'), px: 1100, quality: 'high' });
    });
  }
  const OBJECT = 'A single magical artifact object, centered, whole object visible, isolated on a fully transparent background, no hands, no scenery.';
  for (const r of c.relics.values()) {
    jobs.push({ id: r.id, category: 'relic', out: `ui/relics/${r.id}`, size: '1024x1024', transparent: true,
      prompt: `${flatSubject(r.art.subject)}. ${OBJECT} ${OBJECT_FORM} ${r.faction ? FACTION_TONE[r.faction] : ''} ${STYLE_LOCK}`, ref: REF('wb_card'), px: 256, subject: flatSubject(r.art.subject) });
  }
  for (const p of c.potions.values()) {
    jobs.push({ id: p.id, category: 'potion', out: `ui/potions/${p.id}`, size: '1024x1024', transparent: true,
      prompt: `${flatSubject(p.art.subject)}. ${OBJECT} ${OBJECT_FORM} ${STYLE_LOCK}`, ref: REF('wb_card'), px: 256, subject: flatSubject(p.art.subject) });
  }
  for (const ev of c.events.values()) {
    const act = Math.min(...ev.acts, 3);
    jobs.push({ id: ev.id, category: 'event', out: `backgrounds/events/${ev.id}`, size: '1536x1024', transparent: false,
      prompt: `${ev.art.subject} ${ACT_TONE[act] ?? ''} ${STYLE_LOCK}`, ref: REF('wb_background'), px: 1200 });
  }
  jobs.push(...BACKGROUNDS, ...UI_MATERIALS, ...EFFECTS, ...FACTION_EMBLEMS);
  // icons use the approved first icon as the style reference
  const ICON_REF = REF('ref_icon');
  for (const j of ICONS) jobs.push({ ...j, ref: fs.existsSync(ICON_REF) ? ICON_REF : undefined });

  return jobs;
}
