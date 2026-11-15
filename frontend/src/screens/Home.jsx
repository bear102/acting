import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Rosette } from '../theme/Temple.jsx'
import LandingScene from '../landing/LandingScene.jsx'
import { ActIcon, JudgedIcon, WatchIcon } from '../landing/StepIcons.jsx'
import '../theme/home.css'

const STEPS = [
  [WatchIcon, 'Watch'],
  [ActIcon, 'Act'],
  [JudgedIcon, 'Be judged'],
]

export default function Home({ onStart, onHall }) {
  const [health, setHealth] = useState(null)
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })) }, [])

  return (
    <div className="lp">
      <LandingScene />

      <main className="lp-hero">
        <h1 className="lp-title">
          <span className="lp-title-small">The Trials of</span>
          <span className="lp-title-big-wrap">
            <span className="lp-title-big">Odysseus</span>
            {/* brighter copy that fades in and out: an opacity-only gleam (no repaint) */}
            <span className="lp-title-gleam" aria-hidden="true">Odysseus</span>
          </span>
        </h1>
        <p className="lp-hook">Act the epic. Face the gods.</p>

        <div className="lp-actions">
          <button className="lp-cta" onClick={onStart}>
            <Rosette className="lp-rosette" />
            <span>Begin your trial</span>
            <Rosette className="lp-rosette" />
          </button>
          <button className="lp-ghost" onClick={onHall}>Hall of Heroes</button>
        </div>

        <ol className="lp-steps" aria-label="How it works">
          {STEPS.map(([Icon, label], i) => (
            <li key={label} style={{ '--i': i }}>
              <Icon className="lp-step-icon" />
              <span>{label}</span>
            </li>
          ))}
        </ol>
      </main>

      <Oracles health={health} />
    </div>
  )
}

// Tiny corner indicator for the backend services; labels appear on hover/focus.
function Oracles({ health }) {
  const items = !health ? [] : !health.ok ? [] : [
    ['ElevenLabs', health.elevenlabs],
    ...('whisper' in health ? [['Whisper', health.whisper]] : []),
    ['Gemini', health.gemini],
    [health.leaderboard === 'mongodb' ? 'MongoDB' : 'Local scores', health.leaderboard === 'mongodb'],
  ]
  const summary = health === null ? 'Consulting the oracles…'
    : !health.ok ? 'Backend offline. Start it on port 8000.'
      : items.map(([n, on]) => `${n}: ${on ? 'on' : 'off'}`).join(' · ')
  return (
    <div className={`lp-oracles ${health && !health.ok ? 'down' : ''}`} tabIndex={0} title={summary} aria-label={summary}>
      <span className="lp-oracles-dots">
        {health === null && <i className="pending" />}
        {health && !health.ok && <i className="off" />}
        {items.map(([n, on]) => <i key={n} className={on ? 'on' : ''} />)}
      </span>
      <span className="lp-oracles-label">{health && !health.ok ? 'Backend offline' : 'Oracles'}</span>
      <span className="lp-oracles-detail">{summary}</span>
    </div>
  )
}
