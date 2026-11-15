import { useState } from 'react'
import { PLAYER_COLORS } from '../vision.js'
import { Meander } from '../ui/Art.jsx'

export default function TeamSetup({ scene, initial, onReady, onBack }) {
  const maxPlayers = scene.characters.length
  const [teamName, setTeamName] = useState(initial?.name || '')
  const [count, setCount] = useState(Math.min(initial?.players.length || maxPlayers, maxPlayers))
  const [names, setNames] = useState(() => initial?.players.map((p) => p.name) || ['', '', '', ''])
  const [assign, setAssign] = useState(() => defaultAssign(scene, count))

  const changeCount = (n) => { setCount(n); setAssign(defaultAssign(scene, n)) }
  const players = Array.from({ length: count }, (_, i) => ({ name: names[i]?.trim() || `Player ${i + 1}` }))
  const unused = players.map((_, i) => i).filter((i) => !Object.values(assign).includes(i))

  return (
    <div className="panel narrow tablet">
      <button className="link" onClick={onBack}>← Back</button>
      <p className="eyebrow">{scene.book}</p>
      <h2>{scene.title}</h2>
      <p className="subtitle">Assemble your crew</p>
      <Meander className="short left" />

      <label className="field">
        <span>Crew name</span>
        <input value={teamName} maxLength={32} placeholder="e.g. The Wine-Dark Wanderers"
          onChange={(e) => setTeamName(e.target.value)} />
      </label>

      <div className="field">
        <span>How many mortals?</span>
        <div className="seg">
          {Array.from({ length: maxPlayers }, (_, i) => i + 1).map((n) => (
            <button key={n} className={n === count ? 'on' : ''} onClick={() => changeCount(n)}>{n}</button>
          ))}
        </div>
        {count < maxPlayers && <small className="muted">Some of you will play more than one role.</small>}
      </div>

      <div className="field">
        <span>Players: stand left to right in this order</span>
        <div className="players">
          {players.map((p, i) => (
            <div key={i} className="player-chip" style={{ borderColor: PLAYER_COLORS[i] }}>
              <span className="pos" style={{ background: PLAYER_COLORS[i] }}>{i + 1}</span>
              <input value={names[i]} placeholder={`Player ${i + 1}`} maxLength={16}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
            </div>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Casting</span>
        {scene.characters.map((c) => (
          <div key={c.id} className="cast-row">
            <div>
              <strong>{c.name}</strong>
              <small className="muted"> · {c.description}</small>
            </div>
            <select value={assign[c.id]} style={{ color: PLAYER_COLORS[assign[c.id]] }}
              onChange={(e) => setAssign({ ...assign, [c.id]: +e.target.value })}>
              {players.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
            </select>
          </div>
        ))}
        {unused.length > 0 && (
          <small className="bad">{unused.map((i) => players[i].name).join(', ')} has no role yet.</small>
        )}
      </div>

      <button className="btn big" disabled={unused.length > 0}
        onClick={() => onReady({ name: teamName.trim() || 'Nameless Crew', players, assignments: assign })}>
        Set sail for rehearsal →
      </button>
    </div>
  )
}

function defaultAssign(scene, n) {
  return Object.fromEntries(scene.characters.map((c, i) => [c.id, i % n]))
}
