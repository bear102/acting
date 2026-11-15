// Run: node frontend/src/stage/__checks__/chunks.check.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MAX_CHARS, chunkWords } from '../chunks.js'

const dir = fileURLToPath(new URL('../../../../scenes/', import.meta.url))
let longest = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  for (const l of JSON.parse(readFileSync(dir + f, 'utf8')).lines) {
    const words = l.text.split(' ')
    const chunks = chunkWords(words)
    assert.deepEqual(chunks.flat(), words, `${f}: words lost or reordered`)
    for (const c of chunks) {
      const s = c.join(' ')
      longest = Math.max(longest, s.length)
      assert.ok(c.length > 0, `${f}: empty chunk`)
      assert.ok(s.length <= MAX_CHARS || c.length === 1, `${f}: chunk too long: ${s}`)
    }
    if (chunks.length > 1) assert.ok(chunks.at(-1).join(' ').length >= 8, `${f}: stray tail in "${l.text}" -> ${JSON.stringify(chunks.map((c) => c.join(' ')))}`)
    if (process.argv[2] && chunks.length > 1) console.log(chunks.map((c) => c.join(' ')).join('  |  '))
  }
}
assert.deepEqual(chunkWords(['No?']), [['No?']])
assert.deepEqual(chunkWords("I'm looking for them. Anyone happen to come this way?".split(' ')).map((c) => c.join(' ')),
  ["I'm looking for them.", 'Anyone happen to come this way?'])
assert.deepEqual(chunkWords(['Supercalifragilisticexpialidociouslylongword', 'x']).flat().length, 2)
console.log(`chunks: all checks passed (longest chunk ${longest} chars)`)
