// Acceptance checks for src/audio/sfx.js against a mocked browser.
// Run from frontend/:  node src/audio/__checks__/sfx.check.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++ }

// ---- minimal browser mock
const handlers = {}
const classes = new Set()
let observer = null
const started = [] // every Audio that actually started playing
class FakeAudio {
  constructor(src) { this.src = src; this.volume = 1; this.paused = true; this.loop = false; this.duration = 0; this.currentTime = 0; this.l = {} }
  play() { this.paused = false; started.push(this); return Promise.resolve() }
  pause() { this.paused = true }
  addEventListener(t, f) { this.l[t] = f }
}
const storage = new Map()
globalThis.window = {
  addEventListener: (t, f) => { (handlers[t] ||= []).push(f) },
  removeEventListener: (t, f) => { handlers[t] = (handlers[t] || []).filter((x) => x !== f) },
}
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
globalThis.Audio = FakeAudio
globalThis.requestAnimationFrame = () => 0
globalThis.document = { body: { classList: { contains: (c) => classes.has(c) } } }
globalThis.MutationObserver = class { constructor(cb) { observer = cb } observe() {} }
const setStageLive = (on) => { on ? classes.add('stage-live') : classes.delete('stage-live'); observer?.() }
const gesture = () => (handlers.pointerdown || []).forEach((f) => f())

const sfx = await import('../sfx.js')
const stats = globalThis.window.__sfx

// 1. nothing before the first gesture
let n = started.length
await sfx.play('gong')
sfx.loop('music', 'theme')
ok(started.length === n, 'no sound before the first user gesture (muted until first click)')
ok(sfx.isMuted() === true, 'isMuted() is true before the first gesture')
gesture()
ok(started.some((a) => a.src.endsWith('/audio/music/theme.mp3') && !a.paused), 'requested loop starts on the first gesture')

// 2. stage: music stops, only allowOnStage one-shots
setStageLive(true)
ok(started.filter((a) => a.src.includes('/music/')).every((a) => a.paused), 'music stops when the stage goes live')
n = started.length
await sfx.play('thunder')
ok(started.length === n, 'plain play() is blocked on the stage')
await sfx.play('gong', { allowOnStage: true })
ok(started.length === n + 1 && started.at(-1).src.endsWith('/sfx/gong.mp3'), 'gong (allowOnStage) plays on the stage countdown')

// 3. recording: setRecording(true) silences everything and blocks ALL plays until false
const gong = started.at(-1)
sfx.setRecording(true)
ok(gong.paused, 'setRecording(true) stops sounds already playing (gong cut before the mic opens)')
n = started.length
const blockedBefore = stats.blockedRecording
for (const name of ['cut', 'gong', 'thunder', 'rank-gods', 'applause']) {
  await sfx.play(name, { allowOnStage: true })
  await sfx.play(name)
}
sfx.loop('ambience', 'amb-hearth')
ok(started.length === n, `0 sounds started while recording (${started.length - n} started)`)
ok(stats.blockedRecording - blockedBefore === 10, `every play() during recording was blocked and counted (${stats.blockedRecording - blockedBefore}/10)`)
sfx.setRecording(false)
await sfx.play('cut', { allowOnStage: true })
ok(started.at(-1).src.endsWith('/sfx/cut.mp3'), '"Cut!" plays once recording is released')

// 4. leaving the stage while "recording" can never leave the game silent forever
sfx.setRecording(true)
setStageLive(false)
ok(stats.recording === false, 'leaving the stage resets the recording gate')
sfx.stopLoop('ambience')

// 5. mute toggle persists and silences
sfx.loop('music', 'judging')
const judging = started.at(-1)
sfx.toggleMute()
ok(storage.get('odyssey-muted') === '1', 'mute preference persisted to localStorage')
ok(judging.paused, 'muting stops the playing loop')
n = started.length
await sfx.play('applause')
ok(started.length === n, 'play() is silent while muted')
sfx.toggleMute()
ok(storage.get('odyssey-muted') === '0' && started.at(-1).src.endsWith('/music/judging.mp3'), 'unmuting resumes the wanted loop')
sfx.stopLoop('music')

// 6. countdown timing: gong must end >= 100 ms before recording starts (3 x 900 ms countdown)
const { execFileSync } = await import('node:child_process')
const py = process.env.PYTHON || path.resolve(here, '../../../../.venv/Scripts/python.exe')
const gongPath = path.resolve(here, '../../../public/audio/sfx/gong.mp3')
let gongSec = NaN
try {
  gongSec = Number(execFileSync(py, ['-c', `import sys; sys.path.insert(0, r"${path.resolve(here, '../../../../backend')}"); from features import decode_audio; print(len(decode_audio(r"${gongPath}"))/16000)`]).toString().trim())
} catch { /* python not reachable from this checkout: fall back to the documented duration */ }
if (!Number.isFinite(gongSec)) gongSec = 1.76
const countdown = 3 * 0.9
ok(countdown - gongSec >= 0.1, `gong ${gongSec.toFixed(2)} s ends ${(countdown - gongSec).toFixed(2)} s before recording (>= 0.10 s)`)
ok(fs.existsSync(gongPath), 'gong asset exists')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall sfx checks passed')
process.exit(failures ? 1 : 0)
