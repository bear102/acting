import { useState } from 'react'
import { PLAYER_COLORS } from '../playerColors.js'
import { MaskArt } from './setup/icons.jsx'
import './setup/crew-setup.css'

// One card per character, left to right. Each card holds the name of the player who plays it.
// With fewer players than characters, a card gets a small "played by" picker, and a player's
// name is typed on the first card they play.
export default function TeamSetup({ scene, initial, onReady, onBack }) {
  const chars = scene.characters
  const maxPlayers = chars.length
  const [teamName, setTeamName] = useState(initial?.name && initial.name !== 'Nameless Crew' ? initial.name : '')
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
        <input className="cs-crew" value={teamName} maxLength={32} placeholder="Crew name (optional)"
          aria-label="Crew name" onChange={(e) => setTeamName(e.target.value)} />
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
        <p className="cs-order" aria-label="Standing order">
          <span className="cs-arrow">←</span> Stand left to right:
          {players.map((pl, i) => (
            <span key={i} className="cs-order-p" style={{ '--pc': PLAYER_COLORS[i] }}>{i + 1} {pl.name}</span>
          ))}
          <span className="cs-arrow">→</span>
        </p>
      )}

      <div className="cs-actions">
        <button className="btn ghost" onClick={onBack}>← Back</button>
        <button className="btn big" disabled={!ready}
          onClick={() => onReady({ name: teamName.trim() || 'Nameless Crew', players, assignments: assign })}>
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
