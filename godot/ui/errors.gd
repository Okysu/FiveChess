## Engine error / reason codes -> player-facing Chinese (port of src/game/ui/errors.ts). Anything shown in a toast
## goes through here, so engine codes ("unplayable", "not enough gold"…) never reach the player in English.
class_name UiErrors
extends RefCounted

const MAP := {
	# combat
	"cost": "源不足", "cannot pay": "源不足", "target": "没有合法目标", "bad target": "目标不合法", "illegal target": "目标不合法",
	"slot": "阵地已满", "bad slot": "无法放置在这里", "empty slot": "这里没有单位",
	"window": "此牌只能在应对窗口中打出", "unplayable": "此牌无法打出", "not a legal response": "现在不能用这张牌应对",
	"already sacrificed": "本回合已献过牌", "cannot attack": "无法攻击", "bad attacker": "该单位无法攻击", "busy": "请稍候",
	"card not in hand": "这张牌不在手中", "skill unavailable": "技能暂不可用", "combat over": "战斗已结束",
	"invalid action now": "现在无法这样做", "no pending decision": "没有需要选择的事项", "choose an option": "请先做出选择",
	"expected choose": "请先做出选择", "expected rejudge": "请先处理改判", "expected arrange": "请先整理命牌",
	"bad selection": "选择不合法", "bad choice": "选择不合法", "too many": "选得太多了", "must pick": "请选择卡牌",
	"not usable here": "此处无法使用", "not allowed here": "此处无法使用", "unknown potion": "丹药不存在", "empty": "这里是空的",
	"handFull": "手牌已满",
	# run / map / shops / events
	"not enough gold": "金币不足", "potion slots full": "行囊已满", "sold": "已售出", "not in shop": "商品不存在",
	"nothing to pick": "没有可选的牌", "cannot heal": "此处无法调息", "unreachable": "无法前往该节点", "not on map": "当前不在地图上",
	"requirement not met": "条件不足", "fate deck too small": "天命牌堆不能少于 20 张", "bad fate card": "请先选择一张命牌",
	"bad suit": "纹样不合法", "no stargaze": "当前不在观星台", "no reward": "没有可领取的奖励", "no recruit": "当前无法招贤",
	"no event": "当前没有事件", "no choice": "当前没有选择", "no chest": "宝箱已开启", "no boss relic": "没有首领遗物可选",
	"bad option": "选项不可用", "bad event": "事件不可用", "bad item": "物品不可用", "unavailable": "暂不可用",
}

static var _re_ascii: RegEx

## translate an engine code ("unplayable: window", "potion slots full"…); non-codes pass through unchanged
static func text(err) -> String:
	var e := str(err)
	if _re_ascii == null:
		_re_ascii = RegEx.create_from_string("^[\\x20-\\x7e]+$")
	if _re_ascii.search(e) == null:
		return e
	var parts := e.split(":")
	var head := parts[0].strip_edges()
	var detail := parts[1].strip_edges() if parts.size() > 1 else ""
	if detail != "" and head == "unplayable":
		return MAP.get(detail, MAP.unplayable)
	if MAP.has(e):
		return MAP[e]
	if MAP.has(head):
		return MAP[head]
	for k in MAP:
		if e.contains(k):
			return MAP[k]
	return "现在无法这样做"
