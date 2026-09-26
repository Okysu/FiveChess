## Audio (port of src/game/audio/audio.ts, sample part): buses Master / Music / Sfx / Ambient; sound ids play a random
## variant from assets/audio/audio.json with a small pitch jitter (repeats don't sound identical) and a 35 ms
## per-id throttle; music moods and ambience loop and crossfade. The web's procedural synth fallback is not ported:
## every id the game uses has samples.
extends Node

const BUSES := ["Music", "Sfx", "Ambient"]
const BASE := "res://assets/audio/"

var bank := {}
var volumes := {"master": 0.8, "music": 0.5, "sfx": 0.8, "ambient": 0.5}
var _pool: Array[AudioStreamPlayer] = []
var _next := 0
var _last := {}
var _music: AudioStreamPlayer = null
var _music_key := ""
var _music_file := ""
var _amb: AudioStreamPlayer = null
var _amb_key := ""
var _streams := {}

func _ready() -> void:
	for b in BUSES:
		if AudioServer.get_bus_index(b) < 0:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, b)
			AudioServer.set_bus_send(i, "Master")
	for i in 10:
		var p := AudioStreamPlayer.new()
		p.bus = "Sfx"
		add_child(p)
		_pool.append(p)
	var j = null
	if FileAccess.file_exists(BASE + "audio.json"):
		j = JSON.parse_string(FileAccess.get_file_as_string(BASE + "audio.json"))
	if j is Dictionary:
		bank = j
	_apply()

func set_volume(bus: String, v: float) -> void:
	volumes[bus] = clampf(v, 0.0, 1.0)
	_apply()

func _apply() -> void:
	for b in volumes:
		var i := AudioServer.get_bus_index("Master" if b == "master" else String(b).capitalize())
		if i >= 0:
			var v: float = volumes[b]
			AudioServer.set_bus_volume_db(i, linear_to_db(maxf(v, 0.0001)))
			AudioServer.set_bus_mute(i, v <= 0.001)

func _stream(file: String) -> AudioStream:
	if _streams.has(file):
		return _streams[file]
	var s = load(BASE + file) if ResourceLoader.exists(BASE + file) else null
	_streams[file] = s
	return s

## play a sound id (sfx() in audio.ts)
func sfx(id: String, intensity := 1.0) -> void:
	var e = bank.get("sfx", {}).get(id)
	if e == null:
		return
	var now := Time.get_ticks_msec()
	if _last.get(id, -1000) > now - 35:
		return
	_last[id] = now
	var files: Array = e.files
	if files.is_empty():
		return
	var s := _stream(files[randi() % files.size()])
	if s == null:
		return
	var p := _pool[_next]
	_next = (_next + 1) % _pool.size()
	p.stream = s
	p.pitch_scale = randf_range(0.96, 1.04)
	p.volume_db = linear_to_db(float(e.gain) * minf(1.4, 0.6 + intensity * 0.4))
	p.play()

## looping music for a mood, crossfaded; two moods sharing a file keep it playing
func play_music(mood: String) -> void:
	if mood == _music_key:
		return
	var m = bank.get("music", {}).get(mood)
	if m == null:
		return
	if m.file == _music_file and _music != null:
		_music_key = mood
		return
	_music_key = mood
	_music_file = m.file
	_music = _crossfade(_music, m.file, float(m.gain), "Music")

func stop_music() -> void:
	_fade_out(_music)
	_music = null
	_music_key = ""
	_music_file = ""

func ambience(kind) -> void:
	var k := "" if kind == null else String(kind)
	if k == _amb_key:
		return
	_amb_key = k
	var a = bank.get("amb", {}).get(k) if k != "" else null
	if a == null:
		_fade_out(_amb)
		_amb = null
		return
	_amb = _crossfade(_amb, a.file, float(a.gain), "Ambient")

func _crossfade(old: AudioStreamPlayer, file: String, gain: float, bus: String) -> AudioStreamPlayer:
	_fade_out(old)
	var s := _stream(file)
	if s == null:
		return null
	if "loop" in s:
		s.loop = true
	var p := AudioStreamPlayer.new()
	p.bus = bus
	p.stream = s
	p.volume_db = -60.0
	add_child(p)
	p.play()
	var tw := create_tween()
	tw.tween_property(p, "volume_db", linear_to_db(maxf(gain, 0.0001)), 1.6).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	return p

func _fade_out(p: AudioStreamPlayer) -> void:
	if p == null or not is_instance_valid(p):
		return
	var tw := create_tween()
	tw.tween_property(p, "volume_db", -60.0, 1.2)
	tw.tween_callback(p.queue_free)
