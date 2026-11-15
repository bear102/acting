// An illustrated chart of the Aegean: each scene is a waypoint on Odysseus's route home.
import { Ship } from '../../ui/Art.jsx'
import { NUMERALS } from './constants.js'

// Waypoints wander across the chart like the real voyage: east to west and back toward Ithaca.
const POINTS = [
  [120, 290], [265, 150], [420, 268], [575, 128], [730, 252], [880, 118], [905, 312], [560, 330],
]

// Decorative islands: [cx, cy, scale, rotation]
const ISLES = [
  [70, 110, 1.1, 10], [340, 330, 0.8, -20], [470, 70, 0.7, 40], [660, 350, 0.9, 5],
  [820, 205, 0.6, 70], [960, 220, 0.7, -30], [190, 360, 0.55, 15],
]

const ISLE_PATH = 'M-40 -6 Q-36 -28 -10 -30 Q8 -40 26 -24 Q46 -20 42 0 Q50 18 28 24 Q10 36 -10 28 Q-38 30 -42 10 Z'

function routePath(pts) {
  if (pts.length < 2) return ''
  // Catmull-Rom -> cubic Bezier for a smooth sailing line
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`
  }
  return d
}

export default function VoyageMap({ scenes, hovered, onHover, onPick }) {
  const pts = scenes.map((_, i) => POINTS[i % POINTS.length])
  const ithaca = [960, 40] // top-right corner of the chart
  const end = pts[pts.length - 1]

  return (
    <div className="ss-map-wrap">
      <svg className="ss-map" viewBox="0 0 1000 400" role="group" aria-label="Voyage chart of the trials">
        <defs>
          <radialGradient id="ss-sea" cx="50%" cy="45%" r="75%">
            <stop offset="0" stopColor="#1d3358" />
            <stop offset=".65" stopColor="#111c34" />
            <stop offset="1" stopColor="#070b17" />
          </radialGradient>
          <pattern id="ss-waves" width="60" height="26" patternUnits="userSpaceOnUse">
            <path d="M0 13 Q15 5 30 13 T60 13" fill="none" stroke="#e8b84a" strokeOpacity=".09" strokeWidth="1.5" />
          </pattern>
          <filter id="ss-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <rect width="1000" height="400" fill="url(#ss-sea)" />
        <rect width="1000" height="400" fill="url(#ss-waves)" />

        {/* chart grid lines, like an old portolan */}
        {[200, 400, 600, 800].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="400" className="ss-grid" />)}
        {[100, 200, 300].map((y) => <line key={y} x1="0" y1={y} x2="1000" y2={y} className="ss-grid" />)}

        {ISLES.map(([x, y, s, r], i) => (
          <path key={i} d={ISLE_PATH} className="ss-isle-deco"
            transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} />
        ))}

        {/* Ithaca, the goal of every voyage */}
        <g transform={`translate(${ithaca[0] - 40} ${ithaca[1] + 22})`} className="ss-ithaca">
          <path d={ISLE_PATH} transform="scale(.9)" />
          <text x="0" y="-26" textAnchor="middle">ITHACA</text>
        </g>

        {/* sea serpent */}
        <g className="ss-serpent" transform="translate(300 225)">
          <path d="M0 0 Q12 -26 24 0 M30 0 Q42 -30 54 0 M60 0 Q72 -22 84 0" />
          <path d="M84 0 Q94 -18 104 -16 Q112 -14 108 -6 L100 -8" />
          <circle cx="102" cy="-12" r="1.8" />
        </g>

        {/* compass rose */}
        <g className="ss-compass" transform="translate(70 335)">
          <circle r="34" />
          <circle r="24" />
          <path d="M0 -44 L7 0 L0 44 L-7 0 Z" />
          <path d="M-44 0 L0 -7 L44 0 L0 7 Z" opacity=".7" />
          <text y="-50" textAnchor="middle">N</text>
        </g>

        {/* the route */}
        {pts.length > 1 && <path d={routePath(pts)} className="ss-route" />}
        {end && <path d={`M${end[0]} ${end[1]} Q${(end[0] + ithaca[0]) / 2 + 40} ${(end[1] + ithaca[1]) / 2} ${ithaca[0] - 40} ${ithaca[1] + 30}`} className="ss-route faint" />}

        {/* the ship sits at the first waypoint */}
        {pts[0] && <Ship className="ss-map-ship" x={pts[0][0] - 95} y={pts[0][1] - 72} width="70" height="42" />}

        {scenes.map((s, i) => {
          const [x, y] = pts[i]
          const on = hovered === s.id
          return (
            <g key={s.id} className={`ss-wp ${on ? 'on' : ''} ${s.video ? 'film' : ''}`}
              transform={`translate(${x} ${y})`} role="button" tabIndex={0}
              aria-label={`Trial ${NUMERALS[i]}: ${s.title}`}
              onClick={() => onPick(s.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s.id) } }}
              onMouseEnter={() => onHover(s.id)} onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.id)} onBlur={() => onHover(null)}>
              <path d={ISLE_PATH} className="ss-wp-isle" transform="scale(1.05)" />
              <circle r="19" className="ss-wp-ring" filter={on ? 'url(#ss-glow)' : undefined} />
              <text className="ss-wp-num" y="6" textAnchor="middle">{NUMERALS[i]}</text>
              {s.video && <text className="ss-wp-film" x="20" y="-16">★</text>}
              <text className="ss-wp-label" y="46" textAnchor="middle">{s.title}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
