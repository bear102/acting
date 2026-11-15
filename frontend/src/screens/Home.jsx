import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Helmet, Lyre, Meander, Owl, Rose, Ship } from '../ui/Art.jsx'

export default function Home({ onStart, onHall }) {
  const [health, setHealth] = useState(null)
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])

  return (
    <div className="home">
      <p className="eyebrow">HackUTA ’26 · Sing, O Muse</p>
      <h1 className="title">
        <span className="title-small">The</span>
        Trials of<br />Odysseus
      </h1>
      <Meander className="short" />
      <p className="tagline">
        Choose a scene from the Odyssey. Gather your crew. Follow the <em>Shades</em> of the actors who
        came before, and perform before the camera. The gods of Olympus will judge your words, your
        voice, your body and your soul.
      </p>
      <div className="row center-row">
        <button className="btn big" onClick={onStart}>Begin your trial</button>
        <button className="btn ghost" onClick={onHall}>Hall of Heroes</button>
      </div>

      <div className="home-gods">
        {[[Owl, 'Athena', 'Words'], [Lyre, 'Apollo', 'Voice'], [Helmet, 'Ares', 'Movement'], [Rose, 'Aphrodite', 'Emotion']].map(([Art, name, dom]) => (
          <div key={name} className="home-god">
            <Art className="home-god-art" />
            <span className="home-god-name">{name}</span>
            <span className="muted small">{dom}</span>
          </div>
        ))}
      </div>

      <div className="voyage" aria-hidden="true"><Ship className="voyage-ship" /></div>

      <div className="status">
        {health === null ? 'Consulting the oracle…' : !health.ok ? (
          <span className="bad">Backend offline. Start it on port 8000.</span>
        ) : (
          <>
            <Dot on={health.elevenlabs} label="ElevenLabs" />
            {'whisper' in health && <Dot on={health.whisper} label="Whisper" />}
            <Dot on={health.gemini} label="Gemini" />
            <Dot on={health.leaderboard === 'mongodb'} label={health.leaderboard === 'mongodb' ? 'MongoDB' : 'Local scores'} />
          </>
        )}
      </div>
    </div>
  )
}

function Dot({ on, label }) {
  return <span className="dot-label"><span className={`dot ${on ? 'on' : ''}`} />{label}</span>
}
