// Character portrait medallions (Gemini-generated, keyed to real alpha) in /art/generated.
// Keyed by character id; a scene can override (e.g. Odysseus appears disguised as the beggar).
const BASE = '/art/generated/'
const BY_CHAR = {
  antinous: 'char-antinous', penelope: 'char-penelope', odysseus: 'char-odysseus',
  polyphemus: 'char-polyphemus', siren: 'char-siren', eurylochus: 'char-eurylochus',
  telemachus: 'char-telemachus', calypso: 'char-calypso', beggar: 'char-beggar',
}
const BY_SCENE = { 'beggar-in-the-hall': { odysseus: 'char-beggar' } }

export function charPortrait(sceneId, charId) {
  const name = BY_SCENE[sceneId]?.[charId] || BY_CHAR[charId]
  return name ? `${BASE}${name}.webp` : null
}
