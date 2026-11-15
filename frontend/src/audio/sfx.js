// Shared audio helper (ElevenLabs-generated SFX, music, ambience in /public/audio).
//
// Interface (other code codes against exactly this):
//   play(name, { volume, allowOnStage }) -> Promise<HTMLAudioElement|null>   one-shot
//   loop(channel, name, { volume })        'music' | 'ambience'; crossfaded when the file fades
//   stopLoop(channel)                      forget + stop that channel
//   stopAll()                              silence everything now (loops stay "wanted")
//   setRecording(bool)                     true => stopAll() and block every sound until false
//   isMuted() / toggleMute() / useMuted()  user preference, persisted
//
// Rules: nothing plays before the first user gesture (browsers block it anyway), while muted,
// or while the stage is recording. On the live stage (body.stage-live) music/ambience stop and
// only play(..., { allowOnStage: true }) is allowed (the countdown gong / "Cut!").
// Files are fetched lazily on first use, so nothing here weighs on the first page load.
import { useSyncExternalStore } from 'react'

const BASE = '/audio/'
const FILES = {
  gong: 'sfx/gong.mp3', cut: 'sfx/cut.mp3', thunder: 'sfx/thunder.mp3', applause: 'sfx/applause.mp3',
  'rank-swine': 'sfx/rank-swine.mp3', 'rank-lotus': 'sfx/rank-lotus.mp3', 'rank-oarsman': 'sfx/rank-oarsman.mp3',
  'rank-hero': 'sfx/rank-hero.mp3', 'rank-favored': 'sfx/rank-favored.mp3', 'rank-gods': 'sfx/rank-gods.mp3',
  theme: 'music/theme.mp3', judging: 'music/judging.mp3',
  'fanfare-low': 'music/fanfare-low.mp3', 'fanfare-mid': 'music/fanfare-mid.mp3', 'fanfare-high': 'music/fanfare-high.mp3',
  'amb-sea': 'ambient/amb-sea.mp3', 'amb-hearth': 'ambient/amb-hearth.mp3', 'amb-wind': 'ambient/amb-wind.mp3',
}
// Music files fade in/out, so they loop with a crossfade; ambience loops are seamless (native loop).
const CROSSFADE = { music: 2.4, ambience: 0 }
const DEFAULT_VOL = { sfx: 0.6, music: 0.35, ambience: 0.25 }
const KEY = 'odyssey-muted'

// A name is a known asset, or a path relative to /audio/ (e.g. 'scenes/x.mp3'), or an absolute URL.
const src = (name) => (FILES[name] ? BASE + FILES[name] : /^(\/|https?:)/.test(name) ? name : BASE + name)

const hasWindow = typeof window !== 'undefined'
const store = (fn, fallback) => { try { return fn() } catch { return fallback } }

let unlocked = false
let recording = false
let muted = hasWindow ? store(() => localStorage.getItem(KEY) === '1', false) : false
const oneShots = new Set()
const wanted = { music: null, ambience: null }   // { name, volume }
const playing = { music: null, ambience: null }  // { name, stop() }
const listeners = new Set()

// Instrumentation for tests: window.__sfx
const stats = { played: 0, blockedRecording: 0, blockedStage: 0, loopsStarted: 0, recording: false }
if (hasWindow) window.__sfx = stats

const stageLive = () => hasWindow && document.body?.classList.contains('stage-live')
const allowed = () => unlocked && !muted && !recording
const notify = () => listeners.forEach((l) => l())

