// Run: node frontend/src/stage/__checks__/holds.check.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { phrases, sceneHolds, shotHolds } from '../holds.js'

const scenesDir = fileURLToPath(new URL('../../../../scenes/', import.meta.url))
// A scene as the API serves it: the speech mask sits at reference.speech
const load = (f) => {
  const s = JSON.parse(readFileSync(scenesDir + f, 'utf8'))
  if (s.reference) s.reference.speech = s.reference.audio?.speech
  return s
}
const cast = (s) => Object.fromEntries(s.characters.map((c, i) => [c.id, i]))
const row = (h) => [h.at, h.character, h.shotAt, h.park]
const ats = (hs) => hs.map((h) => h.at)

// Where Are Your Shipmates? (the owner's reference scene)
// - before Odysseus's "No?" and before Circe's "You can only reach this spot by sea" (no usable shot
//   data there: the hold comes just before the phrase)
// - before Circe's "So where are your shipmates?", once the camera is back on her
// - on Odysseus for "I'm looking for them", again for "Anyone happen to come this way?" after the
//   cutaway to Circe (the camera is late both times: the film parks on his shot), and right after the
//   cut to him before "But you prepared all this food"
// - none at the cut to Circe at 16.4: she stays silent
const ship = load('circe-where-are-your-shipmates.json')
assert.deepEqual(sceneHolds(ship, cast(ship)).map(row), [
  [4.97, 'odysseus', null, 4.97], [6.47, 'circe', null, 6.47], [9.5, 'circe', 9.94, 10.09],
  [12.47, 'odysseus', 12.67, 12.82], [14.9, 'odysseus', 15.54, 15.69], [19.15, 'odysseus', 19, 19.15]])

// The Beggar in the Hall: a hold before every change of speaker, none before the opening line
const beggar = load('beggar-in-the-hall.json')
assert.deepEqual(sceneHolds(beggar, { antinous: 0, penelope: 1, odysseus: 2 }).map(row), [
  [4.68, 'odysseus', null, 4.68], [10.66, 'antinous', null, 10.66], [13.52, 'penelope', null, 13.52],
  [16.24, 'antinous', 16.64, 16.79]])
// Doubled roles and a solo crew: same times
assert.deepEqual(ats(sceneHolds(beggar, { antinous: 0, penelope: 1, odysseus: 1 })), [4.68, 10.66, 13.52, 16.24])
assert.deepEqual(sceneHolds(beggar, { antinous: 0, penelope: 0, odysseus: 0 }).map((h) => h.player), [0, 0, 0, 0])

// Every film scene: no hold ever interrupts speech, each comes before its speaker's phrase, limits hold
for (const f of readdirSync(scenesDir).filter((n) => n.endsWith('.json'))) {
  const sc = load(f)
  if (!sc.reference?.shots) continue
  const talk = phrases(sc.lines, sc.reference.speech, sc.reference.fps)
  const hs = sceneHolds(sc, cast(sc))
  assert.ok(hs.length > 0, `${f} has no holds`)
  hs.forEach((h, i) => {
    const tag = `${f} hold ${h.at}`
    assert.ok(!talk.some((p) => h.at > p.start && h.at < p.end), `${tag} interrupts speech`)
    const next = talk.find((p) => p.start >= h.at)
    assert.ok(next && next.character === h.character && next.start - h.at <= 2.2, `${tag} is not right before its speaker`)
    assert.ok(h.at >= 1 && h.at <= sc.duration - 1, `${tag} in the first or last second`)
    assert.ok(h.park >= h.at, `${tag} parks on a frame already past`)
    if (h.shotAt != null) {
      const shot = sc.reference.shots.find((s) => s.start === h.shotAt)
      assert.equal(shot.character, h.character, `${tag} names the wrong shot`)
      assert.ok(h.park >= shot.start && h.park < shot.end, `${tag} parks outside its shot`)
    }
    if (i) assert.ok(h.at - hs[i - 1].at >= 1, `${tag} too close to the hold before`)
  })
}

// ---- Synthetic: c1 speaks 2-4, c2 answers 6-8
const A = { c1: 0, c2: 1 }
const talk2 = [{ character: 'c1', text: 'a', start: 2, end: 4 }, { character: 'c2', text: 'b', start: 6, end: 8 }]
const H = (shots, lines = talk2, speech) => shotHolds(shots, A, 20, lines, speech)
// No shot data: just before the phrase
assert.deepEqual(H(undefined).map(row), [[5.7, 'c2', null, 5.7]])
// The camera cuts to the speaker in the silence before: right after the cut
assert.deepEqual(H([{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 20, character: 'c2' }]).map(row), [[5.15, 'c2', 5, 5.15]])
// The camera is late: before the phrase, film parked on the speaker's shot
assert.deepEqual(H([{ start: 0, end: 6.4, character: 'c1' }, { start: 6.4, end: 20, character: 'c2' }]).map(row), [[5.7, 'c2', 6.4, 6.55]])
// The camera has been on the speaker for a while (cut mid-sentence long before): before the phrase
assert.deepEqual(H([{ start: 0, end: 3, character: 'c1' }, { start: 3, end: 20, character: 'c2' }]).map(row), [[5.7, 'c2', null, 5.7]])
// Their shot is over by the time they speak: it does not place the hold
assert.deepEqual(H([{ start: 0, end: 4.5, character: 'c1' }, { start: 4.5, end: 5.5, character: 'c2' }, { start: 5.5, end: 20, character: 'c1' }]).map(row), [[5.7, 'c2', null, 5.7]])
// A flash of the speaker (< 0.5 s) is not a cut to them
assert.deepEqual(H([{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 5.3, character: 'c2' }, { start: 5.3, end: 20, character: 'c1' }]).map(row), [[5.7, 'c2', null, 5.7]])
// The cut comes while the other is still talking: the hold waits for them to finish
assert.deepEqual(ats(H([{ start: 0, end: 5, character: 'c1' }, { start: 5, end: 20, character: 'c2' }],
  [{ character: 'c1', start: 2, end: 5.6 }, { character: 'c2', start: 6, end: 8 }])), [5.6])

