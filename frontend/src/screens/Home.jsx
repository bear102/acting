import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Helmet, Lyre, Owl, Rose, Ship } from '../ui/Art.jsx'
import { IonicColumn, Pediment, Rosette, SeaVoyage } from '../theme/Temple.jsx'
import '../theme/home.css'

// Odyssey I.1, Samuel Butler's translation (public domain)
const PROEM = 'Tell me, O Muse, of that ingenious hero who travelled far and wide after he had sacked the famous town of Troy.'

const GODS = [
  [Owl, 'Athena', 'Words'],
  [Lyre, 'Apollo', 'Voice'],
  [Helmet, 'Ares', 'Movement'],
  [Rose, 'Aphrodite', 'Emotion'],
]

export default function Home({ onStart, onHall }) {
  const [health, setHealth] = useState(null)
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])

  return (
    <div className="oh">
      <header className="oh-temple">
        <Pediment className="oh-pediment" />
        <div className="oh-portico">
          <IonicColumn className="oh-column" />
          <div className="oh-title-block">
            <p className="eyebrow">HackUTA ’26 · An acting trial before the gods</p>
            <h1 className="title oh-title">
              <span className="title-small">The</span>
              Trials of<br />Odysseus
            </h1>
          </div>
          <IonicColumn className="oh-column" />
        </div>
        <div className="oh-stylobate" />
      </header>

      <blockquote className="oh-proem">
        <p>
          {PROEM.split(' ').map((w, i) => (
            <span key={i} style={{ '--i': i }}>{w} </span>
          ))}
        </p>
        <cite>Homer, <em>Odyssey</em> I · tr. Samuel Butler</cite>
      </blockquote>

      <p className="tagline oh-tagline">
        Choose a scene. Gather your crew. Watch the film, then perform it before the camera,
        and the gods of Olympus will judge your words, your voice, your body and your soul.
      </p>

      <div className="oh-actions">
        <button className="oh-shield" onClick={onStart}>
          <Rosette className="oh-boss" />
          <span>Begin your trial</span>
        </button>
        <button className="btn ghost" onClick={onHall}>Hall of Heroes</button>
      </div>

      <ul className="oh-gods" aria-label="The judges">
        {GODS.map(([Art, name, dom], k) => (
          <li key={name} className="oh-medallion" style={{ '--k': k }}>
            <div className="oh-medal-disc"><Art className="oh-medal-art" /></div>
            <span className="oh-god-name">{name}</span>
            <span className="oh-god-domain">judges {dom.toLowerCase()}</span>
          </li>
        ))}
      </ul>

      <SeaVoyage><Ship className="oh-ship" /></SeaVoyage>

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
