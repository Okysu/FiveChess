import { content } from '../content';
import type { SkillDef } from '../defs';
import type { CombatState, SkillState } from './state';

export function skillDef(s: CombatState, sk: SkillState): SkillDef | undefined {
  const c = content();
  let base: SkillDef | undefined;
  if (sk.from === 'commander') { const cmd = c.commander(s.cfg.commander); base = cmd.skills.find((x) => x.id === sk.id) ?? (cmd.alt?.skill.id === sk.id ? cmd.alt.skill : undefined); }
  else if (s.cfg.lieutenant) {
    const l = c.lieutenants.get(s.cfg.lieutenant);
    if (l && l.skill.id === sk.id) base = l.skill;
  }
  if (!base) return undefined;
  if (sk.awakened && base.awaken?.becomes) return { ...base.awaken.becomes, id: base.id } as SkillDef;
  return base;
}
