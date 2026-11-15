// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shotHolds } from '../holds.js'

const scenesDir = fileURLToPath(new URL('../../../../scenes/', import.meta.url))
const load = (f) => JSON.parse(readFileSync(scenesDir + f, 'utf8'))
const scene = load('beggar-in-the-hall.json')
const shots = scene.reference.shots
const lines = scene.lines
const D = scene.duration
const row = (h) => [h.at, h.character, h.player, h.shotAt, h.park]

// The Beggar in the Hall.
// - Cut to Penelope at 2.34, just as Antinous starts talking (2.22): the hold comes before his line.
// - Cut to Antinous at 4.25 in silence: right after the cut.
// - Cut to Odysseus at 14.22 while Penelope is mid-sentence (13.82-15.76): no hold.
// - The camera reaches Antinous at 16.64 but he starts "The trial is over" at 16.54: the hold comes
//   before his line (16.24) while the film parks on his shot (16.79).
const three = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D, lines)
assert.deepEqual(three.map(row), [
  [2.17, 'penelope', 1, 2.34, 2.49], [4.4, 'antinous', 0, 4.25, 4.4], [16.24, 'antinous', 0, 16.64, 16.79]])
// Doubled roles and a solo crew: same times
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 1 }, D, lines).map((h) => h.at), [2.17, 4.4, 16.24])
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 0, odysseus: 0 }, D, lines).map((h) => h.player), [0, 0, 0])
// Without lines: right after every cut
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D).map((h) => h.at), [2.49, 4.4, 14.37, 16.79])

// Every film scene: no hold ever interrupts speech, and the basic limits hold
for (const f of readdirSync(scenesDir).filter((n) => n.endsWith('.json'))) {
  const sc = load(f)
  if (!sc.reference?.shots) continue
  const A = Object.fromEntries(sc.characters.map((c, i) => [c.id, i]))
  const hs = shotHolds(sc.reference.shots, A, sc.duration, sc.lines)
  hs.forEach((h, i) => {
    const tag = `${f} hold ${h.at}`
    assert.ok(!sc.lines.some((l) => h.at > l.start && h.at < l.end), `${tag} interrupts a line`)
    assert.ok(h.at >= 1 && h.at <= sc.duration - 1, `${tag} in the first or last second`)
    const shot = sc.reference.shots.find((s) => s.start === h.shotAt)
    assert.equal(shot.character, h.character, `${tag} names the wrong character`)
    assert.ok(h.park >= shot.start && h.park < shot.end, `${tag} parks outside its shot`)
    assert.ok(h.park >= h.at, `${tag} parks on a frame already past`)
    assert.ok(h.at < shot.end - 0.5, `${tag} comes when its shot is nearly over`)
    assert.ok(h.at >= shot.start - 1.3, `${tag} comes long before its cut`)
    if (i) assert.ok(h.at - hs[i - 1].at >= 1.5, `${tag} too close to the hold before`)
  })
}

