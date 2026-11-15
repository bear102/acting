import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Meander } from '../ui/Art.jsx'

export default function SceneSelect({ onPick, onBack }) {
  const [scenes, setScenes] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api.scenes().then(setScenes).catch((e) => setError(String(e))) }, [])

  const film = scenes?.filter((s) => s.video) || []
  const scrolls = scenes?.filter((s) => !s.video) || []

  return (
    <div className="panel">
      <button className="link" onClick={onBack}>← Back to the shore</button>
      <p className="eyebrow">The wine-dark sea awaits</p>
      <h2>Choose your trial</h2>
      <Meander className="short left" />
      {error && <p className="bad">{error}</p>}
      {!scenes && !error && <p className="muted">Unrolling the scrolls…</p>}

      {film.length > 0 && (
        <>
          <h3 className="section-title">🎬 From the film</h3>
          <div className="grid film-grid">
            {film.map((s) => <FilmCard key={s.id} s={s} onPick={onPick} />)}
          </div>
        </>
      )}
      {scrolls.length > 0 && (
        <>
          <h3 className="section-title">📜 From the ancient scrolls</h3>
          <div className="grid">
            {scrolls.map((s) => (
              <button key={s.id} className="card scroll-card" onClick={() => onPick(s.id)}>
                <CardBody s={s} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FilmCard({ s, onPick }) {
  const ref = useRef(null)
  const play = () => { const v = ref.current; if (v) { v.currentTime = 0; v.play().catch(() => {}) } }
  const stop = () => { const v = ref.current; if (v) { v.pause(); v.currentTime = 0.5 } }
  return (
    <button className="card film-card" onClick={() => onPick(s.id)} onMouseEnter={play} onMouseLeave={stop}
      onFocus={play} onBlur={stop}>
      <div className="poster">
        <video ref={ref} src={`/${s.video}#t=0.5`} preload="metadata" muted playsInline loop />
        <span className="film-badge">🎬 From the film</span>
        {s.has_reference && <span className="shade-badge">👻 Shades available</span>}
      </div>
      <div className="film-body"><CardBody s={s} /></div>
    </button>
  )
}

function CardBody({ s }) {
  return (
    <>
      <div className="card-top">
        <span className="book">{s.book}</span>
        <span className={`badge ${(s.difficulty || 'medium').toLowerCase()}`}>{s.difficulty}</span>
      </div>
      <h3>{s.title}</h3>
      <p>{s.blurb}</p>
      <div className="card-foot">
        <span>👥 {s.characters.length === 1 ? '1 player' : `1–${s.characters.length} players`}</span>
        <span>⏱ {Math.round(s.duration)}s</span>
      </div>
      <div className="cast">{s.characters.map((c) => c.name).join(' · ')}</div>
    </>
  )
}
