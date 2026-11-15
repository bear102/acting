// Holds: during a take of a film scene, the stage freezes for a moment whenever someone is about to
// start speaking, so they can get in place first: the others step out of frame and the speaker
// strikes the actor's pose. A hold always means "you are up next", and never interrupts speech.
//
// Speech is cut into phrases: each script line, split further at the long silences inside it (found
// in the film's speech mask) when the line holds more than one sentence. A phrase gets a hold when
//   - a different character spoke before it (a new turn), or
//   - the same character spoke before it, but the camera has come back to them in the meantime.
// The scene's opening words follow the countdown, so they get none. Somebody carrying on in the same
// shot gets no hold, and neither does a cut to someone who stays
// silent (a reaction shot), nor a cut in the middle of a sentence.
//
// Where the hold lands, inside the silence before the phrase:
//   - the camera cut to the speaker shortly before the phrase -> right after that cut
//   - the camera reaches the speaker only after they start (films often cut late) -> just before the
//     phrase, with the film panel parked on the first frame of their shot (`park`)
//   - no cut to the speaker (wide shot, off-screen voice)      -> just before the phrase
//
// While a hold lasts, the whole take clock stops (film, prompter, feature sampling, audio and video
// recording), so the recording stays on the film's timeline and scoring is unaffected.

export const HOLD_MS = 3000 // a full 3, 2, 1
const LEAD_IN_S = 1.0 // no hold in the first second: players have just taken their places
const OPENING_S = 4.0 // the scene's first words get a hold only when they come this late: the countdown covers them otherwise
const TAIL_S = 1.0 // nor in the last second: the scene is about to finish anyway
const AFTER_CUT_S = 0.15 // far enough past a cut that the parked film shows the new shot
const PRE_PHRASE_S = 0.3 // a hold with no cut to follow lands this long before the phrase
const CUT_BEFORE_S = 2.0 // a cut to the speaker this long before the phrase still places the hold
const CUT_LATE_S = 1.0 // the camera may reach the speaker up to this long after they start
const RETURN_S = 0.5 // "the camera came back": the cut may fall this long before their last phrase ended
const MIN_GAP_S = 1.0 // holds closer than this: only the later one is kept
const MIN_SHOT_S = 0.5 // shorter shots are flashes (cut-detection noise): ignored
const MIN_SILENCE_S = 0.8 // a silence this long inside a line separates two phrases

const num = (v) => typeof v === 'number' && Number.isFinite(v)

