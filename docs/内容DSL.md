# 内容 DSL 参考（数据驱动效果系统）

> 所有卡牌 / 敌人 / 遗物 / 丹药 / 事件都是 `src/data/**` 下的 JSON 数组，由 `src/engine/schema.ts`（zod，**严格模式：未知字段即报错**）校验。
> 类型定义见 `src/engine/defs.ts`，执行语义见 `src/engine/combat/core.ts`。本文是内容作者的唯一权威说明。

校验命令：
```bash
npm run validate                      # schema + 交叉引用 + 变量/文本检查
npx vitest run tests/content.test.ts  # 每张卡/遗物/丹药/主帅/遭遇战在真实引擎里跑一遍
```

---

## 1. 文件与 ID 约定

| 内容 | 文件 | ID 前缀 |
|---|---|---|
| 各流派卡牌 | `src/data/cards/R.json` `B.json` `G.json` `Y.json` `P.json` | `r_` `b_` `g_` `y_` `p_` |
| 中立卡 | `src/data/cards/N.json` | `n_` |
| 状态/诅咒 | `src/data/cards/status.json` | `st_` / `cu_` |
| 衍生物（token） | 放在所属流派文件里，`rarity: "token"` | `tk_` |
| 敌方专用卡（首领手牌） | `src/data/cards/enemy.json`，`rarity: "special"`，`pool: false` | `ec_` |
| 主帅 | `src/data/commanders.json`（按流派拆分为 `commanders.json` 内追加即可；若并行写入请用 `src/data/commanders/<色>.json` → 见下） | `r_huojin` 等 |
| 副将 | `src/data/lieutenants.json` | `lt_` |
| 敌人 | `src/data/enemies/act1.json` … | `e1_` `e2_` `e3_` `e4_` |
| 遭遇战 | `src/data/encounters*.json` | `enc1_` … |
| 遗物 | `src/data/relics/*.json` | `rl_` |
| 丹药/符箓 | `src/data/potions.json` | `po_` |
| 事件 | `src/data/events/*.json` | `ev_` |

> 加载器按路径识别：路径含 `/cards/` → 卡牌；含 `/enemies/` → 敌人；以 `commanders.json` 结尾 → 主帅；`lieutenants.json` → 副将；含 `/encounters` → 遭遇战；含 `/relics` → 遗物；`potions.json` → 丹药；含 `/events` → 事件。
> 因此并行写作时：主帅可放 `src/data/commanders/R/commanders.json`，副将放 `src/data/lieutenants/R/lieutenants.json`，遭遇战放 `src/data/encounters/act1.json`。

所有名称、文本为**简体中文**；`art.subject` 为**英文**。

---

## 2. 卡牌 CardDef

```jsonc
{
  "id": "r_ember_slash",
  "name": "余烬斩",
  "faction": "R",                  // R B G Y P N
  "type": "tactic",                // unit tactic response equip delay field status curse
  "rarity": "common",              // basic common rare epic legendary token special
  "cost": { "g": 1, "c": ["R"] },  // 通用费用 g（或 "X"）+ 颜色要求 c
  "text": "造成{d}点伤害，施加{b}层[灼烧]。",
  "vars": { "d": 7, "b": 2 },
  "varKinds": { "d": "attack", "b": "burn" },   // 用于运行时着色（attack/damage/armor/heal/burn/poison/other）
  "target": "enemy",
  "effects": [
    { "op": "damage", "amount": "$d", "target": "target", "attack": true },
    { "op": "status", "status": "burn", "amount": "$b", "target": "target" }
  ],
  "upgrade": { "vars": { "d": 10 } },
  "flavor": "火不问来处。",
  "art": { "subject": "a warrior swinging a blade trailing embers..." }
}
```

