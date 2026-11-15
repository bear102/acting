// Pose-frame math shared by the live stage (ghosts, guide cards, favor meters).
// Frame format (contract with backend): 7 landmarks [nose, Lsh, Rsh, Lel, Rel, Lwr, Rwr]
// x [x, y, visibility] = 21 floats, or null. Legacy 14-float frames (no visibility) are accepted.

export const VIS = 0.5
// Must match POSE_SCALE in backend/features.py (live meter == final grade)
export const POSE_SCALE = 0.55
export const REF_ASPECT = 16 / 9 // film clips are widescreen

/** Frame -> [{x, y, v}] x7, or null. */
export function unpack(frame) {
  if (!frame) return null
  const stride = frame.length >= 21 ? 3 : 2
  const pts = []
  for (let i = 0; i < 7; i++) {
    pts.push({ x: frame[i * stride], y: frame[i * stride + 1], v: stride === 3 ? frame[i * stride + 2] : 1 })
  }
  return pts
}

/** Origin = shoulder midpoint, unit = shoulder width (plain normalized coords, as the backend does). */
export function normalize(frame) {
  const p = unpack(frame)
  if (!p) return null
  // Screen order, matching backend/features.py: a film actor's anatomical left shoulder is on
  // screen-right, a mirrored player's is on screen-left. Swap L/R pairs so index 1 is always
  // the screen-left shoulder, otherwise a perfect imitation reads as a mismatch.
  if (p[1].x > p[2].x) {
    for (const [a, b] of [[1, 2], [3, 4], [5, 6]]) [p[a], p[b]] = [p[b], p[a]]
  }
  const mx = (p[1].x + p[2].x) / 2
  const my = (p[1].y + p[2].y) / 2
  const w = Math.hypot(p[1].x - p[2].x, p[1].y - p[2].y)
  if (w < 1e-3) return null
  return p.map((q) => ({ x: (q.x - mx) / w, y: (q.y - my) / w, v: q.v }))
}

/** Mean distance over landmarks visible in both frames; null when not comparable. */
export function frameDistance(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return null
  if (!(na[1].v > VIS && na[2].v > VIS && nb[1].v > VIS && nb[2].v > VIS)) return null
  let sum = 0
  let n = 0
  for (let i = 0; i < 7; i++) {
    if (na[i].v > VIS && nb[i].v > VIS) {
      sum += Math.hypot(na[i].x - nb[i].x, na[i].y - nb[i].y)
      n++
    }
  }
  return n >= 3 ? sum / n : null
}

/** 0-100, or null when not comparable. */
export function similarity(a, b) {
  const d = frameDistance(a, b)
  return d === null ? null : 100 / (1 + (d / POSE_SCALE) ** 2)
}

// Per-track lookup tables: prev[i] = last non-null index <= i, next[i] = first non-null index >= i.
const tables = new WeakMap()
function lookup(track) {
  let t = tables.get(track)
  if (!t) {
    const n = track.length
    const prev = new Int32Array(n).fill(-1)
    const next = new Int32Array(n).fill(-1)
    let last = -1
    for (let i = 0; i < n; i++) { if (track[i]) last = i; prev[i] = last }
    last = -1
    for (let i = n - 1; i >= 0; i--) { if (track[i]) last = i; next[i] = last }
    t = { prev, next }
    tables.set(track, t)
  }
  return t
}

/**
 * Reference frame for a character at time t.
 * Exact frame if on screen; else nearest within +-1.5s; else most recent (or first) frame, flagged resting.
 */
export function refFrameAt(track, t, fps = 10) {
  if (!track || track.length === 0) return null
  const i = Math.max(0, Math.min(track.length - 1, Math.round(t * fps)))
  if (track[i]) return { frame: track[i], resting: false }
  const { prev, next } = lookup(track)
  const win = Math.round(1.5 * fps)
  const p = prev[i]
  const q = next[i]
  const dp = p >= 0 ? i - p : Infinity
  const dq = q >= 0 ? q - i : Infinity
  if (Math.min(dp, dq) <= win) return { frame: track[dp <= dq ? p : q], resting: false }
  if (p >= 0) return { frame: track[p], resting: true }
  if (q >= 0) return { frame: track[q], resting: true }
  return null
}

/** Who the scene is "about" at time t: the speaking character, else the one on screen. */
export function activeCharacter(scene, t) {
  if (t == null) return null
  const line = scene.lines.find((l) => t >= l.start - 0.2 && t <= l.end + 0.3)
  if (line) return line.character
  const shot = scene.reference?.shots?.find((s) => t >= s.start && t < s.end)
  return shot?.character || null
}

/** Character a given player should be mirroring right now. */
export function guideCharacterFor(scene, chars, t) {
  const active = activeCharacter(scene, t)
  if (active && chars.includes(active)) return active
  const pose = scene.reference?.pose
  const fps = scene.reference?.fps || 10
  if (pose) {
    for (const c of chars) {
      const r = refFrameAt(pose[c], t ?? 0, fps)
      if (r && !r.resting) return c
    }
  }
  return chars[0]
}
