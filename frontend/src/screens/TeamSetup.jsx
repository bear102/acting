import { useState } from 'react'
import { PLAYER_COLORS } from '../playerColors.js'
import { rollCrewName } from '../crewNames.js'
import { MaskArt } from './setup/icons.jsx'
import './setup/crew-setup.css'

// One card per character, left to right. Each card holds the name of the player who plays it.
// With fewer players than characters, a card gets a small "played by" picker, and a player's
// name is typed on the first card they play.
export default function TeamSetup({ scene, initial, onReady, onBack }) {
  const chars = scene.characters
  const maxPlayers = chars.length
  // Every crew starts with a rolled Homeric name: nothing to explain, keep it, edit it or roll again
  const [teamName, setTeamName] = useState(() => (initial?.name && initial.name !== 'Nameless Crew' ? initial.name : rollCrewName()))
  const [count, setCount] = useState(Math.min(initial?.players.length || maxPlayers, maxPlayers))
  const [names, setNames] = useState(() => {
    const base = initial?.players.map((p) => (/^Player \d+$/.test(p.name) ? '' : p.name)) || []
    return [0, 1, 2, 3].map((i) => base[i] || '')
  })
  const [assign, setAssign] = useState(() =>
    // Reuse the previous casting only if it was for this same scene and crew size
    initial?.assignments && chars.every((c) => initial.assignments[c.id] < count)
      && Object.keys(initial.assignments).length === chars.length
      ? initial.assignments : defaultAssign(scene, count))

  const changeCount = (n) => { setCount(n); setAssign(defaultAssign(scene, n)) }
  const setName = (i, v) => setNames(names.map((n, j) => (j === i ? v : n)))
  const players = Array.from({ length: count }, (_, i) => ({ name: names[i]?.trim() || `Player ${i + 1}` }))
  const unused = players.map((_, i) => i).filter((i) => !Object.values(assign).includes(i))
  const doubling = count < maxPlayers
  // The card where each player's name is typed: the first character they play
  const firstCardOf = (pi) => chars.find((c) => assign[c.id] === pi)?.id
  const ready = unused.length === 0

  return (
    <div className="panel cs">
      <header className="cs-head">
        <p className="eyebrow">{scene.book}</p>
        <h2>{scene.title}</h2>
        <p className="cs-sub">{maxPlayers > 1 ? 'Who plays whom?' : 'Who takes the stage?'}</p>
      </header>

      <div className="cs-bar">
        <div className="cs-crew-wrap">
          <input className="cs-crew" value={teamName} maxLength={32} placeholder="Crew name"
            aria-label="Crew name" onChange={(e) => setTeamName(e.target.value)} />
          <button type="button" className="cs-roll" title="Roll another name" aria-label="Roll another crew name"
            onClick={() => setTeamName(rollCrewName())}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
              {[[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />)}
            </svg>
          </button>
        </div>
        {maxPlayers > 1 && (
          <div className="cs-count" role="radiogroup" aria-label="Number of players">
            <span>Players</span>
            {Array.from({ length: maxPlayers }, (_, i) => i + 1).map((n) => (
              <button key={n} role="radio" aria-checked={n === count}
                className={n === count ? 'on' : ''} onClick={() => changeCount(n)}>{n}</button>
            ))}
          </div>
        )}
      </div>

      <div className="cs-cards" style={{ '--n': maxPlayers }}>
        {chars.map((c, ci) => {
          const p = assign[c.id]
          const color = PLAYER_COLORS[p]
          const typesName = firstCardOf(p) === c.id
          return (
            <div key={c.id} className="cs-card" style={{ '--pc': color }}>
              <div className="cs-card-top">
                <MaskArt tragic={ci % 2 === 1} className="cs-mask" />
                <div className="cs-char">
                  <strong>{c.name}</strong>
                  <small title={c.description}>{c.description}</small>
                </div>
              </div>

              <div className="cs-player">
                {doubling ? (
                  <select className="cs-pick" value={p} aria-label={`Who plays ${c.name}`}
                    onChange={(e) => setAssign({ ...assign, [c.id]: +e.target.value })}>
                    {players.map((_, i) => <option key={i} value={i}>Player {i + 1}</option>)}
                  </select>
                ) : (
                  <span className="cs-num" aria-hidden="true">{p + 1}</span>
                )}
                {typesName ? (
                  <input className="cs-name" value={names[p]} placeholder={`Player ${p + 1}'s name`} maxLength={16}
                    aria-label={`Name of player ${p + 1}`} onChange={(e) => setName(p, e.target.value)} />
                ) : (
                  <span className="cs-also">also {players[p].name}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {count > 1 && (
        <div className="cs-floor" role="img"
          aria-label={`Stand in front of the camera, left to right: ${players.map((pl) => pl.name).join(', ')}`}>
          {/* a floor plan instead of a sentence: the camera, and where each player stands before it */}
          <svg className="cs-floor-cam" viewBox="0 0 64 30" aria-hidden="true">
            <rect x="12" y="2" width="40" height="22" rx="3" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <circle cx="32" cy="13" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <circle cx="32" cy="13" r="1.6" fill="currentColor" />
            <path d="M4 28 H60" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          <div className="cs-floor-row">
            {players.map((pl, i) => (
              <span key={i} className="cs-floor-p" style={{ '--pc': PLAYER_COLORS[i] }}>
                <svg viewBox="0 0 40 44" aria-hidden="true">
                  <circle cx="20" cy="12" r="9" />
                  <path d="M3 44 Q3 24 20 24 Q37 24 37 44 Z" />
                  <text x="20" y="40" textAnchor="middle">{i + 1}</text>
                </svg>
                <span>{pl.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="cs-actions">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <button className="btn big" disabled={!ready}
          onClick={() => onReady({ name: teamName.trim() || rollCrewName(), players, assignments: assign })}>
          Set sail →
        </button>
      </div>
      {!ready && <p className="cs-warn">Give {unused.map((i) => players[i].name).join(' and ')} a role.</p>}
    </div>
  )
}

function defaultAssign(scene, n) {
  return Object.fromEntries(scene.characters.map((c, i) => [c.id, i % n]))
}