### 字段
- `keywords`：卡牌层面的关键词（`exhaust` `innate` `retain` `ethereal` `response` `offering` `combo` `resonance` `judge` `delay` `omen` 等），用于规则与 UI 标注。**`exhaust/innate/retain/ethereal/response` 有机制效果**，其余为标注。
- `target`：打出时玩家需要选择的目标：`none` `enemy`（敌方任意角色，含首领）`enemyUnit` `friendlyUnit` `friendly`（己方单位或主帅）`anyUnit` `any`。**随从牌不填**（放置到格子）；**延时牌不填**（由 `delay.on` 决定）。
- `effects`：打出时依次执行。对随从牌而言，`effects` 就是【起势】（此时 `self` = 刚入场的单位）。
- `onSacrifice`：【献】效果（被献为源时执行）。
- `inHand`：在手牌中时生效的触发器（常用于诅咒：“回合结束时若在手中，失去2生命”）。
- `windowOnly: true`：只能在应对窗口中打出（含“取消/改目标”类效果的应牌必须设置）。
- `unplayable: true`：不能打出（状态/诅咒）。
- `unit`：`{ atk, hp, keywords?, thorns?, growth?, ward?, triggers?, aura?, modifiers?, prefersBack? }`
  - 单位关键词（机制生效）：`taunt` `ranged` `leap` `haste` `twinStrike` `lifesteal` `deathtouch` `stealth` `ward`；数值型用 `thorns` `growth` `ward` 字段。
  - `aura`：统御光环（Modifier 数组，默认 `who: "adjacent"`）。
  - `triggers`：遗志用 `{ "on": "death", ... }`。
- `equip`：`{ slot: weapon|armor|mount|treasure, atk?, range?, durability?, mount?: offense|defense, triggers?, modifiers? }`（武器：atk=攻击力，range=攻击距离 1-3，durability=攻击次数）。
- `delay`：`{ turns, on: enemy|friendly|any, branches }` — 挂在目标身上，目标方回合开始时倒计时 -1，归零判定。分支执行时 `target` = 被挂载者，`self`/`commander` = 施放者主帅。
- `field`：`{ duration?, triggers?, modifiers? }` 阵地（每方 1 个，新的替换旧的）。
- `upgrade`：升级后的部分覆盖（`vars` `text` `cost` `effects` `keywords` `unit` `equip` `delay` `field` `onSacrifice` `target` `windowOnly` `name`）。**改变机制的升级必须写 `"qualitative": true`**（全卡池至少 1/3）。
- `pool: false`：不进入奖励池（起始卡、衍生卡、特殊卡）。

### 规则文本标记
- `{var}` 插入变量（会根据增益/削弱着色）；`{R}{B}{G}{Y}{P}{N}` 颜色图标；`{sun}{moon}{thunder}{mountain}` 命纹图标；`{X}` 表示 X。
- `[关键词]` 高亮并可悬停释义。允许的词：坚守 远射 奇袭 疾行 连斩 灵障 汲命 断魂 棘刺 起势 遗志 滋长 统御 隐匿 应 判定 延时 天契 燃尽 本命 藏锋 浮光 连势 献 共鸣；状态：灼烧 中毒 冰冻 眩晕 易伤 虚弱 封印 锋锐 坚韧 再生；术语：护甲 余烬 源 命签 窥视 观星 改判。
- 文本写法参考：“[起势]：对一个敌人造成{d}点伤害。”“[应]：获得{a}点[护甲]。”“[判定]：{sun}{thunder}阳纹——造成{d}点伤害；阴纹——获得{a}点[护甲]。”

---

## 3. 执行上下文（重要）

每个效果在一个上下文 `ctx` 中执行，`ctx.side` 决定“友方/敌方”视角。

| 来源 | ctx.side | `self` | `target` |
|---|---|---|---|
| 玩家打出的策略/应对/装备/阵地牌 | player | 玩家主帅 | 打出时选的目标 |
| 随从牌的起势 | player | **刚入场的单位** | 无（除非牌有 target）|
| 单位的触发器（遗志等） | 单位所属方 | 该单位 | 无 |
| 遗物、主帅技能、副将技能 | player | 玩家主帅 | 技能选的目标 |
| 敌人意图（moves） | enemy | 该敌人 | 意图目标（由 `target` 规则选出）|
| 延时判定分支 | 施放者方 | 施放者主帅 | 被挂载者 |
| 丹药 | player | 玩家主帅 | 选的目标 |

触发器额外提供 `eventSource` / `eventTarget` / `{count:"eventAmount"}` / 事件卡牌。应对窗口中打出的牌提供 `declaredActor`（宣告行动的敌人）与 `declaredTarget`（该行动的目标）。

---

## 4. 值 Value
- 数字：`6`
- 变量：`"$d"`（取卡牌 `vars.d`；`"$x"` 为 X 费支付量；敌人意图里 `"$atk"` = 该敌人当前攻击力）
- 计数：`{ "count": <kind>, ...参数 }`

