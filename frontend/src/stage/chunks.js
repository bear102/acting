// Long lines are shown a chunk at a time, so the prompter never grows into a block of text that
// pushes the film and camera around. A chunk is at most MAX_CHARS long and fits one row of the band.

export const MAX_CHARS = 36

const len = (words) => words.join(' ').length
const endsClause = (w) => /[,.;:?!…—]["'”’)]*$/.test(w)
const endsSentence = (w) => /[.?!]["'”’)]*$/.test(w)

/**
 * Split a line's words into chunks: [[word, ...], ...]. The fewest chunks that fit, chosen so they
 * are even in length (no stray last word) and break after punctuation where they can.
 */
export function chunkWords(words, max = MAX_CHARS) {
  const n = words.length
  if (len(words) <= max) return [words]
  const target = len(words) / Math.ceil(len(words) / max)
  // best[i] = cheapest way to chunk words[i..]; a chunk of one over-long word is allowed
  const best = Array(n + 1).fill(null)
  best[n] = { cost: 0, next: n }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j <= n; j++) {
      const size = len(words.slice(i, j))
      if (size > max && j > i + 1) break
      const uneven = ((size - target) / max) ** 2
      const midClause = j < n && !endsClause(words[j - 1]) ? 0.2 : 0 // breaking mid-clause costs a little
      const straddles = words.slice(i, j - 1).filter(endsSentence).length * 0.3 // so does a sentence end inside a chunk
      const cost = 1 + uneven + midClause + straddles + best[j].cost // 1 per chunk: fewest chunks first
      if (!best[i] || cost < best[i].cost) best[i] = { cost, next: j }
    }
  }
  const out = []
  for (let i = 0; i < n; i = best[i].next) out.push(words.slice(i, best[i].next))
  return out
}
