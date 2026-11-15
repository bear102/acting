// Painted badge per kleos rank (names match backend/scoring.py RANKS). Unknown names -> null.
const BASE = '/art/generated/'
const RANK_ART = {
  'Swine of Circe': 'rank-swine-of-circe',
  'Lotus-Eater': 'rank-lotus-eater',
  'Oarsman of Ithaca': 'rank-oarsman-of-ithaca',
  'Hero of Troy': 'rank-hero-of-troy',
  'Favored of Athena': 'rank-favored-of-athena',
  'Equal to the Gods': 'rank-equal-to-the-gods',
}
export const rankArt = (name) => (RANK_ART[name] ? `${BASE}${RANK_ART[name]}.webp` : null)

// Round god medallions for the council of judges.
export const godArt = (key) => `${BASE}god-${key}.webp`