| count | 含义 | 参数 |
|---|---|---|
| hand / drawPile / discardPile / exhaustPile | 牌数 | |
| sources | 永久源数量 | `color?` |
| readySources / embers | 当前可用源 / 余烬 | |
| units | 单位数 | `side?: friendly|enemy`，`row?` |
| cardsPlayed | 本回合已打出张数（不含当前） | |
| status | 某角色某状态层数 | `status`，`of?`（默认 self） |
| armor / atk / hp / maxHp / missingHp | 角色数值 | `of?` |
| signs | 命签数 | |
| judgeRank | 当前判定牌点数（仅判定分支内） | |
| x / lastDamage / turn / sacrificed / eventAmount | X 费 / 上一个伤害效果造成的总生命伤害 / 回合数 / 本场献出张数 / 触发事件数值 | |
| judgesThisTurn | 本回合判定次数 | `suit?`（含 yang/yin） |
| equipped / delays / counter / deadThisCombat / responsesThisCombat / weaponAtk / selected | | |

- 运算：`{ "add": [a,b] }` `{ "mul": [a,b] }`（结果向下取整）`{ "sub": [a,b] }` `{ "div": [a,b] }` `{ "max": [...] }` `{ "min": [...] }`

## 5. 选择器 Selector
字符串：`self` `commander`（己方主帅）`enemyCommander`（对方主帅/首领，普通战斗中不存在→空）`target` `it`（forEach 当前项）`eventSource` `eventTarget` `declaredActor` `declaredTarget` `adjacent`（与 self 相邻的单位）`targetAdjacent` `allEnemies`（敌方全部角色含首领）`enemyUnits` `friendlyUnits` `otherFriendlyUnits` `allFriendly`（含主帅）`allUnits` `allCharacters` `randomEnemy` `randomEnemyUnit` `randomFriendlyUnit` `enemyFront` `enemyBack` `friendlyFront` `friendlyBack` `none`

对象：
```json
{ "side": "enemy", "kind": "unit", "row": "front", "where": {"hasStatus": {"of": "it", "status": "burn"}}, "pick": "lowestHp", "n": 2, "notSelf": true }
```
`kind`: unit（默认）| character（含主帅）| commander；`pick`: all（默认）random lowestHp highestHp highestAtk lowestAtk first。

## 6. 条件 Condition
`{gt|lt|gte|lte|eq: [V, V]}` `{and:[…]}` `{or:[…]}` `{not: C}`
`{hasStatus:{of, status}}` `{hasKeyword:{of, keyword}}` `{isUnit: Sel}` `{isCommander: Sel}` `{alive: Sel}` `{inRow:{of,row}}`
`{combo: n}`（本回合此前已打出 ≥n 张）`{resonance:{color, n}}`（拥有 ≥n 枚该色源）
`{suit: "sun"|"thunder"|"moon"|"mountain"|"yang"|"yin"}` `{rank:{min?,max?}}`（仅在判定分支或 judged 触发器内有意义）
`{chance: 0.3}` `{inWindow: true}` `{declared: "attack"}`（被应对的敌方行动含该意图）`{myTurn: true}` `{eventCard: CardFilter}` `{hasEquip: "weapon"}` `{emptySlot:{side, row?}}`

CardFilter：`{ type?, faction?（色 / 数组 / "own"）, rarity?, keyword?, id?, maxCost?, minCost? }`

## 7. 效果原子 Effect（`op`）

