## Port of src/engine/defs.ts — content DSL constants. The TS interfaces become plain Dictionaries with the
## same keys (JSON as loaded from res://data); this file documents the shapes the port relies on.
##
##   CardDef      {id, name, faction: Color, type: CardType, rarity, cost: {g: int|"X", c?: [Color]}, text, vars?,
##                 keywords?, target?: TargetSpec, effects?: [Effect], onSacrifice?, inHand?: [Trigger],
##                 windowOnly?, unit?: {atk, hp, keywords?, thorns?, growth?, ward?, triggers?, aura?, modifiers?,
##                 prefersBack?}, equip?: {slot, atk?, range?, durability?, mount?, triggers?, modifiers?},
##                 delay?: {turns, on, branches}, field?: {duration?, triggers?, modifiers?}, unplayable?, upgrade?, pool?}
##   Effect       {op: String, ...op-specific keys}  (see defs.ts `Effect`; internal ops start with "__")
##   Value        int | float | "$var" | {count: CountKind, ...} | {add|mul|max|min: [Value]} | {sub|div: [Value, Value]}
##   Selector     SelectorName String | {side, kind?, row?, where?, pick?, n?, notSelf?}
##   Condition    single-key Dictionary: {gt|lt|gte|lte|eq: [Value, Value]} | {and|or: [Condition]} | {not: Condition} | ...
##   Trigger      {on: TriggerOn, who?, if?, effects, limit?, status?, suit?}
##   Modifier     {stat: ModStat, amount?, who?, keyword?, filter?: CardFilter, if?}
##   CardFilter   {type?, faction?, rarity?, keyword?, id?, maxCost?, minCost?}
##   CommanderDef {id, name, title, faction, hp, sources, deck, relic, skills: [SkillDef], ...}
##   SkillDef     {id, name, type: passive|active|limited|awaken, cost?, target?, effects?, triggers?, modifiers?, awaken?}
##   EnemyDef     {id, name, act, tier, hp: [min, max], atk, keywords?, thorns?, ward?, row, moves: {name: EnemyMove},
##                 ai: EnemyAI, passives?, modifiers?, phases?, deck?, energy?}
##   EncounterDef {id, act, tier, pool?, enemies: [{id, row?, slot?}], weight?, tutorial?}
##   RelicDef     {id, name, tier, faction?, triggers?, modifiers?, onPickup?: [RunEffect], run?: [RunRule], counter?}
##   PotionDef    {id, name, rarity, target, effects, outOfCombat?: [RunEffect]}
##   EventDef     {id, title, acts, requires?, text, options: [EventOption], pages?}
class_name MqDefs
extends RefCounted

const COLORS := ["R", "B", "G", "Y", "P"]
const SUITS := ["sun", "thunder", "moon", "mountain"]
const YANG := ["sun", "thunder"]
