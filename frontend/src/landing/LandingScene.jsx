// Full-bleed night voyage behind the landing page.
// Base: a painted backdrop (art/generated/landing-sky.webp: starry sky, Olympus storm cloud top-left,
// islands left, Ithaca with its temple and hearth right, calm sea below a horizon at 63.5%).
// On top, a few original SVG/CSS layers: god constellations, moon, lightning flash, Cyclops eye,
// hearth glow, meteors, gulls, the sea swells with the ship, dolphins and a sea serpent.
//
// PERF: every animated thing is its own element (HTML wrapper or <svg> root) animated with
// transform/opacity only, so the compositor moves it and nothing is repainted per frame.
// Nothing animates INSIDE an <svg> while idle (that forces a repaint of the whole svg).
// Mouse parallax writes CSS vars on the root (no React re-render).
import { useEffect, useRef } from 'react'
import './landing.css'

// Where things sit on the painting, as fractions of its width/height (u, v).
// CSS turns these into viewport positions with --ix/--iw/--ih (see .lp-paint in landing.css).
const PAINT = {
  cloud: [0.145, 0.163],
  cyclops: [0.072, 0.598],
  hearth: [0.855, 0.582],
  ithaca: [0.876, 0.515],
}
const at = ([u, v]) => ({ '--u': u, '--v': v })

// ---------------------------------------------------------------- the gods as constellations
// Each: stars (x,y in a 100x100 box) + line segments between star indices. Sky box is 1600x900.
const CONSTELLATIONS = [
  { god: 'Athena', x: 70, y: 262, scale: 1.0, // owl (kept clear of the painted storm cloud)
    stars: [[30, 8], [70, 8], [36, 26], [64, 26], [50, 38], [22, 52], [78, 52], [34, 88], [66, 88], [50, 70]],
    lines: [[0, 2], [1, 3], [2, 4], [3, 4], [2, 5], [3, 6], [5, 7], [6, 8], [7, 9], [8, 9], [0, 1]] },
  { god: 'Apollo', x: 262, y: 360, scale: .9, // lyre (left of the title, below the storm)
    stars: [[20, 6], [12, 40], [30, 82], [70, 82], [88, 40], [80, 6], [26, 20], [74, 20], [42, 82], [58, 82]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [6, 1], [7, 4], [8, 6], [9, 7]] },
  { god: 'Ares', x: 1190, y: 300, scale: 1.0, // crested helmet
    stars: [[15, 18], [50, 2], [85, 18], [24, 34], [76, 34], [34, 50], [66, 50], [22, 72], [40, 90], [60, 90], [78, 72]],
    lines: [[0, 1], [1, 2], [3, 4], [3, 7], [4, 10], [5, 6], [7, 8], [9, 10], [0, 3], [2, 4]] },
  { god: 'Aphrodite', x: 1430, y: 255, scale: 1.0, // rose
    stars: [[50, 30], [32, 18], [68, 18], [36, 48], [64, 48], [50, 58], [50, 96], [32, 74], [68, 84]],
    lines: [[1, 0], [2, 0], [1, 3], [2, 4], [3, 5], [4, 5], [5, 6], [6, 7], [6, 8]] },
]

function Constellation({ c, i }) {
  const k = c.scale
  const P = ([x, y]) => [c.x + x * k, c.y + y * k]
  return (
    <g className="lp-const" style={{ '--i': i }}>
      {c.lines.map(([a, b], j) => {
        const [x1, y1] = P(c.stars[a]); const [x2, y2] = P(c.stars[b])
        return <line key={j} x1={x1} y1={y1} x2={x2} y2={y2} pathLength="1" style={{ '--j': j }} />
      })}
      {c.stars.map((s, j) => {
        const [x, y] = P(s)
        return <circle key={j} cx={x} cy={y} r={j === 0 ? 3.2 : 2.3} className="lp-cstar" />
      })}
      <text x={c.x + 50 * k} y={c.y + 100 * k + 22} textAnchor="middle">{c.god}</text>
    </g>
  )
}

