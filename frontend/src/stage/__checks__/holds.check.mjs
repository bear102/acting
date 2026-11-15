// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shotHolds } from '../holds.js'

const scene = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../scenes/beggar-in-the-hall.json', import.meta.url)), 'utf8'))
const shots = scene.reference.shots
const D = scene.duration

// The Beggar in the Hall: a hold right after each of its four cuts to a character
// (the opening crowd shot never holds)
const three = shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 2 }, D)
assert.deepEqual(three.map((h) => [h.at, h.character, h.player]),
  [[2.49, 'penelope', 1], [4.4, 'antinous', 0], [14.37, 'odysseus', 2], [16.79, 'antinous', 0]])
for (const h of three) {
  const shot = shots.find((s) => s.character === h.character && h.at >= s.start && h.at < s.end)
  assert.ok(shot && h.at - shot.start < 0.2, `hold ${h.at} is right after its cut`)
}

// Same cuts whoever plays the parts, including doubled roles and a solo crew
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 1, odysseus: 1 }, D).map((h) => h.at), [2.49, 4.4, 14.37, 16.79])
assert.deepEqual(shotHolds(shots, { antinous: 0, penelope: 0, odysseus: 0 }, D).map((h) => h.player), [0, 0, 0, 0])

// Crowd shots do not hold, and cutting back to the same character after one does not hold again
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
