import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function SceneSelect({ onPick, onBack }) {
  const [scenes, setScenes] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api.scenes().then(setScenes).catch((e) => setError(String(e))) }, [])

  return (
    <div className="panel">
      <button className="link" onClick={onBack}>← Back</button>
      <h2>Choose your trial</h2>
      {error && <p className="bad">{error}</p>}
      {!scenes && !error && <p className="muted">Unrolling the scrolls…</p>}
      <div className="grid">
        {scenes?.map((s) => (
          <button key={s.id} className="card scene-card" onClick={() => onPick(s.id)}>
            <div className="card-top">
              <span className="book">{s.book}</span>
              <span className={`badge ${s.difficulty.toLowerCase()}`}>{s.difficulty}</span>
            </div>
            <h3>{s.title}</h3>
            <p>{s.blurb}</p>
            <div className="card-foot">
              <span>👥 {s.characters.length === 1 ? '1 player' : `1–${s.characters.length} players`}</span>
              <span>⏱ {Math.round(s.duration)}s</span>
              {s.video && <span>🎬 film clip</span>}
            </div>
            <div className="cast">{s.characters.map((c) => c.name).join(' · ')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
