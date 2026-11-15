import { useState } from 'react'
import { PLAYER_COLORS } from '../playerColors.js'
import { MaskArt, ShieldArt } from './setup/icons.jsx'
import './setup/setup.css'

export default function TeamSetup({ scene, initial, onReady, onBack }) {
  const maxPlayers = scene.characters.length
  const [teamName, setTeamName] = useState(initial?.name || '')
  const [count, setCount] = useState(Math.min(initial?.players.length || maxPlayers, maxPlayers))
  const [names, setNames] = useState(() => {
    const base = initial?.players.map((p) => (/^Player \d+$/.test(p.name) ? '' : p.name)) || []
    return [0, 1, 2, 3].map((i) => base[i] || '')
  })
  const [assign, setAssign] = useState(() =>
    // Reuse the previous casting only if it was for this same scene and crew size
    initial?.assignments && scene.characters.every((c) => initial.assignments[c.id] < count)
      && Object.keys(initial.assignments).length === scene.characters.length
      ? initial.assignments : defaultAssign(scene, count))
  const [dropTarget, setDropTarget] = useState(-1)

  const changeCount = (n) => { setCount(n); setAssign(defaultAssign(scene, n)) }
  const players = Array.from({ length: count }, (_, i) => ({ name: names[i]?.trim() || `Player ${i + 1}` }))
  const unused = players.map((_, i) => i).filter((i) => !Object.values(assign).includes(i))
  const charsOf = (pi) => scene.characters.filter((c) => assign[c.id] === pi)

  const cast = (charId, pi) => setAssign({ ...assign, [charId]: pi })
  const onDrop = (e, pi) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (id && id in assign) cast(id, pi)
    setDropTarget(-1)
  }

  return (
    <div className="panel ss-screen ss-team">
      <button className="link" onClick={onBack}>← Back to the chart</button>
      <header className="ss-head">
        <p className="eyebrow">{scene.book}</p>
        <h2>{scene.title}</h2>
        <p className="ss-lede">Assemble your crew</p>
      </header>

      <div className="ss-team-grid">
        <section className="ss-team-left">
          <label className="ss-plaque">
            <span className="ss-plaque-label">Name of your crew</span>
            <input value={teamName} maxLength={32} placeholder="The Wine-Dark Wanderers"
              onChange={(e) => setTeamName(e.target.value)} />
          </label>

          <div className="ss-count">
            <span className="ss-field-label">How many mortals?</span>
            <div className="ss-coins" role="radiogroup" aria-label="Number of players">
              {Array.from({ length: maxPlayers }, (_, i) => i + 1).map((n) => (
                <button key={n} role="radio" aria-checked={n === count}
                  className={`ss-coin ${n === count ? 'on' : ''}`} onClick={() => changeCount(n)}>{n}</button>
              ))}
            </div>
            {count < maxPlayers && <small className="muted">Some of you will wear more than one mask.</small>}
          </div>

          <div className="ss-field-label ss-stand">
            <span className="ss-arrow" aria-hidden="true">←</span>
            Stand left to right in this order, facing the camera
            <span className="ss-arrow" aria-hidden="true">→</span>
          </div>
          <div className="ss-shields">
            {players.map((p, i) => (
              <div key={i}
                className={`ss-shield ${dropTarget === i ? 'drop' : ''}`}
                style={{ '--pc': PLAYER_COLORS[i] }}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(i) }}
                onDragLeave={() => setDropTarget(-1)}
                onDrop={(e) => onDrop(e, i)}>
                <ShieldArt color={PLAYER_COLORS[i]} className="ss-shield-art">
                  <text x="60" y="72" textAnchor="middle" className="ss-shield-num">{i + 1}</text>
                </ShieldArt>
                <input className="ss-shield-name" value={names[i]} placeholder={`Player ${i + 1}`} maxLength={16}
                  aria-label={`Name of player ${i + 1}`}
                  onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
                <div className="ss-shield-roles">
                  {charsOf(i).length ? charsOf(i).map((c) => <span key={c.id}>{c.name}</span>)
                    : <span className="ss-norole">no mask yet</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ss-team-right">
          <span className="ss-field-label">Hand out the masks</span>
          <p className="muted small ss-hint">Tap a shield under each mask, or drag the mask onto a shield.</p>
          <div className="ss-masks">
            {scene.characters.map((c, ci) => {
              const p = assign[c.id]
              return (
                <div key={c.id} className="ss-mask" style={{ '--pc': PLAYER_COLORS[p] }}
                  draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}>
                  <MaskArt tragic={ci % 2 === 1} className="ss-mask-art" />
                  <div className="ss-mask-text">
                    <strong>{c.name}</strong>
                    <small>{c.description}</small>
                  </div>
                  <div className="ss-mask-pick" role="radiogroup" aria-label={`Who plays ${c.name}`}>
                    {players.map((pl, i) => (
                      <button key={i} role="radio" aria-checked={p === i} title={pl.name}
                        className={`ss-mini-shield ${p === i ? 'on' : ''}`}
                        style={{ '--pc': PLAYER_COLORS[i] }} onClick={() => cast(c.id, i)}>
                        {i + 1}
                      </button>
                    ))}
                    <span className="ss-mask-who">{players[p]?.name}</span>
                  </div>
                </div>
              )
            })}
          </div>
          {unused.length > 0 && (
            <p className="bad small">{unused.map((i) => players[i].name).join(', ')} has no mask yet.</p>
          )}
        </section>
      </div>

      <div className="ss-cta-row">
        <button className="btn big ss-cta" disabled={unused.length > 0}
          onClick={() => onReady({ name: teamName.trim() || 'Nameless Crew', players, assignments: assign })}>
          Set sail for rehearsal →
        </button>
      </div>
    </div>
  )
}

function defaultAssign(scene, n) {
  return Object.fromEntries(scene.characters.map((c, i) => [c.id, i % n]))
}
