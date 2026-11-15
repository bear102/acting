// Shot-change holds: during a take of a film scene, the stage freezes right after every cut to a
// different character, so the players can get ready for the new shot before anyone speaks: the
// others step out of frame and whoever is now on screen strikes the actor's pose.
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected. A line that
// is mid-sentence at a cut simply resumes where it stopped.

export const HOLD_MS = 3000 // a full 3, 2, 1
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const TAIL_S = 1.0 // nor in the last second: the scene is about to finish anyway
const AFTER_CUT_S = 0.15 // far enough past the cut that the parked film shows the new shot

/**
 * Times (scene seconds) at which to hold, and who is on screen after each cut.
 * shots: scene.reference.shots = [{ start, end, character|null }]; character null = crowd/wide shot.
 * assignments: { characterId: playerIndex }.
 * Every cut to a different named character holds, right after the cut. Crowd/wide shots never hold
 * and do not reset who was last on screen, so cutting back to the same character after a crowd
 * shot does not hold again.
 * -> [{ at, character, player }] sorted by time.
 */
export function shotHolds(shots, assignments, duration) {
  if (!Array.isArray(shots)) return []
  const out = []
  let last = null
  for (const s of [...shots].sort((a, b) => a.start - b.start)) {
    if (!s.character || !(s.character in assignments)) continue
    const at = s.start + AFTER_CUT_S
    if (s.character !== last && s.start >= LEAD_IN_S && at <= duration - TAIL_S && at < s.end) {
      out.push({ at: +at.toFixed(3), character: s.character, player: assignments[s.character] })
    }
    last = s.character
  }
  return out
}