| op | 字段 | 说明 |
|---|---|---|
| damage | amount, target, attack?, times?, pierce? | 伤害。`attack:true` 表示“攻击伤害”（吃锋锐/虚弱）；pierce 无视护甲灵障 |
| attack | attacker?(默认 self), target, amount?, times? | 发动一次真正的攻击（有反击、棘刺、武器耐久） |
| heal / loseHp / armor / ward | amount, target | 治疗 / 直接失去生命 / 护甲 / 灵障层数 |
| restoreArmor | fraction(0–1), max?, target | 返还本回合开始时消散护甲的一部分（每回合只生效一次；多个判定分支命中时仅第一个生效） |
| status | status, amount, target | 施加状态（burn poison freeze stun vulnerable weak silence might tenacity regen），amount 可为负 |
| cleanse | target, what: debuffs|buffs|<status> | 清除 |
| buff | target, atk?, hp?, until?:"turn" | 单位 +攻/+血（until turn = 本回合临时攻击）|
| kill / silence | target | 消灭单位（对主帅无效）/ 封印 |
| addKeyword | target, keyword, value? | 获得关键词（thorns/growth/ward 可带数值） |
| summon | unit(卡牌 id 或敌人 id), n?, row?: front|back|auto, side?: friendly|enemy, atk?, hp? | 召唤衍生物（满格则失败）|
| move | target, to: front|back|swap | 换排 |
| bounce | target | 将己方单位移回手牌 |
| transform | target, into | 变形 |
| draw | n | 抽牌 |
| discard / exhaustCards | n, mode: choose|random|all, each? | 弃置/燃尽手牌；`each` 对每张被弃的牌执行（可用 `{eventCard:…}` 条件）|
| create | card(id 或 {pool: CardFilter}), n?, to: hand|draw|discard, upgraded?, fleeting? | 生成牌；`fleeting` = 浮光+燃尽的临时牌。敌方意图用它把状态牌塞进玩家牌组 |
| discover | pool, n?(默认3), upgraded?, free? | 三选一加入手牌（free = 本回合 0 费）|
| fetch | from: draw|discard|exhaust, mode: choose|random|top, n, filter? | 从牌堆取牌入手 |
| energy | n, color? | 本回合临时可用源（回合结束消失，不成为余烬）|
| gainSource | n, color | 永久获得源（'best' = 主帅主色）|
| emberCap | n | 本场余烬上限 +n |
| refresh | n | 重置 n 枚已用源 |
| costMod | scope: hand|handRandom|nextCard, amount, until: turn|played|combat, filter? | 改费 |
| judge | branches, target? | 判定。branches：`sun thunder moon mountain yang yin high(≥8) low(≤7) ranks[{min,max,effects}] always` 可同时命中多个（命纹分支→阴阳分支→高低→点数段→always）|
| peek / stargaze / sign | n | 窥视 / 观星（玩家重排）/ 收命签 |
| fateAdd | suit, rank, n?, where: top|shuffle | 本场向天命牌堆加入牌 |
| delay | card(延时牌 id), target, turns? | 由效果挂载延时 |
| equip / field | card | 由效果装备/放置 |
| weapon | atk?, range?, durability? | 修改当前武器 |
| destroyEquip | slot|random, side | 摧毁装备 |
| cancel / redirect | — / to | **仅应对窗口**：取消被应对的行动 / 改变其目标 |
| repeat | times, effects | 重复 |
| if | cond, then, else? | 条件 |
| choose | options:[{text, effects}] | 玩家二选一/多选一（敌方总选第一个）|
| forEach | sel, effects | 对每个选中者执行（用 `it` 指代）|
| store | key, value | 存入 ctx.vars[key]（之后用 `"$key"`）|
| counter | amount, max?, then? | 遗物/单位计数器，满 max 时执行 then 并扣回 |
| gold | n | 战斗后额外金币 |
| script | id, args? | 注册的 TS 扩展：目前 `bossCast`（首领出牌 AI）|

## 8. 触发器 Trigger
```json
{ "on": "death", "who": "self", "if": {...}, "effects": [...], "limit": "turn", "suit": "sun", "status": "burn" }
```
`on`：`combatStart combatEnd turnStart turnEnd opponentTurnStart opponentTurnEnd enter death cardPlayed cardSacrificed cardDrawn cardDiscarded cardExhausted cardCreated unitSummoned unitDied damaged dealtDamage attacked attacking healed armorGained armorBroken statusApplied judged rejudged responsePlayed actionDeclared equipped sourceGained shuffled`

`who`（事件主体相对于持有者）：`self | friendly | enemy | any`。默认：
- damaged / attacked / death / enter / dealtDamage / attacking / healed / armorGained / armorBroken / statusApplied → `self`（遗物/技能/装备的 self = 玩家主帅）
- judged / combatStart / combatEnd / rejudged → `any`
- opponentTurnStart / opponentTurnEnd / actionDeclared → `enemy`
- 其余 → `friendly`（turnStart = 持有者方回合开始）

`suit` 只对 judged/rejudged 过滤；`status` 只对 statusApplied 过滤；`limit` 每回合/每场一次。
事件数据：`eventSource`、`eventTarget`（受伤者/死亡者/被攻击者/卡牌目标）、`{count:"eventAmount"}`（伤害量、护甲量等）、`{eventCard: filter}`。

