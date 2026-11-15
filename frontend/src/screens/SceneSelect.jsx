import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Helmet, Lyre, Owl, Rose, Ship, Trident } from '../ui/Art.jsx'
import VoyageMap from './setup/VoyageMap.jsx'
import { NUMERALS } from './setup/constants.js'
import { Difficulty, HelmetIcon, HourglassIcon } from './setup/icons.jsx'
import './setup/setup.css'
import './setup/scene-select.css'

// The Cyclops's single eye, for the cave scene
function CyclopsEye({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 40" aria-hidden="true">
      <path d="M2 20 Q32 -6 62 20 Q32 46 2 20 Z" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="32" cy="20" r="10" fill="currentColor" />
      <circle cx="32" cy="20" r="4" fill="#f6ecd0" />
      <path d="M14 6 L20 11 M32 1 L32 7 M50 6 L44 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

// Emblem painted on each text scene's papyrus: a fitting symbol per scene, else cycled.
const SCENE_EMBLEMS = {
  'i-am-odysseus': Ship, 'my-name-is-noman': CyclopsEye, 'bound-to-the-mast': Lyre, 'secret-of-the-bed': Rose,
}
const EMBLEMS = [Trident, Owl, Helmet, Ship, Lyre, Rose]

export default function SceneSelect({ onPick, onBack }) {
  const [scenes, setScenes] = useState(null)
  const [error, setError] = useState(null)
  const [hovered, setHovered] = useState(null)
  useEffect(() => { api.scenes().then(setScenes).catch((e) => setError(String(e))) }, [])

  // Film scenes first, then the scrolls; numerals follow that order everywhere.
  const ordered = scenes ? [...scenes.filter((s) => s.video), ...scenes.filter((s) => !s.video)] : []

  return (
    <div className="panel sx">
      <div className="sx-top">
        <button className="link sx-back" onClick={onBack}>← Back</button>
        <header className="sx-head">
          <p className="sx-eyebrow">The wine-dark sea awaits</p>
          <h2 className="sx-title">Choose your trial</h2>
        </header>
        <span className="sx-top-spacer" aria-hidden="true" />
      </div>

      {error && <p className="bad center">{error}</p>}
      {!scenes && !error && <p className="muted center">Unrolling the sea charts…</p>}

      {ordered.length > 0 && (
        <>
          <VoyageMap scenes={ordered} hovered={hovered} onHover={setHovered} onPick={onPick} />
          <div className="sx-grid">
            {ordered.map((s, i) => (
              <SceneCard key={s.id} s={s} n={NUMERALS[i]} emblem={SCENE_EMBLEMS[s.id] || EMBLEMS[i % EMBLEMS.length]}
                on={hovered === s.id} onHover={setHovered} onPick={onPick} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SceneCard({ s, n, emblem: Emblem, on, onHover, onPick }) {
  const ref = useRef(null)
  const film = Boolean(s.video)
  const enter = () => {
    onHover(s.id)
    const v = ref.current
    if (v) { v.currentTime = 0; v.play().catch(() => {}) }
  }
  const leave = () => {
    onHover(null)
    const v = ref.current
    if (v) { v.pause(); v.currentTime = 0.5 }
  }
  const players = s.characters.length === 1 ? '1' : `1–${s.characters.length}`

  return (
    <button className={`sx-card ${film ? 'film' : 'scroll'} ${on ? 'on' : ''}`} onClick={() => onPick(s.id)}
      onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
      title={s.characters.map((c) => c.name).join(' · ')}>
      <div className="sx-art">
        {film ? (
          <>
            <video ref={ref} src={`/${s.video}#t=0.5`} preload="metadata" muted playsInline loop />
            <span className="sx-ribbon">From the film</span>
            <span className="sx-play" aria-hidden="true">▶</span>
          </>
        ) : (
          <Emblem className="sx-emblem" />
        )}
        <span className="sx-num" aria-hidden="true">{n}</span>
      </div>
      <div className="sx-body">
        <span className="sx-book">{s.book.split('·')[0].trim()}</span>
        <h3 className="sx-name">{s.title}</h3>
        <p className="sx-blurb">{s.blurb}</p>
        <div className="sx-meta">
          <span title="Players"><HelmetIcon className="ss-ico" />{players}</span>
          <span title="Length"><HourglassIcon className="ss-ico" />{Math.round(s.duration)}s</span>
          <Difficulty level={s.difficulty || 'Medium'} />
        </div>
      </div>
    </button>
  )
}
