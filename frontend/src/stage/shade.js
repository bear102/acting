// Drawing the "Shades": outline figures built from a 7-landmark pose frame.
// Used both as the glowing ghost on top of each player and as black-figure vase art in the guide cards.
import { REF_ASPECT, VIS, unpack } from './pose.js'

/**
 * Body-relative figure in aspect-corrected units (shoulder width = 1, origin = shoulder midpoint).
 * Invisible limbs get a relaxed "hanging" default and are flagged so they can be drawn faint.
 */
export function figureUnits(frame, aspect = REF_ASPECT) {
  const p = unpack(frame)
  if (!p) return null
  const P = p.map((q) => ({ x: q.x * aspect, y: q.y, v: q.v }))
  const L = P[1]
  const R = P[2]
  const w = Math.hypot(R.x - L.x, R.y - L.y)
  if (w < 1e-4) return null
  const mid = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 }
  const rel = (q) => ({ x: (q.x - mid.x) / w, y: (q.y - mid.y) / w })
  const l = rel(L)
  const r = rel(R)
  const u = { x: r.x - l.x, y: r.y - l.y } // shoulder axis, unit length
  let n = { x: -u.y, y: u.x } // "down" the body
  const nose = rel(P[0])
  if (P[0].v > VIS && nose.x * n.x + nose.y * n.y > 0) n = { x: -n.x, y: -n.y }
  if (P[0].v <= VIS && n.y < 0) n = { x: -n.x, y: -n.y }
  const add = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k })

  const head = P[0].v > VIS ? nose : add({ x: 0, y: 0 }, n, -0.8)
  const arm = (sh, el, wr, side) => {
    const elV = el.v > VIS
    const wrV = wr.v > VIS
    const e = elV ? rel(el) : add(add(sh, n, 0.95), u, 0.08 * side)
    const h = wrV ? rel(wr) : add(add(e, n, 0.85), u, 0.04 * side)
    return { e, h, ghost: !elV || !wrV }
  }
  const la = arm(l, P[3], P[5], -1)
  const ra = arm(r, P[4], P[6], 1)
  return {
    l, r, head, n, u,
    hipL: add(add(l, n, 1.55), u, 0.12),
    hipR: add(add(r, n, 1.55), u, -0.12),
    hemL: add(add(l, n, 2.6), u, -0.05),
    hemR: add(add(r, n, 2.6), u, 0.05),
    la, ra,
  }
}

function toPx(f, map) {
  const m = (q) => map(q)
  return {
    l: m(f.l), r: m(f.r), head: m(f.head), hipL: m(f.hipL), hipR: m(f.hipR), hemL: m(f.hemL), hemR: m(f.hemR),
    la: { e: m(f.la.e), h: m(f.la.h), ghost: f.la.ghost },
    ra: { e: m(f.ra.e), h: m(f.ra.h), ghost: f.ra.ghost },
  }
}

function bodyPath(ctx, F) {
  // Chiton: shoulders flaring down to a hem
  ctx.beginPath()
  ctx.moveTo(F.l.x, F.l.y)
  ctx.lineTo(F.r.x, F.r.y)
  ctx.quadraticCurveTo(F.hipR.x, F.hipR.y, F.hemR.x, F.hemR.y)
  ctx.lineTo(F.hemL.x, F.hemL.y)
  ctx.quadraticCurveTo(F.hipL.x, F.hipL.y, F.l.x, F.l.y)
  ctx.closePath()
}

function limb(ctx, a, b, c) {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.stroke()
}