// ---------------------------------------------------------------- sea tiles (seamless, 400px wide)
const waveTile = (fill, crest, amp, crestOpacity = 0.55) => {
  const top = `M0 20 Q50 ${20 - amp} 100 20 T200 20 T300 20 T400 20`
  const c = crest ? `<path d='${top}' fill='none' stroke='${crest}' stroke-width='2' stroke-opacity='${crestOpacity}'/>` : ''
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200' preserveAspectRatio='none'><path d='${top} V200 H0 Z' fill='${fill}'/>${c}</svg>`)}")`
}
// Swells tinted to the painting's plum-dark water; the far one is only crest lines so the
// painted sea and horizon stay visible behind it.
const SEA = [
  { cls: 'lp-sea-far', bg: waveTile('rgba(40,30,70,.18)', '#a99ad6', 4, 0.28) },
  { cls: 'lp-sea-mid', bg: waveTile('#17142e', '#9a8cc8', 9) },
  { cls: 'lp-sea-near', bg: waveTile('#0b0918', '#e8b84a', 12) },
]

// Shooting stars: start point (% of viewport), when in the shared 16s cycle each falls.
const METEORS = [
  { x: 38, y: 6, delay: 3 },
  { x: 70, y: 3, delay: 9.5 },
  { x: 22, y: 12, delay: 13 },
]
// Glints on the far water (% of the sea box), fixed so the scene never reshuffles.
const GLINTS = [[8, 10, 0.4], [21, 22, 2.9], [33, 8, 1.6], [47, 18, 4.1], [62, 12, 0.9], [74, 26, 3.4], [86, 9, 2.2], [93, 20, 4.6]]

// [pupil element, eye it sits in, max pupil travel x, y (px)] for the eyes that follow the cursor
const EYES = [
  ['.lp-sail-pupil', '.lp-sail-eye', 9, 3.5],
  ['.lp-cy-pupil', '.lp-cy-eye', 0, 0], // travel derived from the eye's size below
]

