// Multi-person identity tracking for the stage. Pure JS (no MediaPipe import) so it can be
// unit-checked in node. Fixes the "glitches with 3 people" problems:
//   * duplicate detections of one body  -> non-max suppression
//   * identities swapping between frames -> optimal (brute-force) assignment on predicted
//     position + size, with a gate, instead of re-sorting by x every frame
//   * flicker when a detection drops     -> hold the last pose/face for a few hundred ms
//   * landmark jitter                    -> One-Euro filter per landmark
// Players are numbered left->right on screen. That order is settled BEFORE the take (while
// players line up) and then locked, so people crossing mid-take keep their identity.

export const HOLD_MS = 350 // keep showing/sampling an undetected player this long
export const LOST_MS = 1200 // after this, the slot is free to re-acquire anyone
const FACE_HOLD_MS = 300
const GATE = 2.2 // max match cost, in shoulder widths
const NMS_FRAC = 0.4 // detections closer than this x shoulder width are the same body
const SETTLE_FRAMES = 12 // consecutive frames of "wrong order" before re-numbering (pre-take)

// ---------------------------------------------------------------- One-Euro filter
class OneEuro {
  constructor(minCutoff = 1.5, beta = 1.5, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
    this.x = null
    this.dx = 0
    this.t = null
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value, tMs) {
    if (this.x === null) { this.x = value; this.t = tMs; return value }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000)
    this.t = tMs
    const dx = (value - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x)
    return this.x
  }
}

// ---------------------------------------------------------------- geometry
// Body summary in "height units": x is scaled by the aspect ratio so distances are isotropic.
// x is MIRRORED (as the audience sees the webcam), so "left" means screen-left.
export function bodyOf(lm, aspect) {
  const cx = (1 - (lm[11].x + lm[12].x) / 2) * aspect
  const cy = (lm[11].y + lm[12].y) / 2
  const w = Math.hypot((lm[11].x - lm[12].x) * aspect, lm[11].y - lm[12].y)
  return { cx, cy, w: Math.max(w, 0.02) }
}

/** Drop detections whose shoulder centre sits inside a bigger body (same person twice). */
export function suppressDuplicates(poses, aspect) {
  const items = poses.map((lm) => ({ lm, b: bodyOf(lm, aspect) })).sort((a, b) => b.b.w - a.b.w)
  const kept = []
  for (const it of items) {
    const dup = kept.some((k) => Math.hypot(k.b.cx - it.b.cx, k.b.cy - it.b.cy) < NMS_FRAC * Math.max(k.b.w, it.b.w))
    if (!dup) kept.push(it)
  }
  return kept
}

/**
 * Optimal assignment of rows to columns minimizing total cost; a row may stay unmatched at
 * cost `gate`, and pairs costing >= gate are not allowed. Brute force: fine for <= 5 x 6.
 * Returns an array: row -> column index or -1.
 */
export function assign(cost, gate) {
  const n = cost.length
  const m = n ? cost[0].length : 0
  let best = Infinity
  let bestPick = Array(n).fill(-1)
  const pick = Array(n).fill(-1)
  const used = Array(m).fill(false)
  const rec = (i, acc) => {
    if (acc >= best) return
    if (i === n) { best = acc; bestPick = pick.slice(); return }
    for (let j = 0; j < m; j++) {
      if (used[j] || cost[i][j] >= gate) continue
      used[j] = true; pick[i] = j
      rec(i + 1, acc + cost[i][j])
      used[j] = false
    }
    pick[i] = -1
    rec(i + 1, acc + gate)
  }
  rec(0, 0)
  return bestPick
}

// ---------------------------------------------------------------- tracker
export class PlayerTracker {
  constructor(n, aspect = 16 / 9) {
    this.n = n
    this.aspect = aspect
    this.locked = false
    this.settle = 0
    this.tracks = Array.from({ length: n }, (_, i) => this.emptyTrack(i))
    this.lastDetections = 0
  }

  emptyTrack(i) {
    return {
      // nominal slot position (screen-left to right) used to (re)acquire a player
      home: ((i + 0.5) / this.n) * this.aspect,
      body: null, // {cx, cy, w}
      vel: { x: 0, y: 0 }, // height units per ms
      seen: -Infinity, // ms of last real detection
      raw: null, // last raw landmarks
      smooth: null, // last smoothed landmarks
      filters: null,
      face: null,
      faceSeen: -Infinity,
    }
  }

  setAspect(aspect) {
    if (aspect && Math.abs(aspect - this.aspect) > 1e-3) {
      this.tracks.forEach((t, i) => { t.home = ((i + 0.5) / this.n) * aspect })
      this.aspect = aspect
    }
  }

  /** Freeze identities (call at "Action!"). */
  lock() { this.locked = true }

