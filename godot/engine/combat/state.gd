## Port of src/engine/combat/state.ts — the combat state is a JSON-like Dictionary with the TS field names:
##   CombatState {v, seed, rng: [u32 x4], cfg, turn, active: "player"|"enemy", phase: "main"|"busy"|"over", over,
##     nextUid, nextTs, units: {uid(int): Unit}, sides: {player: SideState, enemy: SideState}, draw, hand, discard,
##     exhaust, sacrificed, limbo: [CardInst], sources: [{color, ready, temp?}], emberCap, sacrificesThisTurn, acted?,
##     cardsPlayedThisTurn, nextCardCostMod, fate: {deck, discard, known, signs}, skills: [SkillState],
##     relics: [RelicState], potions: [id|null], tasks: [Task], triggers: [PendingTrigger], pending: Decision|null,
##     pendingCtx: {task, effect, data?}|null, triggerUse: {key: n}, stats, goldGained, events: [CEvent], log,
##     actions: [PlayerAction], autoSkipResponse?, ending?}
##   SideState {commander, front: [uid|null x4], back: [uid|null x3], equip: {slot: EquipInst}, field, hand, deck, energy, signs}
##   Unit {uid, side, kind, def, origin, up, card?, name, row, slot, baseAtk, baseMaxHp, hp, armor, lostArmor?, atkBuff,
##     hpBuff, tempAtk, ward, thorns, growth, statuses: {id: n}, extraKeywords, silenced, stealth, ts, enteredTurn,
##     attacks, stunImmune, delays, dead?, removed?, essential?, counter, intent?, ai?, phase?, pendingPhase?, fresh?}
##   CardInst {uid, id, up, costMod?, costModUntil?, fleeting?, free?, held?}
##   Task {k:"fx", effects, i, ctx} | {k:"phase", name} | {k:"enemyAct", uid} | {k:"chain", stage, links, passes, origin, resolvedBase?}
##   Ctx {side, source, kind, card?, defId?, up?, target, vars, x?, event?, declared?, judge?, lastDamage?, it?, owner?, inWindow?, selected?}
##   PlayerAction {type: play|sacrifice|attack|skill|potion|endTurn|respond|pass|choose|arrange|rejudge, ...}
##   CEvent {t: ..., ...} (presentation events, same shapes as state.ts CEvent)
## Optional TS fields that are `undefined` are either absent or null here; the parity serializer drops both.
class_name MqState
extends RefCounted

static func other(s: String) -> String:
	return "enemy" if s == "player" else "player"
