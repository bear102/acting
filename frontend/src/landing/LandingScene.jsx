// Full-bleed animated night voyage behind the landing page. Original art, all SVG/CSS.
// Layers (back to front): sky + stars + god constellations + moon + Olympus storm,
// land (Cyclops mountain, Ithaca), then three sea bands with the ship and a sea serpent.
// Small life on top: shooting stars, cloud wisps, rain under Olympus, gulls, hearth smoke and
// torches on Ithaca, rowing oars and a wake, leaping dolphins, glints on the water.
// Motion is transform/opacity only; mouse parallax writes CSS vars (no React re-render).
import { useEffect, useRef } from 'react'
import './landing.css'

// ---------------------------------------------------------------- deterministic stars
function rng(seed) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}
const STARS = (() => {
  const r = rng(7)
  return Array.from({ length: 140 }, (_, i) => ({
    x: r() * 1600, y: r() * 620, s: r() < 0.08 ? 1.9 : 0.6 + r() * 0.9, tw: i % 9 === 0, d: (r() * 6).toFixed(2),
  }))
})()

// ---------------------------------------------------------------- the gods as constellations
// Each: stars (x,y in a 100x100 box) + line segments between star indices.
const CONSTELLATIONS = [
  { god: 'Athena', x: 110, y: 185, scale: 1.2, // owl
    stars: [[30, 8], [70, 8], [36, 26], [64, 26], [50, 38], [22, 52], [78, 52], [34, 88], [66, 88], [50, 70]],
    lines: [[0, 2], [1, 3], [2, 4], [3, 4], [2, 5], [3, 6], [5, 7], [6, 8], [7, 9], [8, 9], [0, 1]] },
  { god: 'Apollo', x: 320, y: 290, scale: 1.0, // lyre
    stars: [[20, 6], [12, 40], [30, 82], [70, 82], [88, 40], [80, 6], [26, 20], [74, 20], [42, 82], [58, 82]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [6, 1], [7, 4], [8, 6], [9, 7]] },
  { god: 'Ares', x: 1210, y: 300, scale: 1.0, // crested helmet
    stars: [[15, 18], [50, 2], [85, 18], [24, 34], [76, 34], [34, 50], [66, 50], [22, 72], [40, 90], [60, 90], [78, 72]],
    lines: [[0, 1], [1, 2], [3, 4], [3, 7], [4, 10], [5, 6], [7, 8], [9, 10], [0, 3], [2, 4]] },
  { god: 'Aphrodite', x: 1420, y: 225, scale: 1.0, // rose
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
        return <circle key={j} cx={x} cy={y} r={j === 0 ? 3.2 : 2.3} className={j % 3 === 0 ? 'lp-cstar tw' : 'lp-cstar'} style={{ '--d': `${(i * 0.7 + j * 0.37) % 4}s` }} />
      })}
      <text x={c.x + 50 * k} y={c.y + 100 * k + 22} textAnchor="middle">{c.god}</text>
    </g>
  )
}

// ---------------------------------------------------------------- sea tiles (seamless, 400px wide)
const waveTile = (fill, crest, amp, phase = 0) => {
  const d = `M0 ${20 + phase} Q50 ${20 - amp + phase} 100 ${20 + phase} T200 ${20 + phase} T300 ${20 + phase} T400 ${20 + phase} V200 H0 Z`
  const c = crest ? `<path d='M0 ${20 + phase} Q50 ${20 - amp + phase} 100 ${20 + phase} T200 ${20 + phase} T300 ${20 + phase} T400 ${20 + phase}' fill='none' stroke='${crest}' stroke-width='2' stroke-opacity='.55'/>` : ''
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200' preserveAspectRatio='none'><path d='${d}' fill='${fill}'/>${c}</svg>`)}")`
}
const SEA = [
  { cls: 'lp-sea-far', bg: waveTile('#24365f', '#7f96c8', 6) },
  { cls: 'lp-sea-mid', bg: waveTile('#16244a', '#9ab0dc', 9) },
  { cls: 'lp-sea-near', bg: waveTile('#0a1124', '#e8b84a', 12) },
]