  /**
   * Feed one frame of pose detections (MediaPipe landmark arrays). Returns, per player,
   * smoothed landmarks or null. Undetected players are held for HOLD_MS.
   */
  update(poses, now) {
    const dets = suppressDuplicates(poses, this.aspect)
    this.lastDetections = dets.length
    const active = []
    const free = []
    this.tracks.forEach((t, i) => (now - t.seen <= LOST_MS && t.body ? active : free).push(i))

    // 1) keep existing identities: optimal match of active tracks to detections
    const taken = new Set()
    if (active.length && dets.length) {
      const cost = active.map((ti) => {
        const t = this.tracks[ti]
        const dt = Math.min(now - t.seen, 300)
        const px = t.body.cx + t.vel.x * dt
        const py = t.body.cy + t.vel.y * dt
        return dets.map((d) => Math.hypot(d.b.cx - px, d.b.cy - py) / t.body.w + 0.5 * Math.abs(d.b.w - t.body.w) / t.body.w)
      })
      assign(cost, GATE).forEach((j, k) => {
        if (j >= 0) { taken.add(j); this.observe(active[k], dets[j], now) }
      })
    }

    // 2) new/lost players: pair remaining detections with free slots by screen order
    const rest = dets.map((d, j) => j).filter((j) => !taken.has(j))
    if (rest.length && free.length) {
      const cost = free.map((ti) => rest.map((j) => Math.abs(dets[j].b.cx - this.tracks[ti].home) / this.aspect))
      assign(cost, 10).forEach((k, f) => { if (k >= 0) this.observe(free[f], dets[rest[k]], now) })
    }

    if (!this.locked) this.settleOrder(now)
    return this.tracks.map((t) => (t.smooth && now - t.seen <= HOLD_MS ? t.smooth : null))
  }

  observe(ti, det, now) {
    const t = this.tracks[ti]
    if (t.body && now - t.seen < 300) {
      const dt = Math.max(1, now - t.seen)
      const a = 0.4
      t.vel.x = (1 - a) * t.vel.x + a * (det.b.cx - t.body.cx) / dt
      t.vel.y = (1 - a) * t.vel.y + a * (det.b.cy - t.body.cy) / dt
    } else {
      t.vel = { x: 0, y: 0 }
      t.filters = null // re-acquired: don't smooth from a stale position
    }
    t.body = det.b
    t.seen = now
    t.raw = det.lm
    if (!t.filters) t.filters = det.lm.map(() => [new OneEuro(), new OneEuro()])
    t.smooth = det.lm.map((p, k) => ({
      ...p,
      x: t.filters[k][0].filter(p.x, now),
      y: t.filters[k][1].filter(p.y, now),
    }))
  }

  /**
   * Before the take only: if everyone is visible but slot numbers don't match left->right
   * order for SETTLE_FRAMES frames in a row, renumber (so "Player 1 = leftmost" holds when
   * the take starts). Never runs once locked.
   */
  settleOrder(now) {
    const visible = this.tracks.every((t) => t.body && now - t.seen < 100)
    if (!visible) { this.settle = 0; return }
    const order = this.tracks.map((t, i) => i).sort((a, b) => this.tracks[a].body.cx - this.tracks[b].body.cx)
    if (order.every((ti, k) => ti === k)) { this.settle = 0; return }
    if (++this.settle < SETTLE_FRAMES) return
    const reordered = order.map((ti) => this.tracks[ti])
    reordered.forEach((t, i) => { t.home = ((i + 0.5) / this.n) * this.aspect })
    this.tracks = reordered
    this.settle = 0
  }

  /**
   * Assign face results to players by 2D distance between the face's nose tip and the
   * player's pose nose; hold the last blendshapes FACE_HOLD_MS. Returns blendshapes per player.
   */
  assignFaces(faces, blendshapes, now) {
    const ids = this.tracks.map((t, i) => i).filter((i) => this.tracks[i].smooth && now - this.tracks[i].seen <= HOLD_MS)
    if (ids.length && faces.length) {
      const cost = ids.map((i) => {
        const t = this.tracks[i]
        const nose = t.smooth[0]
        return faces.map((f) => Math.hypot((f[1].x - nose.x) * this.aspect, f[1].y - nose.y) / t.body.w)
      })
      assign(cost, 0.9).forEach((j, k) => {
        if (j >= 0 && blendshapes[j]) {
          this.tracks[ids[k]].face = blendshapes[j]
          this.tracks[ids[k]].faceSeen = now
        }
      })
    }
    return this.tracks.map((t) => (t.face && now - t.faceSeen <= FACE_HOLD_MS ? t.face : null))
  }

  /** For the debug overlay. */
  debug(now) {
    return this.tracks.map((t, i) => ({
      slot: i,
      age: t.seen === -Infinity ? null : Math.round(now - t.seen),
      held: t.seen !== -Infinity && now - t.seen > 0 && now - t.seen <= HOLD_MS,
      face: t.face && now - t.faceSeen <= FACE_HOLD_MS,
    }))
  }
}