// How many sentences a line holds: it is split into at most that many phrases.
const sentences = (text) => String(text ?? '').split(/[.?!…]+["'”’)\]]*(?:\s+|$)/).filter((p) => /\w/.test(p)).length

/**
 * The scene's speech as phrases, in order: [{ character, start, end }].
 * speech: the film's speech mask (booleans at `fps`), or nothing: then every line is one phrase.
 */
export function phrases(lines, speech, fps) {
  const out = []
  const usable = (Array.isArray(lines) ? lines : []).filter((l) => l && num(l.start) && num(l.end) && l.end > l.start)
  const mask = Array.isArray(speech) && num(fps) && fps > 0 ? speech : null
  for (const l of usable) {
    const splits = [] // [silenceStart, silenceEnd] inside the line
    const most = sentences(l.text) - 1
    if (mask && most > 0) {
      const a = Math.max(0, Math.round(l.start * fps))
      const b = Math.min(mask.length, Math.round(l.end * fps))
      let i = a
      while (i < b && !mask[i]) i++ // the line's first speech
      let quiet = -1
      for (; i < b; i++) {
        if (!mask[i]) { if (quiet < 0) quiet = i; continue }
        if (quiet >= 0 && (i - quiet) / fps >= MIN_SILENCE_S) splits.push([quiet / fps, i / fps])
        quiet = -1
      }
      splits.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).splice(most) // the longest silences win
      splits.sort((x, y) => x[0] - y[0])
    }
    let start = l.start
    for (const [q0, q1] of splits) {
      out.push({ character: l.character, start, end: q0 })
      start = q1
    }
    out.push({ character: l.character, start, end: l.end })
  }
  return out.filter((p) => p.end > p.start).sort((a, b) => a.start - b.start)
}

/**
 * Times (scene seconds) at which to hold, and who is about to speak.
 * shots: scene.reference.shots = [{ start, end, character|null }]; character null = crowd/wide shot.
 * assignments: { characterId: playerIndex }. lines: scene.lines = [{ character, text, start, end }].
 * speech: { mask, fps } = the film's speech mask, to find the breaks inside a line (optional).
 * Shots may be missing or wrong (cut detection misses cuts): holds then simply come before the phrase.
 * -> [{ at, character, player, shotAt, park }] sorted by time; shotAt = the cut that brought the
 *    camera to the speaker (or null), park = the film frame to show during the hold.
 */
export function shotHolds(shots, assignments, duration, lines = [], speech = null) {
  if (!assignments || !num(duration)) return []
  const talk = phrases(lines, speech?.mask, speech?.fps)
  const speaking = (t) => talk.find((s) => t > s.start && t < s.end)

  // Cuts that bring the camera to a different character. Crowd shots and flashes are not cuts to
  // anyone and do not change who was last on screen.
  const cuts = []
  let last = null
  const usable = (Array.isArray(shots) ? shots : []).filter((s) => s && num(s.start) && num(s.end))
  for (const s of usable.sort((a, b) => a.start - b.start)) {
    if (!s.character || s.end - s.start < MIN_SHOT_S) continue
    if (s.character !== last && s.start > 0) cuts.push(s)
    last = s.character
  }

  const out = []
  talk.forEach((P, k) => {
    const C = P.character
    if (!(C in assignments)) return
    const prev = talk[k - 1]
    // The cut that brings the camera to the speaker for this phrase: shortly before it, or late
    const cut = cuts.findLast((s) => s.character === C && s.start >= P.start - CUT_BEFORE_S
      && s.start <= P.start + CUT_LATE_S && s.end > P.start)
    if (!prev && P.start < OPENING_S) return
    const sameSpeaker = prev && prev.character === C
    if (sameSpeaker && !(cut && cut.start >= prev.end - RETURN_S)) return // carrying on: no hold

    // In the silence before the phrase: right after the cut if it came first, else just before the phrase
    const latest = P.start - 0.05
    let at = cut && cut.start + AFTER_CUT_S <= latest ? cut.start + AFTER_CUT_S : P.start - PRE_PHRASE_S
    for (let i = 0; i < 4; i++) { // never interrupt whoever is still talking
      const x = speaking(at)
      if (!x) break
      at = x.end
    }
    if (prev && at < prev.end && prev.end <= P.start) at = prev.end
    if (at > P.start || speaking(at)) return // people talking over each other: no room for a hold
    if (at < LEAD_IN_S || at > duration - TAIL_S) return
    while (out.length && at - out[out.length - 1].at < MIN_GAP_S) out.pop() // the later hold wins
    out.push({
      at: +at.toFixed(3), character: C, player: assignments[C],
      shotAt: cut ? +cut.start.toFixed(3) : null,
      park: +(cut ? Math.max(at, cut.start + AFTER_CUT_S) : at).toFixed(3),
    })
  })
  return out
}

/** The holds of a scene as the API serves it. */
export function sceneHolds(scene, assignments) {
  const ref = scene?.reference
  return shotHolds(ref?.shots, assignments, scene?.duration, scene?.lines, { mask: ref?.speech, fps: ref?.fps })
}

// On/off setting for the holds, remembered in this browser (on by default).
const PREF_KEY = 'trials.shotPauses'
export function readHoldsPref() {
  try { return localStorage.getItem(PREF_KEY) !== '0' } catch { return true }
}
export function writeHoldsPref(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* storage blocked */ }
}