/** Mix gold -> green-gold by match 0..100. */
export function favorColor(match, alpha = 1) {
  const k = Math.max(0, Math.min(1, ((match ?? 0) - 35) / 50))
  const c = [232 + (150 - 232) * k, 184 + (232 - 184) * k, 74 + (110 - 74) * k].map(Math.round)
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/**
 * Glowing translucent ghost anchored to a live player's shoulders.
 * lm = MediaPipe landmarks of the player (raw, unmirrored); canvas shows the mirrored image.
 */
export function drawGhostOnPlayer(ctx, frame, lm, w, h, { match = null, resting = false } = {}) {
  if (!frame || !lm) return
  const f = figureUnits(frame)
  if (!f) return
  const ls = { x: (1 - lm[11].x) * w, y: lm[11].y * h }
  const rs = { x: (1 - lm[12].x) * w, y: lm[12].y * h }
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  if (sw < 8) return
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
  const F = toPx(f, (q) => ({ x: mid.x + q.x * sw, y: mid.y + q.y * sw }))
  const alpha = resting ? 0.35 : 0.85
  const col = favorColor(match, alpha)
  const glow = 8 + Math.max(0, (match ?? 0) - 40) * 0.5

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = favorColor(match, 1)
  ctx.shadowBlur = resting ? 4 : glow
  // translucent body
  bodyPath(ctx, F)
  ctx.fillStyle = favorColor(match, resting ? 0.05 : 0.12)
  ctx.fill()
  ctx.setLineDash([sw * 0.12, sw * 0.08])
  ctx.strokeStyle = col
  ctx.lineWidth = Math.max(2, sw * 0.04)
  ctx.stroke()
  ctx.setLineDash([])
  // arms
  for (const [s, a] of [[F.l, F.la], [F.r, F.ra]]) {
    ctx.globalAlpha = a.ghost ? 0.4 : 1
    ctx.strokeStyle = col
    ctx.lineWidth = Math.max(3, sw * 0.09)
    limb(ctx, s, a.e, a.h)
    ctx.beginPath()
    ctx.arc(a.h.x, a.h.y, Math.max(3, sw * 0.07), 0, Math.PI * 2)
    ctx.fillStyle = col
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // head
  ctx.beginPath()
  ctx.arc(F.head.x, F.head.y, sw * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = favorColor(match, resting ? 0.05 : 0.14)
  ctx.fill()
  ctx.strokeStyle = col
  ctx.lineWidth = Math.max(2, sw * 0.04)
  ctx.stroke()
  ctx.restore()
}

/**
 * Black-figure vase painting of a pose, fit into a card canvas (CSS px w x h).
 * Black silhouette with clay-coloured "incised" detail lines and a gold rim.
 */
export function drawVaseFigure(ctx, frame, w, h, { active = false, resting = false } = {}) {
  const f = frame && figureUnits(frame)
  if (!f) return false
  const pts = [f.l, f.r, f.head, f.hemL, f.hemR, f.la.e, f.la.h, f.ra.e, f.ra.h]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs) - 0.4
  const maxX = Math.max(...xs) + 0.4
  const minY = Math.min(...ys) - 0.4
  const maxY = Math.max(...ys) + 0.2
  const s = Math.min(w * 0.3, (w * 0.84) / (maxX - minX), (h * 0.84) / (maxY - minY))
  const cx = w / 2 - ((minX + maxX) / 2) * s
  const cy = h / 2 - ((minY + maxY) / 2) * s
  const F = toPx(f, (q) => ({ x: cx + q.x * s, y: cy + q.y * s }))

  const black = '#160b07'
  const clay = '#e79a62'
  const gold = active ? '#ffd877' : '#c9963d'
  ctx.save()
  ctx.globalAlpha = resting ? 0.45 : 1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (active) { ctx.shadowColor = 'rgba(255,216,119,.9)'; ctx.shadowBlur = 14 }

  // gold rim pass, then black fill pass on top
  for (const pass of ['rim', 'fill']) {
    const extra = pass === 'rim' ? 3 : 0
    ctx.strokeStyle = pass === 'rim' ? gold : black
    ctx.fillStyle = pass === 'rim' ? gold : black
    if (pass === 'fill') ctx.shadowBlur = 0
    bodyPath(ctx, F)
    ctx.lineWidth = 2 + extra
    ctx.fill()
    ctx.stroke()
    for (const [sh, a] of [[F.l, F.la], [F.r, F.ra]]) {
      ctx.globalAlpha = (resting ? 0.45 : 1) * (a.ghost ? 0.55 : 1)
      ctx.lineWidth = s * 0.2 + extra
      limb(ctx, sh, a.e, a.h)
      ctx.globalAlpha = resting ? 0.45 : 1
    }
    ctx.beginPath()
    ctx.arc(F.head.x, F.head.y, s * 0.3 + extra / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  // incised details: belt, hem folds, eye
  ctx.strokeStyle = clay
  ctx.lineWidth = 1
  ctx.globalAlpha = resting ? 0.35 : 0.8
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
  const beltL = lerp(F.l, F.hemL, 0.42)
  const beltR = lerp(F.r, F.hemR, 0.42)
  ctx.beginPath(); ctx.moveTo(beltL.x, beltL.y); ctx.lineTo(beltR.x, beltR.y); ctx.stroke()
  for (const k of [0.3, 0.5, 0.7]) {
    const a = lerp(beltL, beltR, k)
    const b = lerp(F.hemL, F.hemR, k)
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(F.head.x + s * 0.08, F.head.y - s * 0.04, s * 0.05, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  return true
}