## 9. 持续修正 Modifier
```json
{ "stat": "burnDamage", "amount": 2, "who": "enemy" }
```
| stat | 含义 | who 的解读 |
|---|---|---|
| atk / maxHp | 单位攻击/生命 | 按目标单位 |
| attackDamage | 攻击伤害 +X | 攻击者 |
| effectDamage | 非攻击效果伤害 +X | 来源方 |
| damageTaken | 受到伤害 +X（负数减伤）| 受伤者 |
| burnDamage / poisonDamage | 灼烧/中毒伤害 +X | 承受者（`who:"enemy"` = 对敌人的灼烧更痛）|
| armorGain / healing | 获得护甲/治疗 +X | 获得者 |
| emberCap / draw / maxSources / handLimit / sacrifices / signCap / judgeRank | 玩家层面：余烬上限、每回合抽牌、源上限、手牌上限、每回合献牌次数、命签上限、玩家判定点数+X | friendly |
| range | 主帅攻击距离 +X | |
| cost | 卡牌费用 ±X（配合 `filter`）| |
| keyword | 授予关键词（配合 `keyword`）| |
| armorKeep | 回合开始时保留至多 X 点护甲（999=全部）| |
| burnKeep | 灼烧不衰减 | 承受者 |
| retainHand | 回合结束不弃手牌 | |

`who`：`self friendly enemy adjacent friendlyUnits enemyUnits commander all`；可带 `if` 条件。

## 10. 主帅 / 副将
```jsonc
{
  "id": "r_huojin", "name": "霍烬", "title": "断焰将军", "faction": "R", "hp": 78,
  "sources": ["R","R","N"],      // 初始源（副将加入后第一个 N 变为副将颜色）
  "deck": ["r_basic_strike", ...], // 10–12 张
  "relic": "rl_start_huojin",       // 专属初始遗物（tier: starter）
  "skills": [ { 被动 }, { 主动/限定/觉醒 } ],
  "lore": "……", "ending": "通关结局文本（150–300字）", "art": {...}
}
```
SkillDef：`{ id, name, type: passive|active|limited|awaken, text, cost?, target?, effects?, triggers?, modifiers?, awaken? }`
- passive：用 `triggers` / `modifiers`
- active：每回合 1 次，`effects`（可带 `cost` 与 `target`）
- limited：每场 1 次
- awaken：`awaken: { on, who?, if?, effects?, becomes: {name, type, text, effects?, triggers?, modifiers?} }` 条件满足时执行 effects，技能永久变为 becomes

副将：`{ id, name, title, faction, skill: SkillDef, lore, art }`

## 11. 敌人
```jsonc
{
  "id": "e1_bone_spear", "name": "骸骨枪卒", "act": 1, "tier": "normal",   // normal elite boss minion
  "hp": [18, 22], "atk": 6, "row": "front",   // front | back | commander（首领/精英头目占主帅位）
  "keywords": ["taunt"], "thorns": 0, "ward": 0,
  "moves": {
    "thrust": { "name": "突刺", "intent": ["attack"], "effects": [{ "op": "attack", "target": "target" }] },
    "brace":  { "name": "列阵", "intent": ["defend"], "effects": [{ "op": "armor", "amount": 6, "target": "self" }] }
  },
  "ai": { "type": "cycle", "sequence": ["thrust", "thrust", "brace"] },
  "passives": [ Trigger… ], "modifiers": [ … ],
  "phases": [ { "hpBelow": 0.5, "name": "…", "text": "阶段台词", "ai": {...}, "moves": {...}, "effects": [...], "atk": 12 } ],
  "deck": ["ec_…"], "energy": { "start": 2, "perTurn": 1, "max": 5 },
  "lore": "图鉴条目", "dialogue": { "intro": "…", "phase": "…", "defeat": "…" },
  "art": { "subject": "…" }
}
```
- 意图类型 `intent`：attack defend buff debuff summon judge cast unknown escape sleep heal（可多个，决定图标）。
- 意图目标 `target`：`default`（遵守距离/坚守，能打主帅时优先主帅）`commander`（刺客/远程直取主帅）`randomUnit` `lowestHp` `highestAtk` `self` `ally` `allyLowest` `none`。未写时：含 attack/debuff 的用 default，否则 none。
- 攻击用 `{ "op": "attack", "target": "target" }`（伤害=攻击力，可 `amount` 覆盖，`times` 多段）；有反击。远程敌人（`keywords:["ranged"]`）放后阵；**后阵近战敌人会在前阵有空位时自动前压**。首领位的攻击视为远程。
- AI：`cycle`（sequence 循环，`start:"random"` 随机起点）/ `weighted`（`weights`，`noRepeat: n` 禁止连续 n+1 次）/ `script`（`first` 开场固定序列 → `rules` 条件分支（`once` 只触发一次）→ `then` 回退 AI）。
- 条件示例：生命低于一半 `{ "lt": [{"count":"hp"}, {"mul":[{"count":"maxHp"}, 0.5]}] }`
- 首领手牌：给 `deck`（敌方专用卡 `ec_`）与 `energy`，并在某个意图里加入 `{ "op": "script", "id": "bossCast" }`（意图类型含 `cast`）。敌方卡牌的“敌人/友方”视角相对于首领方。
- 阶段：生命首次 ≤ `hpBelow × 最大生命` 时进入，清除减益、执行 `effects`、换 AI/招式、可改攻击力。

