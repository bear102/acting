// A slim chart of the Aegean drawn as a horizontal strip: each trial is a numbered island on
// Odysseus's route, sailing west to east toward Ithaca. Doubles as navigation for the cards below.
import { Ship } from '../../ui/Art.jsx'
import { NUMERALS } from './constants.js'

const W = 1000
const H = 240 // tall chart; content keeps to the middle band so the 'slice' crop never cuts an island
const ISLE = 'M-40 -6 Q-36 -28 -10 -30 Q8 -40 26 -24 Q46 -20 42 0 Q50 18 28 24 Q10 36 -10 28 Q-38 30 -42 10 Z'

// Decorative islets scattered between the waypoints: [x, y, scale, rotation]
const ISLETS = [[40, 186, .6, 10], [255, 52, .55, -25], [470, 200, .5, 30], [690, 46, .55, 60], [905, 196, .5, -10]]

function waypoints(n) {
  const x0 = 150
  const x1 = 830
  return Array.from({ length: n }, (_, i) => {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1)
    const y = i % 2 === 0 ? 134 : 104
    return [x, y]
  })
}

function route(pts) {
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]
    const [x, y] = pts[i]
    const mx = (px + x) / 2
    d += ` C${mx} ${py} ${mx} ${y} ${x} ${y}`
  }
  return d
}

export default function VoyageMap({ scenes, hovered, onHover, onPick }) {
  const pts = waypoints(scenes.length)
  // Many trials: shrink the islands so neighbours never overlap (spacing 680 / (n - 1) units)
  const k = Math.min(1, 680 / Math.max(1, scenes.length - 1) / 92)
  const ithaca = [935, 112]
  const last = pts[pts.length - 1]

  return (
    <div className="sx-map-wrap">
      <svg className="sx-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice"
        role="group" aria-label="Voyage chart of the trials">
        <defs>
          <linearGradient id="sx-sea" x1="0" x2="1">
            <stop offset="0" stopColor="#0c1528" />
            <stop offset=".5" stopColor="#18294a" />
            <stop offset="1" stopColor="#0c1528" />
          </linearGradient>
          <pattern id="sx-waves" width="56" height="22" patternUnits="userSpaceOnUse">
            <path d="M0 11 Q14 4 28 11 T56 11" fill="none" stroke="#e8b84a" strokeOpacity=".1" strokeWidth="1.4" />
          </pattern>
        </defs>

        <rect width={W} height={H} fill="url(#sx-sea)" />
        <rect width={W} height={H} fill="url(#sx-waves)" />

        {ISLETS.map(([x, y, s, r], i) => (
          <path key={i} d={ISLE} className="sx-islet" transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} />
        ))}

        <path d={route(pts)} className="sx-route" />
        <path d={`M${last[0]} ${last[1]} C${last[0] + 50} ${last[1]} ${ithaca[0] - 60} ${ithaca[1]} ${ithaca[0] - 34} ${ithaca[1]}`}
          className="sx-route faint" />

        <Ship className="sx-ship" x="14" y="84" width="96" height="58" />

        <g className="sx-ithaca" transform={`translate(${ithaca[0]} ${ithaca[1]})`}>
          <path d={ISLE} transform="scale(1)" />
          <g className="sx-temple" transform="translate(0 -6) scale(1.2)">
            <path d="M-14 -6 L0 -15 L14 -6 Z" />
            <rect x="-13" y="-5" width="26" height="2.5" />
            {[-10, -5, 0, 5, 10].map((x) => <rect key={x} x={x - 1} y="-2" width="2" height="10" />)}
            <rect x="-14" y="8" width="28" height="2.5" />
          </g>
          <text y="54" textAnchor="middle">ITHACA</text>
        </g>

        {scenes.map((s, i) => {
          const [x, y] = pts[i]
          const on = hovered === s.id
          return (
            <g key={s.id} className={`sx-wp ${on ? 'on' : ''} ${s.video ? 'film' : ''} ${i === 0 && hovered === null ? 'start' : ''}`}
              transform={`translate(${x} ${y}) scale(${k})`} role="button" tabIndex={0}
              aria-label={`Trial ${NUMERALS[i]}: ${s.title}`}
              onClick={() => onPick(s.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(s.id) } }}
              onMouseEnter={() => onHover(s.id)} onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(s.id)} onBlur={() => onHover(null)}>
              <title>{s.title}</title>
              <path d={ISLE} className="sx-wp-isle" transform="scale(1.02)" />
              <circle r="21" className="sx-wp-ring" />
              <text className="sx-wp-num" y="6.5" textAnchor="middle">{NUMERALS[i]}</text>
              {s.video && <text className="sx-wp-star" x="20" y="-18">★</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