// A reaction shot (cut to someone who stays silent) and a cut mid-sentence: no hold
const one = [{ character: 'c1', text: 'a', start: 5, end: 12 }]
assert.deepEqual(ats(H([{ start: 0, end: 7, character: 'c1' }, { start: 7, end: 9, character: 'c2' }, { start: 9, end: 20, character: 'c1' }], one)), [4.7])
// The opening words get a hold only when they come late
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 2.2, end: 3 }])), [])
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 4.2, end: 5 }])), [3.9])

// The same speaker carrying on: no hold...
const again = [{ character: 'c1', text: 'a', start: 5, end: 6 }, { character: 'c1', text: 'b', start: 9, end: 10 }]
assert.deepEqual(ats(H(undefined, again)), [4.7])
assert.deepEqual(ats(H([{ start: 0, end: 20, character: 'c1' }], again)), [4.7])
// ...unless the camera has come back to them in the meantime
assert.deepEqual(H([{ start: 0, end: 6.5, character: 'c1' }, { start: 6.5, end: 8, character: 'c2' }, { start: 8, end: 20, character: 'c1' }], again).map(row),
  [[4.7, 'c1', null, 4.7], [8.15, 'c1', 8, 8.15]])
// ...a cut back to them while they were still mid-phrase does not count
assert.deepEqual(ats(H([{ start: 0, end: 5.2, character: 'c2' }, { start: 5.2, end: 20, character: 'c1' }], again)), [4.7])

// A line with two sentences and a long silence inside is two phrases (speech mask at 10 fps)
const mask = Array.from({ length: 200 }, (_, i) => (i >= 50 && i < 65) || (i >= 90 && i < 110))
const two = [{ character: 'c1', text: 'One thing. Another thing?', start: 5, end: 11 }]
assert.deepEqual(phrases(two, mask, 10), [{ character: 'c1', start: 5, end: 6.5 }, { character: 'c1', start: 9, end: 11 }])
assert.deepEqual(phrases(two), [{ character: 'c1', start: 5, end: 11 }]) // no mask: the whole line
assert.deepEqual(phrases([{ ...two[0], text: 'One long thing' }], mask, 10).length, 1) // one sentence: never split
const away = [{ start: 0, end: 7, character: 'c1' }, { start: 7, end: 8.5, character: 'c2' }, { start: 8.5, end: 20, character: 'c1' }]
assert.deepEqual(ats(H(away, two, { mask, fps: 10 })), [4.7, 8.65]) // camera back for the second sentence
assert.deepEqual(ats(H(away, two)), [4.7]) // without the mask it is one sentence, cut mid-way
assert.deepEqual(ats(H([{ start: 0, end: 20, character: 'c1' }], two, { mask, fps: 10 })), [4.7]) // same shot throughout
// a short breath is not a break
const breath = Array.from({ length: 200 }, (_, i) => (i >= 50 && i < 75) || (i >= 80 && i < 110))
assert.deepEqual(phrases(two, breath, 10).length, 1)

// Back to back with no gap: at the boundary. Talking over each other: no hold
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 2, end: 6 }, { character: 'c2', start: 6, end: 8 }])), [6])
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 2, end: 6.3 }, { character: 'c2', start: 6, end: 8 }])), [])
// A character nobody plays gets no hold, but still counts as the speaker before
assert.deepEqual(ats(shotHolds(undefined, { c2: 1 }, 20, talk2)), [5.7])
assert.deepEqual(ats(shotHolds(undefined, { c1: 0 }, 20, talk2)), [])
// Holds closer than 1 s: the later wins
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 2, end: 4 }, { character: 'c2', start: 4.5, end: 4.6 }, { character: 'c1', start: 5.2, end: 7 }])), [4.9])
// Nothing in the first or last second
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 0.2, end: 0.8 }, { character: 'c2', start: 1.2, end: 2 }])), [])
assert.deepEqual(ats(H(undefined, [{ character: 'c1', start: 2, end: 4 }, { character: 'c2', start: 19.5, end: 20 }])), [])

// Broken scene data is skipped, never thrown on; the caller's arrays are left alone
const messy = [{ start: 5, end: 20, character: 'c2' }, null, { start: 'x', end: 3, character: 'c1' }, { start: 0, end: 5, character: 'c1' }]
const before = JSON.stringify(messy)
assert.deepEqual(ats(H(messy, [null, ...talk2, { character: 'c2', start: NaN, end: 6 }, { character: 'c2', start: 7, end: 6 }, { character: 'c2' }])), [5.15])
assert.equal(JSON.stringify(messy), before)
assert.deepEqual(shotHolds(undefined, null, 20, talk2), [])
assert.deepEqual(shotHolds(undefined, A, undefined, talk2), [])
assert.deepEqual(shotHolds(undefined, A, 20, 'nope'), [])
assert.deepEqual(ats(H(undefined, talk2, { mask: 'nope', fps: 0 })), [5.7])
assert.deepEqual(sceneHolds(null, A), [])
assert.deepEqual(sceneHolds({ duration: 20, lines: talk2 }, A).map(row), [[5.7, 'c2', null, 5.7]])

console.log('holds: all checks passed')