遭遇战：
```json
{ "id": "enc1_bones", "act": 1, "tier": "normal", "pool": "easy", "weight": 1, "enemies": [ {"id":"e1_bone_spear","row":"front","slot":1}, {"id":"e1_bone_archer","row":"back","slot":1} ] }
```
`pool: easy` 用于每幕前 3 场；`tutorial: "response" | "judge"` 标注教学战。

## 12. 遗物
```json
{ "id": "rl_…", "name": "…", "tier": "common", "faction": "R", "text": "…", "flavor": "…",
  "triggers": [...], "modifiers": [...], "onPickup": [RunEffect…], "run": [RunRule…], "ruleChanging": true, "art": {...} }
```
tier：starter common uncommon rare boss shop event。`ruleChanging: true` 标注“改变规则”类（至少 20 件）。
RunRule：`restHealBonus{amount}` `shopDiscount{pct}` `extraCardChoice{n}` `goldBonus{pct}` `noHealAtRest` `potionSlots{n}` `eliteRelicExtra` `mapReveal` `removeCostDiscount{pct}` `upgradeRewards`

## 13. 丹药/符箓
`{ id, name, rarity: common|uncommon|rare, text, target, effects, outOfCombat?: RunEffect[], art }`

## 14. 事件与冒险层效果 RunEffect
`gold{n}` `hp{n}` `hpPct{pct}` `maxHp{n}` `addCard{card?|pool?, n?, upgraded?, choose?}` `removeCard{n, mode}` `upgradeCard{n, mode}` `transformCard{n, mode}` `duplicateCard{n}` `addRelic{relic?|tier?}` `loseRelic{mode}` `addPotion{potion?}` `fight{encounter, reward?}` `fate{action: remove|add|changeSuit|preview, suit?, rank?, n?}` `chance{p, then, else?}` `lieutenant{id?}` `flag{key}` `emberCap{n}` `startSource{color}`

RunCondition（`requires`）：`{gold}` `{hpAbove}` `{commander}` `{lieutenant}` `{faction}`（主帅或副将颜色）`{hasRelic}` `{flag}` `{act}` `{deckHas: CardFilter}` `{noLieutenant: true}`

事件：`{ id, title, acts:[1,2], requires?, text, options:[{text, requires?, hint?, effects, outcome, next?}], pages?:[{id,text,options}], art }`

## 15. 数值框架（设计基准）
- 玩家主帅生命 65–85；初始 3 源；每回合抽 5。
- 通用 1 费 ≈ 6 攻击伤害 ≈ 5 护甲；2 费 ≈ 11 / 10；3 费 ≈ 16 或群伤 7；每个颜色要求约抵 0.5 费的额外强度。
- 随从：攻+血 ≈ 2×费用+2（1费 2/2，2费 3/3，3费 3/5，4费 5/5）；关键词与起势从中扣预算。
- 敌人（第一幕）：普通单体 12–45 生命，攻击 4–9；精英 70–120；首领 180–240。第二幕约 ×1.7 生命、×1.5 伤害；第三幕约 ×2.4 / ×2；终幕首领 650–800。

## 16. 插画描述（art.subject）
- 英文一到两句：主体、动作、构图、关键道具与光线。例如：`"a young priestess in crimson robes kneeling as vermilion flames bloom from her palms, looking upward, sparks drifting"`。
- **不要**写风格词（风格由生成脚本统一追加）、**不要**要求文字/符号/边框。
- 单位与敌人写单一主体、全身或半身、姿态清晰；法术写“场景 + 动作 + 光效”。
