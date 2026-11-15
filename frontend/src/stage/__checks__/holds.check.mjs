// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shotHolds } from '../holds.js'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../scenes/beggar-in-the-hall.json', import.meta.url)), 'utf8'))
const shots = scene.reference.shots
const D = scene.duration

// Three players, one role each: every change of who is on screen holds (crowd opening skipped)
const three = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D, 3)
assert.deepEqual(three.map((h) => [h.at, h.character, h.player]),
  [[2.39, 'penelope', 1], [4.3, 'antinous', 0], [14.27, 'odysseus', 2], [16.69, 'antinous', 0]])

// Two players, Penelope + the Beggar doubled: the player on screen still alternates in this scene
const two = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 1 }, D, 2)
assert.deepEqual(two.map((h) => h.player), [1, 0, 1, 0])
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
assert.deepEqual(crowd.map((h) => h.at), [6.05])

// No hold in the first or last second, and none without shots
assert.deepEqual(shotHolds([{ start: 0.5, end: 2, character: 'penelope' }], { penelope: 1 }, 10, 2), [])
assert.deepEqual(shotHolds([{ start: 9.5, end: 10, character: 'penelope' }], { penelope: 1 }, 10, 2), [])
assert.deepEqual(shotHolds(undefined, {}, 10, 2), [])

console.log('holds: all checks passed')