export default function LandingScene() {
  const root = useRef(null)

  // Mouse parallax: lerp toward the pointer, write --px/--py, stop when settled.
  // The same pointer steers the two eyes (Athena's on the sail, the Cyclops's on the island).
  useEffect(() => {
    const el = root.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const onVis = () => el.classList.toggle('lp-paused', document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)
    if (reduce || coarse) return () => document.removeEventListener('visibilitychange', onVis)

    const eyes = EYES.map(([pupil, socket, maxX, maxY]) => ({
      pupil: el.querySelector(pupil), socket: el.querySelector(socket), maxX, maxY,
    })).filter((e) => e.pupil && e.socket)
    let cx = null, cy = null // last pointer position, px
    const aim = () => {
      if (cx == null) return
      for (const e of eyes) {
        const r = e.socket.getBoundingClientRect()
        const mx = e.maxX || r.width * 0.28, my = e.maxY || r.height * 0.12
        const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, dist / 90) // a cursor right on the eye is met with a level gaze
        e.pupil.style.setProperty('--lx', ((dx / dist) * mx * reach).toFixed(2))
        e.pupil.style.setProperty('--ly', ((dy / dist) * my * reach).toFixed(2))
      }
    }

    let tx = 0, ty = 0, x = 0, y = 0, raf = 0
    const step = () => {
      x += (tx - x) * 0.08
      y += (ty - y) * 0.08
      el.style.setProperty('--px', x.toFixed(4))
      el.style.setProperty('--py', y.toFixed(4))
      aim()
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0
    }
    const onMove = (e) => {
      cx = e.clientX
      cy = e.clientY
      tx = (cx / window.innerWidth) * 2 - 1
      ty = (cy / window.innerHeight) * 2 - 1
      el.classList.add('lp-tracking')
      if (!raf) raf = requestAnimationFrame(step)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    // The ship keeps sailing under a resting cursor, so re-aim now and then even without movement
    const keepAiming = setInterval(() => { if (!document.hidden) aim() }, 400)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(raf)
      clearInterval(keepAiming)
    }
  }, [])

  return (
    <div className="lp-scene" ref={root} aria-hidden="true">
      {/* ---------------- the painting + things pinned to it */}
      <div className="lp-par lp-paint" style={{ '--d': 4 }}>
        <img className="lp-paint-img" src="/art/generated/landing-sky.webp" alt="" fetchPriority="high" decoding="async" draggable="false" />
        <div className="lp-pin lp-flash" style={at(PAINT.cloud)} />
        <div className="lp-pin lp-cy" style={at(PAINT.cyclops)}>
          <div className="lp-cy-glow" />
          <div className="lp-cy-eye"><div className="lp-cy-pupil" /></div>
        </div>
        <div className="lp-pin lp-hearth-glow" style={at(PAINT.hearth)} />
        <div className="lp-pin lp-place" style={at(PAINT.ithaca)}>Ithaca</div>
      </div>

      {/* ---------------- the gods (static once traced) */}
      <div className="lp-par" style={{ '--d': 7 }}>
        <svg className="lp-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMin slice">
          {CONSTELLATIONS.map((c, i) => <Constellation key={c.god} c={c} i={i} />)}
        </svg>
      </div>

      {/* ---------------- shooting stars */}
      <div className="lp-par" style={{ '--d': 6 }}>
        {METEORS.map((m, i) => (
          <i key={i} className="lp-meteor" style={{ left: `${m.x}%`, top: `${m.y}%`, '--d': `${m.delay}s` }} />
        ))}
      </div>

      {/* ---------------- moon */}
      <div className="lp-par lp-moon-wrap" style={{ '--d': 10 }}>
        <svg className="lp-moon" viewBox="0 0 300 300">
          <defs>
            <radialGradient id="lp-moon" cx="40%" cy="38%" r="70%">
              <stop offset="0" stopColor="#fff8e6" />
              <stop offset=".55" stopColor="#f3dfae" />
              <stop offset="1" stopColor="#c9a86a" />
            </radialGradient>
            <radialGradient id="lp-halo">
              <stop offset="0" stopColor="#f3d58c" stopOpacity=".26" />
              <stop offset=".45" stopColor="#f3d58c" stopOpacity=".07" />
              <stop offset="1" stopColor="#f3d58c" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="150" cy="150" r="150" fill="url(#lp-halo)" />
          <circle cx="150" cy="150" r="62" fill="url(#lp-moon)" />
          <g fill="#c9a86a" opacity=".45">
            <circle cx="128" cy="132" r="10" /><circle cx="170" cy="168" r="14" /><circle cx="160" cy="122" r="5" /><circle cx="132" cy="175" r="6" />
          </g>
        </svg>
      </div>

      {/* ---------------- gulls heading home ahead of the ship */}
      <div className="lp-par lp-birds" style={{ '--d': 12 }}>
        <div className="lp-flock">
          {[[0, 0, 1], [34, 14, .8], [62, -6, .9], [22, 34, .7], [88, 22, .75]].map(([x, y, k], i) => (
            <svg key={i} className="lp-gull" viewBox="0 0 24 10" style={{ left: x, top: y, width: 24 * k, '--i': i }}>
              <path d="M1 7 Q6 0 12 6 Q18 0 23 7" />
            </svg>
          ))}
        </div>
      </div>

      {/* ---------------- sea, from the painted horizon down */}
      <div className="lp-par lp-sea" style={{ '--d': 20 }}>
        <div className={`lp-wave ${SEA[0].cls}`} style={{ backgroundImage: SEA[0].bg }} />
        <div className="lp-glints">
          {GLINTS.map(([x, y, d], i) => <i key={i} style={{ left: `${x}%`, top: `${y}%`, '--d': `${d}s` }} />)}
        </div>
        <div className="lp-moonpath">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</div>
        <div className="lp-ship-lane">
          <div className="lp-ship-bob"><Galley /></div>
        </div>
        <div className="lp-dolphins">
          <div className="lp-dolphin" style={{ '--i': 0 }}><Dolphin /></div>
          <div className="lp-dolphin" style={{ '--i': 1 }}><Dolphin /></div>
        </div>
        <div className={`lp-wave ${SEA[1].cls}`} style={{ backgroundImage: SEA[1].bg }} />
        <div className="lp-serpent"><Serpent /></div>
        <div className={`lp-wave ${SEA[2].cls}`} style={{ backgroundImage: SEA[2].bg }} />
      </div>
    </div>
  )
}

