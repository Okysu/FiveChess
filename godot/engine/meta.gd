## Port of src/engine/meta.ts — meta progression (unlocks content breadth only). Pure functions over a Profile Dictionary:
##   Profile {v, xp, runs, wins, tutorialDone, unlocked: {commanders, lieutenants, cardPacks, relicPacks, eventPacks},
##            ascension: {cmd: n}, commanderStats: {cmd: {runs, wins, bestFloor, highestAsc}},
##            discovered: {cards, enemies, relics}, history: [RunSummary], hiddenUnlocked}
class_name MqMeta
extends RefCounted

## unlock track: thresholds in 命数 (xp)
const UNLOCK_TRACK := [
	{"xp": 0, "commanders": ["r_huojin"], "label": "初入命阙"},
	{"xp": 1, "commanders": ["b_shiyun", "g_qingsi"], "lieutenants": true, "label": "石韫、青姒 加入"},
	{"xp": 400, "commanders": ["y_xuanji"], "cardPack": true, "label": "玄机子 加入 · 新卡牌"},
	{"xp": 800, "commanders": ["p_yetan"], "relicPack": true, "label": "夜昙 加入 · 新遗物"},
	{"xp": 1300, "commanders": ["r_liyuan"], "cardPack": true, "label": "离鸢 加入 · 新卡牌"},
	{"xp": 1900, "commanders": ["b_suxian"], "eventPack": true, "label": "素弦 加入 · 新事件"},
	{"xp": 2600, "commanders": ["g_acang"], "cardPack": true, "label": "阿苍 加入 · 新卡牌"},
	{"xp": 3400, "commanders": ["y_yanwujiu"], "relicPack": true, "label": "燕无咎 加入 · 新遗物"},
	{"xp": 4300, "commanders": ["p_liuxu"], "cardPack": true, "eventPack": true, "label": "柳絮 加入 · 全部内容"},
]

const ASCENSION_TEXT := [
	"标准难度", "精英出现更频繁", "普通敌人生命 +10%", "精英生命 +10%", "首领生命 +10%", "首领战后只恢复 75% 缺失生命",
	"开局生命 -10%", "余烬上限 -1", "普通敌人伤害 +1", "商店价格 +10%", "牌组起始加入诅咒「宿业」", "初始源 -1",
	"升级卡牌奖励概率减半", "天命牌堆加入 4 张「凶兆」", "敌人获得 1 层初始灵障", "终幕首领获得第三阶段",
]

static func new_profile() -> Dictionary:
	return {
		"v": 1, "xp": 0, "runs": 0, "wins": 0, "tutorialDone": false,
		"unlocked": {"commanders": ["r_huojin"], "lieutenants": [], "cardPacks": 0, "relicPacks": 0, "eventPacks": 0},
		"ascension": {}, "commanderStats": {}, "discovered": {"cards": [], "enemies": [], "relics": []}, "history": [], "hiddenUnlocked": false,
	}

## deterministic locked-content packs derived from content ids
static func packs() -> Dictionary:
	var lock_cards = [[], [], [], []]
	var by_faction = {}
	for id in MqContent.cards:
		var card: Dictionary = MqContent.cards[id]
		if card.get("pool") == false or ["basic", "token", "special"].has(card.rarity) or card.type == "status" or card.type == "curse":
			continue
		if card.rarity != "legendary" and card.rarity != "epic":
			continue
		if not by_faction.has(card.faction):
			by_faction[card.faction] = []
		by_faction[card.faction].append(card.id)
	for f in by_faction:
		var arr: Array = by_faction[f]
		MqU.default_sort(arr)
		# lock 4 of each faction's epic/legendary cards, spread across 4 packs
		var first4 = MqU.js_slice(arr, 0, 4)
		for i in first4.size():
			lock_cards[i].append(first4[i])
	var relics = []
	for id in MqContent.relics:
		var r: Dictionary = MqContent.relics[id]
		if r.tier == "rare" or r.tier == "boss":
			relics.append(r.id)
	MqU.default_sort(relics)
	var q = int(ceil(relics.size() / 4.0))
	var h = int(ceil(relics.size() / 2.0))
	var lock_relics = [MqU.js_slice(relics, 0, q), MqU.js_slice(relics, q, h)]
	var events = []
	for id in MqContent.events:
		var e: Dictionary = MqContent.events[id]
		if e.get("requires") == null:
			events.append(e.id)
	MqU.default_sort(events)
	var lock_events = [MqU.js_slice(events, 0, 5), MqU.js_slice(events, 5, 10)]
	return {"lockCards": lock_cards, "lockRelics": lock_relics, "lockEvents": lock_events}