// Shooting stars: start point in sky units, and when in the shared 16s cycle each one falls.
const METEORS = [
  { x: 520, y: 70, delay: 3 },
  { x: 1090, y: 40, delay: 9.5 },
  { x: 250, y: 130, delay: 13 },
]
// Glints on the far water (% of the sea box), fixed so the scene never reshuffles.
const GLINTS = (() => {
  const r = rng(23)
  return Array.from({ length: 14 }, () => ({ x: r() * 100, y: 6 + r() * 26, d: (r() * 5).toFixed(2) }))
})()
const RAIN = [84, 118, 150, 186, 214, 262, 296, 330, 362]

// One cloud bank, drawn twice: the dark body and the lightning-lit copy that flashes over it.
function CloudBank({ className }) {
  return (
    <g className={className}>
      <circle cx="110" cy="96" r="44" /><circle cx="170" cy="70" r="58" /><circle cx="245" cy="62" r="64" />
      <circle cx="315" cy="84" r="48" /><circle cx="360" cy="104" r="34" />
      <rect x="70" y="96" width="320" height="44" rx="22" />
    </g>
  )
}

// [pupil group, eye it sits in, max pupil travel x, y] for the eyes that follow the cursor
const EYES = [
  ['.lp-sail-pupil', '.lp-sail-eye', 9, 3.5],
  ['.lp-eye-look', '.lp-eye-core', 7, 1.6],
]