// Black-figure galley. Three stacked <svg> roots so the sail and the oars can move as whole
// layers (composited) while the hull stays still.
function Galley() {
  return (
    <div className="lp-ship">
      <svg className="lp-ship-oars" viewBox="0 0 260 190">
        {[64, 86, 108, 130, 152, 174, 196].map((x) => <rect key={x} x={x} y="148" width="3" height="26" fill="#0b0f1c" />)}
      </svg>
      <svg className="lp-ship-hull" viewBox="0 0 260 190">
        {/* faint moonlit rim so the black-figure hull reads against the dark water */}
        <g fill="#0b0f1c" stroke="#c9bdf0" strokeOpacity=".45" strokeWidth="1.6" strokeLinejoin="round">
          <rect x="127" y="10" width="5" height="122" />
          <path d="M14 128 Q30 122 44 132 L206 132 Q226 130 242 116 L248 120 Q238 142 214 152 L56 152 Q30 150 14 128 Z" />
          <path d="M14 128 Q2 108 18 96 Q28 90 32 100 Q22 106 26 118 Z" />
          <path d="M242 116 L256 136 L238 138 Z" />
        </g>
        <path d="M128 12 L128 4 L150 9 L128 14 Z" fill="#e8b84a" />
        <path d="M48 140 H210" stroke="#e8b84a" strokeWidth="2" opacity=".75" />
        <circle cx="222" cy="138" r="3.5" fill="#e8b84a" />
        <circle cx="20" cy="92" r="13" fill="#ff9a3c" opacity=".18" />
        <circle cx="20" cy="92" r="3" fill="#ffcf7a" />
      </svg>
      <svg className="lp-ship-sail" viewBox="0 0 260 190">
        <path d="M72 26 Q130 14 188 26 Q196 64 184 104 Q130 94 76 104 Q64 64 72 26 Z" fill="#c8693c" />
        <path d="M72 26 Q130 14 188 26" fill="none" stroke="#0b0f1c" strokeWidth="4" />
        <path d="M80 48 Q130 40 182 48 M78 70 Q130 62 184 70 M78 90 Q130 82 184 90" stroke="#8f3f1f" strokeWidth="2" fill="none" opacity=".6" />
        {/* painted eye of Athena on the sail */}
        <ellipse className="lp-sail-eye" cx="130" cy="60" rx="18" ry="11" fill="#f3e3c2" />
        <g className="lp-sail-pupil">
          <circle cx="130" cy="60" r="7" fill="#0b0f1c" />
          <circle cx="132" cy="58" r="2" fill="#f3e3c2" />
        </g>
      </svg>
    </div>
  )
}

function Dolphin() {
  return (
    <svg viewBox="-8 0 68 30">
      <path d="M2 20 Q18 2 40 8 Q52 10 58 18 Q50 15 44 16 Q30 18 20 24 Q12 28 2 20 Z" />
      <path d="M27 8 L33 0 L37 9 Z" />
      <path d="M3 20 L-6 12 L-2 21 L-7 28 Z" />
    </svg>
  )
}

// Coils of a sea serpent breaking the surface.
function Serpent() {
  return (
    <svg className="lp-serpent-svg" viewBox="0 0 320 130">
      <g fill="#0d0b1e" stroke="#9a8cc8" strokeOpacity=".35" strokeWidth="2">
        <path d="M10 130 Q40 40 80 130 Z" />
        <path d="M100 130 Q135 30 170 130 Z" />
        <path d="M200 130 Q215 70 236 46 Q258 22 284 34 Q300 42 294 56 Q280 48 266 54 Q250 64 246 130 Z" />
      </g>
      <circle cx="281" cy="40" r="3" fill="#e8b84a" />
    </svg>
  )
}