function fadeTo(a, to, seconds) {
  if (!seconds) { a.volume = to; return }
  const from = a.volume
  const t0 = performance.now()
  const step = () => {
    const f = Math.min(1, (performance.now() - t0) / (seconds * 1000))
    a.volume = Math.max(0, Math.min(1, from + (to - from) * f))
    if (f < 1 && !a.paused) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function startLoop(channel, name, volume) {
  const xf = CROSSFADE[channel]
  const url = src(name)
  const make = () => { const a = new Audio(url); a.preload = 'auto'; return a }
  let cur = make()
  let next = null
  let stopped = false
  if (!xf) cur.loop = true
  cur.volume = xf ? 0 : volume
  cur.play().catch(() => {})
  if (xf) fadeTo(cur, volume, 1.2)
  stats.loopsStarted++
  // Crossfade a fresh copy in before the current one fades out at its end.
  const timer = xf ? setInterval(() => {
    if (stopped || next || !cur.duration || cur.duration - cur.currentTime > xf) return
    next = make()
    next.volume = 0
    next.play().catch(() => {})
    fadeTo(next, volume, xf)
    const old = cur
    fadeTo(old, 0, xf)
    setTimeout(() => { old.pause(); if (!stopped) { cur = next; next = null } }, xf * 1000)
  }, 200) : null
  return {
    name,
    stop() {
      stopped = true
      if (timer) clearInterval(timer)
      for (const a of [cur, next]) if (a) { a.pause(); a.src = '' }
    },
  }
}

// Bring the loop channels in line with what's wanted and what's allowed right now.
function reconcile() {
  for (const ch of ['music', 'ambience']) {
    const w = wanted[ch]
    const ok = w && allowed() && !stageLive()
    const cur = playing[ch]
    if (cur && (!ok || cur.name !== w.name)) { cur.stop(); playing[ch] = null }
    if (ok && !playing[ch]) playing[ch] = startLoop(ch, w.name, w.volume)
  }
}

export function play(name, { volume = DEFAULT_VOL.sfx, allowOnStage = false } = {}) {
  if (recording) { stats.blockedRecording++; return Promise.resolve(null) }
  if (!allowed()) return Promise.resolve(null)
  if (stageLive() && !allowOnStage) { stats.blockedStage++; return Promise.resolve(null) }
  const a = new Audio(src(name))
  a.volume = volume
  a.__allowOnStage = allowOnStage
  oneShots.add(a)
  a.addEventListener('ended', () => oneShots.delete(a))
  stats.played++
  return a.play().then(() => a, () => { oneShots.delete(a); return null })
}

export function loop(channel, name, { volume = DEFAULT_VOL[channel] ?? 0.3 } = {}) {
  wanted[channel] = { name, volume }
  reconcile()
}

export function stopLoop(channel) {
  wanted[channel] = null
  reconcile()
}

export function stopAll() {
  for (const a of oneShots) { a.pause(); a.src = '' }
  oneShots.clear()
  for (const ch of ['music', 'ambience']) { playing[ch]?.stop(); playing[ch] = null }
}

export function setRecording(on) {
  // Recording only exists on the stage; a stale call from an unmounted stage must not lock the app silent.
  if (on && !stageLive()) return
  recording = !!on
  stats.recording = recording
  if (recording) stopAll()
  else reconcile()
}

export const isMuted = () => muted || !unlocked

export function toggleMute() {
  muted = !muted
  store(() => localStorage.setItem(KEY, muted ? '1' : '0'))
  if (muted) stopAll()
  reconcile()
  notify()
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => muted
/** React hook: the user's mute preference (true = muted). */
export const useMuted = () => useSyncExternalStore(subscribe, snapshot, snapshot)

if (hasWindow) {
  // Unlock on the first real gesture, then start whatever loop the current screen asked for.
  const unlock = () => {
    if (unlocked) return
    unlocked = true
    reconcile()
    notify()
    window.removeEventListener('pointerdown', unlock, true)
    window.removeEventListener('keydown', unlock, true)
  }
  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
  // Entering/leaving the stage: stop music/ambience there; never stay "recording" after it unmounts.
  const watch = () => {
    if (!document.body) return
    new MutationObserver(() => {
      if (!stageLive() && recording) setRecording(false)
      // Entering the stage: cut one-shots from other screens (e.g. a rehearsal read-through still playing)
      if (stageLive()) for (const a of [...oneShots]) if (!a.__allowOnStage) { a.pause(); a.src = ''; oneShots.delete(a) }
      reconcile()
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }
  if (document.body) watch()
  else window.addEventListener('DOMContentLoaded', watch)
}
