import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bolt, Ship } from '../ui/Art.jsx'
import { rankArt } from '../ui/rankArt.js'

// The sea road from Circe's sty to Olympus. Kleos 0-1000 maps to distance along it.
const ROAD = 'M50 178 C 150 110, 235 232, 345 172 S 520 92, 610 150 S 760 222, 850 128 S 925 66, 955 84'
const SAIL_MS = 2400
const MAX = 1000

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Ship sails to the crew's kleos while the number counts up; calls onArrive once it lands. */
export default function Voyage({ voyage, onArrive }) {
  const road = useRef(null)
  const [geo, setGeo] = useState(null) // { len, stops: [{x, y, kleos, name}] }
  const [p, setP] = useState(0) // 0..1 of the animation, eased

  useLayoutEffect(() => {
    const el = road.current
    const len = el.getTotalLength()
    const at = (kleos) => el.getPointAtLength((len * kleos) / MAX)
    setGeo({ len, at, stops: voyage.waypoints.map((w) => ({ ...w, ...pt(at(w.kleos)) })), end: pt(at(MAX)) })
  }, [voyage])

  useEffect(() => {
    if (reducedMotion()) {
      setP(1)
      onArrive?.()
      return
    }
    let raf
    const t0 = performance.now()
    const step = (now) => {
      const f = Math.min(1, (now - t0) / SAIL_MS)
      setP(1 - (1 - f) ** 3)
      if (f < 1) raf = requestAnimationFrame(step)
      else onArrive?.()
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voyage])

  const shown = Math.round(voyage.kleos * p)
  const ship = geo ? pt(geo.at(shown)) : null
  const arrived = p >= 1

  return (
    <div className="vy">
      <svg className="vy-chart" viewBox="0 0 1000 250" role="img"
        aria-label={`${voyage.kleos} kleos out of ${MAX}: ${voyage.rank}`}>
        <path className="vy-road" d={ROAD} ref={road} />
        {geo && <path className="vy-wake" d={ROAD} strokeDasharray={`${(geo.len * shown) / MAX} ${geo.len}`} />}
        {geo?.stops.map((s, i) => {
          const lit = shown >= s.kleos
          const here = arrived && s.name === voyage.rank
          const up = i % 2 === 0 || i === geo.stops.length - 1 // the last two sit close: keep both labels apart
          const [l1, l2] = twoLines(s.name)
          return (
            <g key={s.name} className={`vy-stop ${lit ? 'lit' : ''} ${here ? 'here' : ''}`}>
              <circle cx={s.x} cy={s.y} r={here ? 11 : 8} />
              {/* a label above the road lifts clear when the ship is moored under it */}
              <text x={s.x} y={s.y + (!up ? 34 : ship && Math.abs(ship.x - s.x) < 70 ? -66 : -34)} textAnchor="middle">
                <tspan x={s.x}>{l1}</tspan>
                {l2 && <tspan x={s.x} dy="15">{l2}</tspan>}
              </text>
            </g>
          )
        })}
        {geo && <Bolt className={`vy-summit ${shown >= MAX ? 'lit' : ''}`} x={geo.end.x - 4} y={geo.end.y - 34} width="26" height="26" />}
        {ship && <Ship className="vy-ship" x={ship.x - 36} y={ship.y - 40} width="72" height="42" />}
      </svg>

      <div className="vy-score">
        {rankArt(voyage.rank) && (
          /* Badge of the rank reached; loads eagerly (above the fold), revealed when the ship lands */
          <img className={`vy-badge ${arrived ? 'in' : ''}`} src={rankArt(voyage.rank)} alt=""
            width="384" height="384" decoding="async" />
        )}
        <div className="vy-count">
          <div className="vy-num">{shown}</div>
          <div className="vy-label">kleos</div>
          <div className={`vy-rank ${arrived ? 'in' : ''}`}>{voyage.rank}</div>
        </div>
      </div>
    </div>
  )
}

const pt = (p) => ({ x: p.x, y: p.y })

function twoLines(name) {
  const cut = name.lastIndexOf(' ')
  return cut > 0 && name.length > 12 ? [name.slice(0, cut), name.slice(cut + 1)] : [name, '']
}
