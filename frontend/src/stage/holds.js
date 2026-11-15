// Shot-change holds: during a take of a film scene, the stage freezes at every cut to a different
// character, so the players can get ready for the new shot before anyone speaks: the others step out
// of frame and whoever is now on screen strikes the actor's pose.
//
// Films often cut late: the new character starts talking a moment BEFORE the camera reaches them.
// So when the incoming character has a line that starts just before (or right after) the cut, the
// hold moves to just before that line; it never falls inside a line spoken by the incoming character.
// During a hold the film panel parks on the first frame of the new shot (`park`), even when the hold
// comes slightly before the cut, so the player sees exactly what to match.
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected. A line that
// is mid-sentence at a cut (someone else speaking over a reaction shot) simply resumes after.

export const HOLD_MS = 3000 // a full 3, 2, 1
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const TAIL_S = 1.0 // nor in the last second: the scene is about to finish anyway
const AFTER_CUT_S = 0.15 // far enough past the cut that the parked film shows the new shot
const SPEAK_LEAD_S = 1.0 // the incoming character's line may start up to this long before the cut
const PRE_LINE_S = 0.3 // a moved hold lands this long before that line
const MIN_GAP_S = 1.5 // holds closer than this: only the later one is kept
const MIN_SHOT_S = 0.5 // shorter shots are flashes (cut-detection noise): ignored

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
  if (!Array.isArray(shots)) return []
  const sortedLines = [...(lines || [])].sort((a, b) => a.start - b.start)
  const out = []
  let last = null
  for (const s of [...shots].sort((a, b) => a.start - b.start)) {
    if (!s.character || !(s.character in assignments) || s.end - s.start < MIN_SHOT_S) continue
    const C = s.character
    const T = s.start
    if (C === last || T < LEAD_IN_S) { last = C; continue }
    last = C
    let at = T + AFTER_CUT_S
    // The camera is late if the incoming character's own line starts just before (or right after) the cut
    const own = sortedLines.find((l) => l.character === C && l.start >= T - SPEAK_LEAD_S && l.start < at + PRE_LINE_S)
    if (own) {
      let a = Math.min(at, own.start - PRE_LINE_S)
      for (const o of sortedLines) {
        if (o.character !== C && o.start < a && a < o.end) a = o.end // don't cut into the previous speaker
      }
      a = Math.max(LEAD_IN_S, Math.min(a, own.start - 0.05))
      at = Math.min(at, a)
    }
    if (at > duration - TAIL_S || at >= s.end) continue
    while (out.length && at - out[out.length - 1].at < MIN_GAP_S) out.pop() // the later hold wins
    out.push({ at: +at.toFixed(3), character: C, player: assignments[C], shotAt: +T.toFixed(3), park: +(T + AFTER_CUT_S).toFixed(3) })
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