// Synthetic: c1 on screen 0-5, c2 from 5 to 20
const A = { c0: 0, c1: 1, c2: 2, c3: 3 }
const cut = [{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 20, character: 'c2' }]
const at2 = (ls) => shotHolds(cut, A, 20, ls).map((h) => h.at)
// The camera is late: the incoming character starts just before the cut
assert.deepEqual(shotHolds(cut, A, 20, [{ character: 'c2', start: 4.9, end: 6 }]).map(row), [[4.6, 'c2', 2, 5, 5.15]])
assert.deepEqual(at2([{ character: 'c2', start: 5.2, end: 6 }]), [4.9]) // own line right after the cut
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 4.8 }, { character: 'c2', start: 4.85, end: 6 }]), [4.8]) // back to back
// Someone else starts talking right at the cut: the hold comes before their line
assert.deepEqual(at2([{ character: 'c1', start: 5.0, end: 8 }]), [4.95])
// Mid-sentence across the cut, and the sentence runs on: no hold (a reaction shot, or the camera
// moving in on whoever is talking)
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 7.0 }]), [])
assert.deepEqual(at2([{ character: 'c2', start: 2.0, end: 9.0 }]), [])
// ...but when the sentence ends soon after the cut, the hold waits for it and parks where it is
assert.deepEqual(shotHolds(cut, A, 20, [{ character: 'c1', start: 4.0, end: 6.0 }]).map(row), [[6, 'c2', 2, 5, 6]])
assert.deepEqual(at2([{ character: 'c2', start: 2.0, end: 6.0 }]), [6])
// ...and waits longer when the new character is next to speak in the shot, but not for their own sentence
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 7.5 }, { character: 'c2', start: 8.5, end: 9.5 }]), [7.5])
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 8.5 }, { character: 'c2', start: 9, end: 9.5 }]), [])
assert.deepEqual(at2([{ character: 'c2', start: 3.0, end: 7.5 }, { character: 'c2', start: 8.5, end: 9.5 }]), [])
// One character's lines a breath apart are one stretch of speech: a cut in the breath does not hold
assert.deepEqual(at2([{ character: 'c1', start: 3.0, end: 5.1 }, { character: 'c1', start: 5.3, end: 8 }]), [])
// Two people talking over each other all around the cut: no hold
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 5.2 }, { character: 'c2', start: 4.9, end: 6 }]), [])
// A waited hold is dropped when the shot is nearly over by then
assert.deepEqual(shotHolds([{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 6.4, character: 'c2' }, { start: 6.4, end: 20, character: null }],
  A, 20, [{ character: 'c1', start: 4.0, end: 6.0 }]).map((h) => h.at), [])

// Never in the first second: an early own line is waited out instead
assert.deepEqual(shotHolds([{ start: 0, end: 1.1, character: 'c1' }, { start: 1.1, end: 5, character: 'c2' }], A, 20,
  [{ character: 'c2', start: 0.9, end: 2 }]).map((h) => h.at), [2])
// Holds closer than 1.5 s: the later wins
assert.deepEqual(shotHolds([{ start: 0, end: 3, character: 'c0' }, { start: 3, end: 3.8, character: 'c1' },
  { start: 3.8, end: 8, character: 'c2' }], A, 20).map((h) => h.at), [3.95])
// Flash shots (< 0.5 s) are ignored and don't change who was last on screen
assert.deepEqual(shotHolds([{ start: 0, end: 3, character: 'c1' }, { start: 3, end: 3.3, character: 'c2' },
  { start: 3.3, end: 6, character: 'c1' }, { start: 6, end: 9, character: 'c3' }], A, 20).map((h) => h.at), [6.15])

// Crowd shots don't hold and don't reset who was last on screen
const crowd = shotHolds([
  { start: 0, end: 2, character: 'antinous' }, { start: 2, end: 4, character: null },
  { start: 4, end: 6, character: 'antinous' }, { start: 6, end: 8, character: 'penelope' },
], { antinous: 0, penelope: 1 }, 10)
assert.deepEqual(crowd.map((h) => h.at), [6.15])
// Nothing in the first or last second, nothing without shots
assert.deepEqual(shotHolds([{ start: 0.5, end: 2, character: 'penelope' }], { penelope: 1 }, 10), [])
assert.deepEqual(shotHolds([{ start: 9.0, end: 10, character: 'penelope' }], { penelope: 1 }, 10), [])
assert.deepEqual(shotHolds(undefined, {}, 10), [])
// Broken scene data is skipped, never thrown on; the caller's arrays are left alone
const messy = [{ start: 5, end: 20, character: 'c2' }, null, { start: 'x', end: 3, character: 'c1' }, { start: 0, end: 5, character: 'c1' }]
const before = JSON.stringify(messy)
assert.deepEqual(shotHolds(messy, A, 20, [null, { character: 'c2', start: NaN, end: 6 }, { character: 'c2', start: 7, end: 6 }, { character: 'c2' }]).map((h) => h.at), [5.15])
assert.equal(JSON.stringify(messy), before)
assert.deepEqual(shotHolds(cut, null, 20), [])
assert.deepEqual(shotHolds(cut, A, 20, 'nope').map((h) => h.at), [5.15])

console.log('holds: all checks passed')
