import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Meander } from '../ui/Art.jsx'
import VoyageMap from './setup/VoyageMap.jsx'
import { NUMERALS } from './setup/constants.js'
import { Difficulty, HelmetIcon, HourglassIcon } from './setup/icons.jsx'
import './setup/setup.css'

export default function SceneSelect({ onPick, onBack }) {
  const [scenes, setScenes] = useState(null)
  const [error, setError] = useState(null)
  const [hovered, setHovered] = useState(null)
  useEffect(() => { api.scenes().then(setScenes).catch((e) => setError(String(e))) }, [])

  const numeral = (id) => NUMERALS[scenes.findIndex((s) => s.id === id)] || ''
  const film = scenes?.filter((s) => s.video) || []
  const scrolls = scenes?.filter((s) => !s.video) || []

  return (
    <div className="panel ss-screen">
      <button className="link" onClick={onBack}>← Back to the shore</button>
      <header className="ss-head">
        <p className="eyebrow">The wine-dark sea awaits</p>
        <h2>Choose your trial</h2>
        <p className="ss-lede">Every island holds a trial. Chart your course, and the gods will be watching.</p>
      </header>

      {error && <p className="bad">{error}</p>}
      {!scenes && !error && <p className="muted ss-loading">Unrolling the sea charts…</p>}

      {scenes?.length > 0 && (
        <VoyageMap scenes={scenes} hovered={hovered} onHover={setHovered} onPick={onPick} />
      )}

      {film.length > 0 && (
        <section className="ss-section">
          <h3 className="section-title ss-section-title"><span>From the film</span></h3>
          <div className="ss-grid ss-film-grid">
            {film.map((s) => (
              <FilmCard key={s.id} s={s} n={numeral(s.id)} onPick={onPick}
                on={hovered === s.id} onHover={setHovered} />
            ))}
          </div>
        </section>
      )}

      {scrolls.length > 0 && (
        <section className="ss-section">
          <h3 className="section-title ss-section-title"><span>From the ancient scrolls</span></h3>
          <div className="ss-grid">
            {scrolls.map((s) => (
              <button key={s.id} className={`ss-scroll ${hovered === s.id ? 'on' : ''}`} onClick={() => onPick(s.id)}
                onMouseEnter={() => setHovered(s.id)} onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.id)} onBlur={() => setHovered(null)}>
                <span className="ss-scroll-rod top" aria-hidden="true" />
                <CardBody s={s} n={numeral(s.id)} />
                <span className="ss-scroll-rod bottom" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      )}
      <Meander className="short" />
    </div>
  )
}

function FilmCard({ s, n, onPick, on, onHover }) {
  const ref = useRef(null)
  const play = () => {
    onHover(s.id)
    const v = ref.current
    if (v) { v.currentTime = 0; v.play().catch(() => {}) }
  }
  const stop = () => {
    onHover(null)
    const v = ref.current
    if (v) { v.pause(); v.currentTime = 0.5 }
  }
  return (
    <button className={`ss-film ${on ? 'on' : ''}`} onClick={() => onPick(s.id)}
      onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop}>
      <div className="ss-poster">
        <video ref={ref} src={`/${s.video}#t=0.5`} preload="metadata" muted playsInline loop />
        <span className="ss-ribbon">From the film</span>
        {s.has_reference && <span className="ss-shades">✦ Shades available</span>}
        <span className="ss-play" aria-hidden="true">▶</span>
      </div>
      <div className="ss-film-body"><CardBody s={s} n={n} /></div>
    </button>
  )
}

function CardBody({ s, n }) {
  const players = s.characters.length === 1 ? '1 player' : `1–${s.characters.length} players`
  return (
    <>
      <div className="ss-card-top">
        <span className="ss-num" aria-hidden="true">{n}</span>
        <span className="ss-book">{s.book}</span>
      </div>
      <h3 className="ss-title">{s.title}</h3>
      <p className="ss-blurb">{s.blurb}</p>
      <div className="ss-meta">
        <span title="Players"><HelmetIcon className="ss-ico" />{players}</span>
        <span title="Length"><HourglassIcon className="ss-ico" />{Math.round(s.duration)}s</span>
        <Difficulty level={s.difficulty || 'Medium'} />
      </div>
      <div className="ss-cast">{s.characters.map((c) => c.name).join(' · ')}</div>
    </>
  )
}
