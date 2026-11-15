// Shot-change holds: during a take of a film scene, the stage freezes when the film cuts to a
// different character, so the players can get ready for the new shot: the others step out of frame
// and whoever is now on screen strikes the actor's pose.
//
// A hold never interrupts speech. Where it lands relative to the cut depends on who is talking:
//   - nobody is talking at the cut           -> right after the cut
//   - a line starts just around the cut      -> just before that line (films often cut late: the new
//     character starts talking a moment BEFORE the camera reaches them)
//   - someone is mid-sentence across the cut -> no hold, unless the sentence ends soon after the cut
//     and the shot goes on: then the hold waits for the end of the sentence (a little longer when the
//     new character is the next to speak)
// During a hold the film panel parks on the first frame of the new shot (`park`), even when the hold
// comes slightly before the cut, so the player sees exactly what to match.
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected.

export const HOLD_MS = 3000 // a full 3, 2, 1
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const TAIL_S = 1.0 // nor in the last second: the scene is about to finish anyway
const AFTER_CUT_S = 0.15 // far enough past the cut that the parked film shows the new shot
const SPEAK_LEAD_S = 1.0 // the incoming character's line may start up to this long before the cut
const PRE_LINE_S = 0.3 // a hold moved before the incoming character's line lands this long before it
const JUST_STARTED_S = 0.35 // a line this fresh at the hold: hold before it rather than a word into it
const BEFORE_S = 0.05 // ...this long before it
const MAX_WAIT_S = 1.5 // a hold may wait this long after the cut for a sentence to finish
const MAX_WAIT_SPEAKS_S = 3.0 // ...or this long when the new character speaks next in the shot
const BREATH_S = 0.5 // lines of one character closer than this are one stretch of speech
const MIN_LEFT_S = 0.6 // the new shot must stay on screen at least this long after the hold
const MIN_GAP_S = 1.5 // holds closer than this: only the later one is kept
const MIN_SHOT_S = 0.5 // shorter shots are flashes (cut-detection noise): ignored

const num = (v) => typeof v === 'number' && Number.isFinite(v)

// Stretches of continuous speech: every usable line, with one character's back-to-back lines joined.
function talkSpans(lines) {
  const spans = []
  const usable = (Array.isArray(lines) ? lines : []).filter((l) => l && num(l.start) && num(l.end) && l.end > l.start)
  for (const l of usable.sort((a, b) => a.start - b.start)) {
    const prev = spans.findLast((s) => s.character === l.character)
    if (prev && l.start - prev.end < BREATH_S) prev.end = Math.max(prev.end, l.end)
    else spans.push({ character: l.character, start: l.start, end: l.end })
  }
  return spans
}

/**
 * Times (scene seconds) at which to hold, and who is on screen after each cut.
 * shots: scene.reference.shots = [{ start, end, character|null }]; character null = crowd/wide shot.
 * assignments: { characterId: playerIndex }. lines: scene.lines = [{ character, start, end }].
 * Crowd/wide shots and flashes never hold and do not change who was last on screen, so cutting back
 * to the same character after one does not hold again.
 * -> [{ at, character, player, shotAt, park }] sorted by time; shotAt = the cut, park = the film
 *    frame to show during the hold.
 */
export function shotHolds(shots, assignments, duration, lines = []) {
  if (!Array.isArray(shots) || !assignments) return []
  const talk = talkSpans(lines)
  const speaking = (t) => talk.find((s) => t > s.start && t < s.end)
  const usable = shots.filter((s) => s && num(s.start) && num(s.end))
  const out = []
  let last = null
  for (const s of usable.sort((a, b) => a.start - b.start)) {
    if (!s.character || !(s.character in assignments) || s.end - s.start < MIN_SHOT_S) continue
    const C = s.character
    const T = s.start
    if (C === last || T < LEAD_IN_S) { last = C; continue }
    last = C
    const cut = T + AFTER_CUT_S
    let at = cut
    // The camera is late if the incoming character's own line starts just before (or right after) the cut
    const own = talk.find((l) => l.character === C && l.start >= T - SPEAK_LEAD_S && l.start < cut + PRE_LINE_S)
    if (own && own.start - PRE_LINE_S >= LEAD_IN_S) at = Math.min(at, own.start - PRE_LINE_S)
    // Never interrupt speech: step back before a line that has only just started, else wait for the
    // sentence to finish
    let waitedFor = null // whose sentence the hold waited out
    for (let i = 0; i < 4; i++) {
      const x = speaking(at)
      if (!x) break
      if (at - x.start <= JUST_STARTED_S && x.start - BEFORE_S >= LEAD_IN_S) at = x.start - BEFORE_S
      else { at = x.end; waitedFor = x.character }
    }
    if (speaking(at)) continue // overlapping speech all around the cut: no hold
    if (at < LEAD_IN_S || at > duration - TAIL_S) continue
    // The sentence runs on: the cut passes without a hold, unless it was someone else's and the new
    // character speaks later in this shot, in which case the hold still gets them ready
    const speaksNext = waitedFor !== C && talk.some((l) => l.character === C && l.start >= at && l.start < s.end)
    if (at - cut > (speaksNext ? MAX_WAIT_SPEAKS_S : MAX_WAIT_S)) continue
    if (s.end - Math.max(at, T) < MIN_LEFT_S) continue // the shot is nearly over by then
    while (out.length && at - out[out.length - 1].at < MIN_GAP_S) out.pop() // the later hold wins
    out.push({ at: +at.toFixed(3), character: C, player: assignments[C], shotAt: +T.toFixed(3), park: +Math.max(cut, at).toFixed(3) })
  }
  return out
}

// On/off setting for the holds, remembered in this browser (on by default).
const PREF_KEY = 'trials.shotPauses'
export function readHoldsPref() {
  try { return localStorage.getItem(PREF_KEY) !== '0' } catch { return true }
}
export function writeHoldsPref(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* storage blocked */ }
}
