// Shot-change holds: during a take of a film scene, the stage freezes for a moment whenever the film
// cuts to a different player's character, so the others can step out of frame and the player now on
// screen can strike the actor's pose before the scene runs on.
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected.

export const HOLD_MS = 2500
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const TAIL_S = 1.0 // nor in the last second: the scene is about to end anyway

/**
 * Times (scene seconds) at which to hold, and who is on screen after each cut.
 * shots: scene.reference.shots = [{ start, end, character|null }]; character null = crowd/wide shot.
 * assignments: { characterId: playerIndex }.
 * A cut gets a hold only when the player on screen changes; crowd shots never trigger one and do not
 * reset who was last on screen. No holds for a crew of one (nobody else to clear the frame).
 * -> [{ at, character, player }] sorted by time.
 */
export function shotHolds(shots, assignments, duration, nPlayers) {
  if (!Array.isArray(shots) || nPlayers < 2) return []
  const out = []
  let lastPlayer = null
  for (const s of [...shots].sort((a, b) => a.start - b.start)) {
    if (!s.character || !(s.character in assignments)) continue
    const player = assignments[s.character]
    if (player !== lastPlayer && s.start >= LEAD_IN_S && s.start <= duration - TAIL_S) {
      // just after the cut, so the frozen film already shows the new shot
      out.push({ at: +(s.start + 0.05).toFixed(3), character: s.character, player })
    }
    lastPlayer = player
  }
  return out
}
