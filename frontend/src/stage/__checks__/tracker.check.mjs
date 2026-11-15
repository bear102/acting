// Synthetic multi-person checks for stage/tracker.js.  Run:  node src/stage/__checks__/tracker.check.mjs
import { PlayerTracker, assign, suppressDuplicates } from '../tracker.js'

const ASPECT = 16 / 9
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5)

// A MediaPipe-like landmark array for a person whose shoulder centre is at RAW (unmirrored) x.
function person(x, y = 0.45, w = 0.12, jitter = 0) {
  const lm = Array.from({ length: 33 }, () => ({ x, y, z: 0, visibility: 0.9 }))
  const j = () => rand() * jitter
  lm[0] = { x: x + j(), y: y - 0.12 + j(), z: 0, visibility: 0.99 }
  lm[11] = { x: x + w / 2 + j(), y: y + j(), z: 0, visibility: 0.99 }
  lm[12] = { x: x - w / 2 + j(), y: y + j(), z: 0, visibility: 0.99 }
  lm.id = x // tag for assertions
  return lm
}
const displayX = (lm) => 1 - (lm[11].x + lm[12].x) / 2

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// 1) assignment basics
{
  const pick = assign([[0.1, 5], [5, 0.2], [9, 9]], 2)
  check('assign picks optimal pairs and leaves gated rows unmatched', pick.join() === '0,1,-1', pick.join())
}

// 2) NMS removes a duplicate detection of the same body
{
  const kept = suppressDuplicates([person(0.5), person(0.505), person(0.2)], ASPECT)
  check('duplicate detection suppressed', kept.length === 2, `kept ${kept.length}`)
}

// 3) three static players with jitter: stable identities, smoothing reduces jitter
{
  const tr = new PlayerTracker(3, ASPECT)
  const xs = [0.8, 0.5, 0.2] // raw x -> display order left->right: 0.2, 0.5, 0.8
  let swaps = 0
  let rawVar = 0
  let smoothVar = 0
  let prev = null
  for (let f = 0; f < 90; f++) {
    const now = f * 33
    const dets = xs.map((x) => person(x, 0.45, 0.12, 0.01)).sort(() => rand()) // shuffled order
    const out = tr.update(dets, now)
    if (f > 10) {
      const order = out.map(displayX)
      if (!(order[0] < order[1] && order[1] < order[2])) swaps++
      if (prev) {
        smoothVar += Math.abs(out[1][0].x - prev)
        rawVar += Math.abs(dets.find((d) => Math.abs(d.id - 0.5) < 1e-9)[0].x - 0.5)
      }
      prev = out[1][0].x
    }
  }
  check('3 jittery players keep left->right identities', swaps === 0, `${swaps} bad frames`)
  check('One-Euro smoothing reduces jitter', smoothVar < rawVar * 0.6, `smooth ${smoothVar.toFixed(3)} vs raw ${rawVar.toFixed(3)}`)
}

// 4) crossing mid-take (locked): identities follow the bodies, not screen order
{
  const tr = new PlayerTracker(2, ASPECT)
  for (let f = 0; f < 15; f++) tr.update([person(0.7), person(0.3)], f * 33) // P1 at raw .7 (display left)
  tr.lock()
  const start = 15
  let followed = true
  for (let f = 0; f < 60; f++) {
    const k = f / 59
    const a = 0.7 - 0.4 * k // P1 walks to raw .3 (display right)
    const b = 0.3 + 0.4 * k
    const out = tr.update([person(b), person(a)], (start + f) * 33)
    if (Math.abs(out[0][11].x - (a + 0.06)) > 0.05) followed = false
  }
  check('players crossing mid-take keep their identities', followed)
}

// 5) brief occlusion: held; long occlusion: dropped, then re-acquired in the same slot
{
  const tr = new PlayerTracker(3, ASPECT)
  const xs = [0.8, 0.5, 0.2]
  let now = 0
  for (let f = 0; f < 15; f++) { now = f * 33; tr.update(xs.map((x) => person(x)), now) }
  tr.lock()
  // middle player vanishes for 200ms
  let heldOk = true
  for (let f = 1; f <= 6; f++) {
    now += 33
    const out = tr.update([person(0.8), person(0.2)], now)
    if (!out[1]) heldOk = false
  }
  check('200ms dropout is held (no flicker)', heldOk)
  // ... and for 2 seconds
  let nullSeen = false
  for (let f = 0; f < 60; f++) {
    now += 33
    const out = tr.update([person(0.8), person(0.2)], now)
    if (!out[1]) nullSeen = true
  }
  check('long dropout clears the player', nullSeen)
  now += 33
  const back = tr.update([person(0.8), person(0.5), person(0.2)], now)
  const ok = back.every(Boolean) && displayX(back[0]) < displayX(back[1]) && displayX(back[1]) < displayX(back[2])
  check('returning player re-acquires their own slot', ok)
}

// 6) pre-take: players walk in right-to-left (wrong slots), then the order settles
{
  const tr = new PlayerTracker(3, ASPECT)
  let now = 0
  // they appear one at a time from the right side of the screen (raw x small = display right)
  const arrive = [[0.15], [0.15, 0.4], [0.15, 0.4, 0.65]]
  for (const group of arrive) for (let f = 0; f < 5; f++) { now += 33; tr.update(group.map((x) => person(x)), now) }
  // then stand in place long enough to settle
  let out
  for (let f = 0; f < 20; f++) { now += 33; out = tr.update([0.65, 0.4, 0.15].map((x) => person(x)), now) }
  const ok = displayX(out[0]) < displayX(out[1]) && displayX(out[1]) < displayX(out[2])
  check('pre-take order settles to left->right', ok, out.map((o) => displayX(o).toFixed(2)).join(' '))
}

// 7) faces go to the nearest player's nose
{
  const tr = new PlayerTracker(2, ASPECT)
  tr.update([person(0.7), person(0.3)], 0)
  const face = (x) => { const f = Array.from({ length: 5 }, () => ({ x, y: 0.33 })); return f }
  const out = tr.assignFaces([face(0.3), face(0.7)], ['B', 'A'], 10)
  check('faces assigned by nose distance', out.join() === 'A,B', out.join())
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall tracker checks passed')
process.exit(failures ? 1 : 0)