export default function LandingScene() {
  const root = useRef(null)

  // Mouse parallax: lerp toward the pointer, write --px/--py, stop when settled.
  // The same pointer steers the two eyes (Athena's on the sail, the Cyclops's in the cave).
  useEffect(() => {
    const el = root.current
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const onVis = () => el.classList.toggle('lp-paused', document.hidden)
    document.addEventListener('visibilitychange', onVis)
    if (reduce || coarse) return () => document.removeEventListener('visibilitychange', onVis)

    // Each eye: the pupil group to move, the eye it sits in, and how far the pupil may travel
    // (SVG units) before it would leave the white.
    const eyes = EYES.map(([pupil, socket, maxX, maxY]) => ({
      pupil: el.querySelector(pupil), socket: el.querySelector(socket), maxX, maxY,
    })).filter((e) => e.pupil && e.socket)
    let cx = null, cy = null // last pointer position, px
    const aim = () => {
      if (cx == null) return
      for (const e of eyes) {
        const r = e.socket.getBoundingClientRect()
        const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        const reach = Math.min(1, dist / 90) // a cursor right on the eye is met with a level gaze
        e.pupil.style.setProperty('--lx', ((dx / dist) * e.maxX * reach).toFixed(2))
        e.pupil.style.setProperty('--ly', ((dy / dist) * e.maxY * reach).toFixed(2))
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
    const keepAiming = setInterval(() => { if (!document.hidden) aim() }, 250)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(raf)
      clearInterval(keepAiming)
    }
  }, [])

  return (
    <div className="lp-scene" ref={root} aria-hidden="true">
      {/* ---------------- sky */}
      <div className="lp-par" style={{ '--d': 6 }}>
        <svg className="lp-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMin slice">
          <defs>
            <radialGradient id="lp-moon" cx="40%" cy="38%" r="70%">
              <stop offset="0" stopColor="#fff8e6" />
              <stop offset=".55" stopColor="#f3dfae" />
              <stop offset="1" stopColor="#c9a86a" />
            </radialGradient>
            <radialGradient id="lp-halo">
              <stop offset="0" stopColor="#f3d58c" stopOpacity=".28" />
              <stop offset=".45" stopColor="#f3d58c" stopOpacity=".08" />
              <stop offset="1" stopColor="#f3d58c" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="lp-stars">
            {STARS.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.s} className={s.tw ? 'tw' : ''} style={s.tw ? { '--d': `${s.d}s` } : undefined} />
            ))}
          </g>
          {CONSTELLATIONS.map((c, i) => <Constellation key={c.god} c={c} i={i} />)}
          {METEORS.map((m, i) => (
            <g key={i} transform={`translate(${m.x} ${m.y})`}>
              <g className="lp-meteor" style={{ '--d': `${m.delay}s` }}>
                <line x1="0" y1="0" x2="-110" y2="-42" />
                <circle r="2.4" />
              </g>
            </g>
          ))}
        </svg>
      </div>

      {/* ---------------- thin cloud wisps drifting across the moon */}
      <div className="lp-par lp-wisps" style={{ '--d': 9 }}>
        {[0, 1, 2].map((i) => (
          <svg key={i} className="lp-wisp" style={{ '--i': i }} viewBox="0 0 400 60">
            <ellipse cx="200" cy="32" rx="190" ry="9" /><ellipse cx="170" cy="20" rx="110" ry="8" />
            <ellipse cx="250" cy="44" rx="120" ry="7" />
          </svg>
        ))}
      </div>

      {/* ---------------- moon */}
      <div className="lp-par lp-moon-wrap" style={{ '--d': 10 }}>
        <svg className="lp-moon" viewBox="0 0 300 300">
          <circle cx="150" cy="150" r="150" fill="url(#lp-halo)" />
          <circle cx="150" cy="150" r="62" fill="url(#lp-moon)" />
          <g fill="#c9a86a" opacity=".45">
            <circle cx="128" cy="132" r="10" /><circle cx="170" cy="168" r="14" /><circle cx="160" cy="122" r="5" /><circle cx="132" cy="175" r="6" />
          </g>
        </svg>
      </div>

      {/* ---------------- Olympus storm (top-left) */}
      <div className="lp-par lp-olympus" style={{ '--d': 8 }}>
        <svg viewBox="0 0 420 220">
          <g className="lp-rain">
            {RAIN.map((x, i) => <line key={x} x1={x} y1="146" x2={x - 9} y2="172" style={{ '--i': i }} />)}
          </g>
          <path className="lp-bolt" d="M232 120 L206 170 L226 170 L196 222 L258 150 L236 150 L256 120 Z" />
          <CloudBank className="lp-cloud" />
          <CloudBank className="lp-cloud-flash" />
          <g className="lp-cloud-rim">
            <path d="M70 100 Q72 54 116 52 Q122 16 172 14 Q200 -6 246 0 Q300 0 312 38 Q352 36 362 72 Q392 78 392 112" />
          </g>
        </svg>
      </div>

      {/* ---------------- land: Cyclops mountain (left) and Ithaca (right) */}
      <div className="lp-par lp-land-wrap" style={{ '--d': 14 }}>
        <svg className="lp-land" viewBox="0 150 1600 250" preserveAspectRatio="xMidYMax slice">
          <path className="lp-hill-far" d="M-20 400 V300 Q120 250 210 270 Q300 185 400 230 Q470 260 540 300 Q600 330 640 400 Z" />
          <path className="lp-hill" d="M-20 400 V320 Q80 270 150 236 Q230 160 300 214 Q350 255 420 300 Q470 340 520 400 Z" />
          {/* the cave and the Cyclops's single eye */}
          <path className="lp-cave" d="M196 330 Q232 268 270 330 Z" />
          <g className="lp-eye">
            <ellipse cx="233" cy="308" rx="22" ry="11" className="lp-eye-glow" />
            <ellipse cx="233" cy="308" rx="11" ry="5" className="lp-eye-core" />
            <g className="lp-eye-look"><ellipse cx="233" cy="308" rx="2.2" ry="4.6" className="lp-eye-pupil" /></g>
          </g>
          {/* Ithaca with its temple and a hearth light */}
          <path className="lp-hill-far" d="M1080 400 Q1150 320 1260 300 Q1360 270 1450 300 Q1540 320 1640 300 V400 Z" />
          <path className="lp-hill" d="M1160 400 Q1230 340 1320 330 Q1420 300 1500 330 Q1570 350 1640 340 V400 Z" />
          <g className="lp-temple" transform="translate(1360 262)">
            <path d="M-46 22 L0 0 L46 22 Z" />
            <rect x="-44" y="22" width="88" height="5" />
            {[-38, -22, -6, 10, 26].map((x) => <rect key={x} x={x} y="28" width="7" height="34" />)}
            <rect x="-48" y="62" width="96" height="6" />
          </g>
          <circle className="lp-hearth" cx="1365" cy="318" r="4" />
          <g className="lp-cypress">
            {[[1268, 334, 1], [1284, 330, 1.25], [1446, 326, 1.2], [1464, 332, .95], [1520, 338, .8]].map(([x, y, k]) => (
              <path key={x} transform={`translate(${x} ${y}) scale(${k})`} d="M0 0 Q-7 -22 0 -46 Q7 -22 0 0 Z" />
            ))}
          </g>
          <g className="lp-smoke">
            {[0, 1, 2, 3].map((i) => <circle key={i} cx="1392" cy="268" r="6" style={{ '--i': i }} />)}
          </g>
          {[1302, 1418].map((x) => (
            <g key={x}>
              <rect className="lp-torch-post" x={x - 1.5} y="318" width="3" height="14" />
              <circle className="lp-torch-glow" cx={x} cy="315" r="11" />
              <circle className="lp-hearth" cx={x} cy="315" r="3.2" style={{ animationDelay: `${x % 7 * -0.3}s` }} />
            </g>
          ))}
          <text className="lp-place" x="1360" y="246" textAnchor="middle">Ithaca</text>
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

      {/* ---------------- sea */}
      <div className="lp-par lp-sea" style={{ '--d': 20 }}>
        <div className={`lp-wave ${SEA[0].cls}`} style={{ backgroundImage: SEA[0].bg }} />
        <div className="lp-glints">
          {GLINTS.map((g, i) => <i key={i} style={{ left: `${g.x}%`, top: `${g.y}%`, '--d': `${g.d}s` }} />)}
        </div>
        <div className="lp-moonpath">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--i': i }} />)}</div>
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

