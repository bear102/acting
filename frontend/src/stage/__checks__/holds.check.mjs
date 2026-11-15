// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shotHolds } from '../holds.js'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../scenes/beggar-in-the-hall.json', import.meta.url)), 'utf8'))
const shots = scene.reference.shots
const lines = scene.lines
const D = scene.duration
const row = (h) => [h.at, h.character, h.player, h.shotAt, h.park]

// The Beggar in the Hall: a hold at each of its four cuts. The camera reaches Antinous at 16.64 but
// he starts "The trial is over" at 16.54, so that hold comes before his line (16.24) while the film
// parks on his shot (16.79).
const three = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D, lines)
assert.deepEqual(three.map(row), [
  [2.49, 'penelope', 1, 2.34, 2.49], [4.4, 'antinous', 0, 4.25, 4.4],
  [14.37, 'odysseus', 2, 14.22, 14.37], [16.24, 'antinous', 0, 16.64, 16.79]])
for (const h of three) {
  assert.ok(!lines.some((l) => l.character === h.character && h.at >= l.start && h.at < l.end), `hold ${h.at} inside its own line`)
  assert.ok(h.at <= h.shotAt + 0.15 + 1e-9, `hold ${h.at} later than its cut`)
  const shot = shots.find((s) => s.start === h.shotAt)
  assert.ok(h.park >= shot.start && h.park < shot.end, `park ${h.park} outside its shot`)
}
// Doubled roles and a solo crew: same times
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 1 }, D, lines).map((h) => h.at), [2.49, 4.4, 14.37, 16.24])
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 0, odysseus: 0 }, D, lines).map((h) => h.player), [0, 0, 0, 0])
// Without lines: right after every cut, as before
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D).map((h) => h.at), [2.49, 4.4, 14.37, 16.79])

// Synthetic: c1 on screen 0-5, c2 from 5
const A = { c0: 0, c1: 1, c2: 2, c3: 3 }
const cut = [{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 20, character: 'c2' }]
const at2 = (ls) => shotHolds(cut, A, 20, ls).map((h) => h.at)
assert.deepEqual(shotHolds(cut, A, 20, [{ character: 'c2', start: 4.9, end: 6 }]).map(row), [[4.6, 'c2', 2, 5, 5.15]]) // owner's case
assert.deepEqual(at2([{ character: 'c2', start: 2.0, end: 6.0 }]), [5.15]) // own line long before the cut
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 7.0 }]), [5.15]) // reaction shot: someone else speaking
assert.deepEqual(at2([{ character: 'c2', start: 5.2, end: 6 }]), [4.9]) // own line right after the cut
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 4.8 }, { character: 'c2', start: 4.85, end: 6 }]), [4.8]) // back to back
assert.deepEqual(at2([{ character: 'c1', start: 4.0, end: 5.2 }, { character: 'c2', start: 4.9, end: 6 }]), [4.85]) // overlapping speech

// Never in the first second
assert.deepEqual(shotHolds([{ start: 0, end: 1.1, character: 'c1' }, { start: 1.1, end: 5, character: 'c2' }], A, 20,
  [{ character: 'c2', start: 0.9, end: 2 }]).map((h) => h.at), [1])
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

console.log('holds: all checks passed')
