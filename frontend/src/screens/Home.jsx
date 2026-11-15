import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function Home({ onStart, onHall }) {
  const [health, setHealth] = useState(null)
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])

  return (
    <div className="home">
      <div className="meander" />
      <p className="eyebrow">A party game of epic proportions</p>
      <h1 className="title">Trials of<br />Odysseus</h1>
      <p className="tagline">
        Choose a scene from the Odyssey. Gather your crew. Perform it before the camera
        and let the gods of Olympus judge your words, your voice, your body and your soul.
      </p>
      <div className="row center-row">
        <button className="btn big" onClick={onStart}>Begin your trial</button>
        <button className="btn ghost" onClick={onHall}>Hall of Heroes</button>
      </div>
      <div className="meander" />
      <div className="status">
        {health === null ? 'Consulting the oracle…' : !health.ok ? (
          <span className="bad">Backend offline. Start it on port 8000.</span>
        ) : (
          <>
            <Dot on={health.elevenlabs} label="ElevenLabs" />
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