static func _flat_from(packs_list: Array, from: int) -> Array:
	var out = []
	for p in MqU.js_slice(packs_list, from):
		out.append_array(p)
	return out

static func locked_content(p: Dictionary) -> Dictionary:
	var pk = packs()
	return {
		"cards": _flat_from(pk.lockCards, p.unlocked.cardPacks),
		"relics": _flat_from(pk.lockRelics, p.unlocked.relicPacks),
		"events": _flat_from(pk.lockEvents, p.unlocked.eventPacks),
		"lieutenants": [], # all lieutenants are available; never snapshot ids
	}

static func run_score(r: Dictionary) -> int:
	return r.stats.floors * 5 + r.stats.elites * 20 + r.stats.bosses * 60 + (300 if r.result == "win" else 0) + r.ascension * 25 + MqU.floori(MqU.fdiv(r.stats.maxDamage, 10))

## apply a finished run to the profile; returns newly unlocked labels
static func record_run(p: Dictionary, r: Dictionary, summary: Dictionary) -> Array:
	var unlocked = []
	p.runs += 1
	if summary.result == "win":
		p.wins += 1
	p.tutorialDone = true
	var before = p.xp
	p.xp += summary.score
	if not p.commanderStats.has(r.commander):
		p.commanderStats[r.commander] = {"runs": 0, "wins": 0, "bestFloor": 0, "highestAsc": 0}
	var st: Dictionary = p.commanderStats[r.commander]
	st.runs += 1
	if summary.result == "win":
		st.wins += 1
		st.highestAsc = max(st.highestAsc, r.ascension)
		var cur = p.ascension.get(r.commander, 0)
		if r.ascension >= cur and cur < 15:
			p.ascension[r.commander] = cur + 1
			unlocked.append("逆命 %d 已开放（%s）" % [cur + 1, MqContent.commander(r.commander).name])
		if not p.hiddenUnlocked:
			p.hiddenUnlocked = true
			unlocked.append("命书深处似乎还有什么在等待……")
	st.bestFloor = max(st.bestFloor, summary.floor)
	for step in UNLOCK_TRACK:
		if (step.xp > before and step.xp <= p.xp) or (step.xp == 1 and p.runs == 1):
			if step.has("commanders"):
				for c in step.commanders:
					if not p.unlocked.commanders.has(c):
						p.unlocked.commanders.append(c)
			if step.get("lieutenants") == true and p.unlocked.lieutenants.is_empty():
				p.unlocked.lieutenants = ["*"]
			if step.get("cardPack") == true:
				p.unlocked.cardPacks += 1
			if step.get("relicPack") == true:
				p.unlocked.relicPacks += 1
			if step.get("eventPack") == true:
				p.unlocked.eventPacks += 1
			if not unlocked.has(step.label):
				unlocked.append(step.label)
	for k in ["cards", "enemies", "relics"]:
		for id in r.discovered[k]:
			if not p.discovered[k].has(id):
				p.discovered[k].append(id)
	p.history.push_front(summary)
	p.history = MqU.js_slice(p.history, 0, 60)
	return unlocked

static func next_unlock(p: Dictionary):
	for s in UNLOCK_TRACK:
		if s.xp > p.xp:
			return s
	return null