// Black-figure galley with a billowing terracotta sail.
function Galley() {
  return (
    <svg className="lp-ship" viewBox="0 0 260 190">
      <rect x="127" y="10" width="5" height="122" fill="#0b0f1c" />
      <path d="M128 12 L128 4 L150 9 L128 14 Z" className="lp-pennant" />
      <g className="lp-sail">
        <path d="M72 26 Q130 14 188 26 Q196 64 184 104 Q130 94 76 104 Q64 64 72 26 Z" fill="#c8693c" />
        <path d="M72 26 Q130 14 188 26" fill="none" stroke="#0b0f1c" strokeWidth="4" />
        <path d="M80 48 Q130 40 182 48 M78 70 Q130 62 184 70 M78 90 Q130 82 184 90" stroke="#8f3f1f" strokeWidth="2" fill="none" opacity=".6" />
        {/* painted eye of Athena on the sail */}
        <ellipse className="lp-sail-eye" cx="130" cy="60" rx="18" ry="11" fill="#f3e3c2" />
        <g className="lp-sail-pupil">
          <circle cx="130" cy="60" r="7" fill="#0b0f1c" />
          <circle cx="132" cy="58" r="2" fill="#f3e3c2" />
        </g>
      </g>
      <path d="M14 128 Q30 122 44 132 L206 132 Q226 130 242 116 L248 120 Q238 142 214 152 L56 152 Q30 150 14 128 Z" fill="#0b0f1c" />
      <path d="M14 128 Q2 108 18 96 Q28 90 32 100 Q22 106 26 118 Z" fill="#0b0f1c" />
      <path d="M242 116 L256 136 L238 138 Z" fill="#0b0f1c" />
      <path d="M48 140 H210" stroke="#e8b84a" strokeWidth="2" opacity=".75" />
      {/* oars pull together, each a beat behind the one ahead */}
      {[64, 86, 108, 130, 152, 174, 196].map((x, i) => (
        <g key={x} transform={`translate(${x} 148)`}>
          <rect className="lp-oar" width="3" height="26" fill="#0b0f1c" style={{ '--i': i }} />
        </g>
      ))}
      <circle cx="222" cy="138" r="3.5" fill="#e8b84a" />
      {/* stern lantern */}
      <circle className="lp-lantern-glow" cx="20" cy="92" r="13" />
      <circle className="lp-lantern" cx="20" cy="92" r="3" />
      {/* wake trailing astern, spray at the ram */}
      <g className="lp-wake">
        {[0, 1, 2, 3].map((i) => <path key={i} d={`M${6 - i * 26} ${156 + (i % 2) * 5} q-9 -5 -18 0`} style={{ '--i': i }} />)}
      </g>
      <g className="lp-spray">
        {[[250, 132], [258, 138], [254, 124]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2" style={{ '--i': i }} />)}
      </g>
    </svg>
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
      <g fill="#0d1a33" stroke="#5ec8d8" strokeOpacity=".35" strokeWidth="2">
        <path d="M10 130 Q40 40 80 130 Z" />
        <path d="M100 130 Q135 30 170 130 Z" />
        <path d="M200 130 Q215 70 236 46 Q258 22 284 34 Q300 42 294 56 Q280 48 266 54 Q250 64 246 130 Z" />
      </g>
      <circle cx="281" cy="40" r="3" fill="#e8b84a" />
    </svg>
  )
}
