// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shotHolds } from '../holds.js'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../scenes/beggar-in-the-hall.json', import.meta.url)), 'utf8'))
const shots = scene.reference.shots
const D = scene.duration

// Three players, one role each. Without lines: every change of who is on screen holds
// (crowd opening skipped)
const three = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D, 3)
assert.deepEqual(three.map((h) => [h.at, h.character, h.player]),
  [[2.49, 'penelope', 1], [4.4, 'antinous', 0], [14.37, 'odysseus', 2], [16.79, 'antinous', 0]])

// With the script: never mid-line. 2.49 is inside Antinous's 1.66-3.96 and the Penelope shot ends
// at 4.25, so that cut is skipped; 14.37 waits for Penelope's line to end (16.12 -> 16.27)
const lines = scene.lines
const real = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D, 3, lines)
assert.deepEqual(real.map((h) => [h.at, h.character]), [[4.4, 'antinous'], [16.27, 'odysseus']])
for (const h of real) assert.ok(!lines.some((l) => h.at > l.start && h.at < l.end), `hold ${h.at} is mid-line`)

// Two players, Penelope + the Beggar doubled
const two = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 1 }, D, 2, lines)
assert.deepEqual(two.map((h) => h.player), [0, 1])
// ...but a cut between two characters of the same player does not hold
const sameP = shotHolds([{ start: 0, end: 3, character: 'penelope' }, { start: 3, end: 6, character: 'odysseus' }],
  { penelope: 1, odysseus: 1, antinous: 0 }, 10, 2)
assert.deepEqual(sameP, [])

// Solo crews never hold; crowd shots do not reset who was last on screen
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 0, odysseus: 0 }, D, 1), [])
const crowd = shotHolds([
  { start: 0, end: 2, character: 'antinous' }, { start: 2, end: 4, character: null },
  { start: 4, end: 6, character: 'antinous' }, { start: 6, end: 8, character: 'penelope' },
], { antinous: 0, penelope: 1 }, 10, 2)
assert.deepEqual(crowd.map((h) => h.at), [6.15])

// No hold in the first or last second, and none without shots
assert.deepEqual(shotHolds([{ start: 0.5, end: 2, character: 'penelope' }], { penelope: 1 }, 10, 2), [])
assert.deepEqual(shotHolds([{ start: 8.6, end: 10, character: 'penelope' }], { penelope: 1 }, 10, 2), [])
// a hold that cannot fit before its shot ends is skipped
assert.deepEqual(shotHolds([{ start: 3, end: 6, character: 'penelope' }], { penelope: 1 }, 10, 2, [{ start: 2, end: 5.9 }]), [])
assert.deepEqual(shotHolds(undefined, {}, 10, 2), [])

console.log('holds: all checks passed')
