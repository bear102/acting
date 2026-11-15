// A random Homeric crew name for groups that skip the name field, so the Hall is not full of "Nameless Crew".
const ADJECTIVES = [
  'Wine-Dark', 'Bronze-Clad', 'Swift-Footed', 'Grey-Eyed', 'Storm-Tossed', 'Much-Enduring', 'Rosy-Fingered',
  'Salt-Crusted', 'Horse-Taming', 'Well-Greaved', 'Sea-Worn', 'Sleepless', 'Honey-Voiced', 'Far-Shooting',
  'Loud-Roaring', 'Long-Haired', 'Godlike', 'Shipwrecked',
]
const NOUNS = [
  'Oarsmen', 'Wanderers', 'Suitors', 'Sirens', 'Helmsmen', 'Castaways', 'Bards', 'Shades', 'Swineherds',
  'Spearmen', 'Ithacans', 'Phaeacians', 'Shipmates', 'Tricksters', 'Stowaways', 'Myrmidons', 'Argonauts',
  'Cyclopes',
]

const pick = (list) => list[Math.floor(Math.random() * list.length)]

// Longest possible result is 28 characters, inside the 32-character team name limit.
export function rollCrewName() {
  return `The ${pick(ADJECTIVES)} ${pick(NOUNS)}`
}
