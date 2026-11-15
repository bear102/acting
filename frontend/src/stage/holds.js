// Shot-change holds: during a take of a film scene, the stage freezes for a moment whenever the film
// cuts to a different player's character, so the others can step out of frame and the player now on
// screen can strike the actor's pose before the scene runs on.
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected.

export const HOLD_MS = 3000 // a full 3, 2, 1
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const TAIL_S = 1.5 // nor near the end: the scene is about to finish anyway
const AFTER_CUT_S = 0.15 // far enough past the cut that the parked film shows the new shot
const SHOT_TAIL_S = 0.3 // a hold must land this far before the shot ends, or it is skipped

/**
 * Times (scene seconds) at which to hold, and who is on screen after each cut.
 * shots: scene.reference.shots = [{ start, end, character|null }]; character null = crowd/wide shot.
 * assignments: { characterId: playerIndex }.
 * lines: scene.lines = [{ start, end }]: a hold never interrupts a line being spoken; it waits until
 * the line ends (if the shot is still running then), otherwise that cut gets no hold.
 * A cut gets a hold only when the player on screen changes; crowd shots never trigger one and do not
 * reset who was last on screen. No holds for a crew of one (nobody else to clear the frame).
 * -> [{ at, character, player }] sorted by time.
 */
export function shotHolds(shots, assignments, duration, nPlayers, lines = []) {
  if (!Array.isArray(shots) || nPlayers < 2) return []
  const out = []
  let lastPlayer = null
  for (const s of [...shots].sort((a, b) => a.start - b.start)) {
    if (!s.character || !(s.character in assignments)) continue
    const player = assignments[s.character]
    if (player !== lastPlayer && s.start >= LEAD_IN_S) {
      const at = clearOfLines(s.start + AFTER_CUT_S, lines)
      if (at <= s.end - SHOT_TAIL_S && at <= duration - TAIL_S) {
        out.push({ at: +at.toFixed(3), character: s.character, player })
      }
    }
    lastPlayer = player
  }
  return out
}

// Push t past any line being spoken at t (lines can run back to back, so repeat).
function clearOfLines(t, lines) {
  for (let moved = true; moved;) {
    moved = false
    for (const l of lines) {
      if (t >= l.start - 0.1 && t < l.end + 0.1) { t = l.end + 0.15; moved = true }
    }
  }
  return t
}
