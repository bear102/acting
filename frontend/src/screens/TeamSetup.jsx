import { useEffect, useRef, useState } from 'react'
import { PLAYER_COLORS } from '../playerColors.js'
import { rollCrewName } from '../crewNames.js'
import { CameraGlyph, Chevron, DiceGlyph, StageMask } from './setup/CrewArt.jsx'
import { charPortrait } from '../ui/charArt.js'
import './setup/crew-setup.css'

// The screen is the stage. One column per player, left to right in the order they stand before
// the camera; a player's column holds the mask of every character they play, on a plinth with
// their number and name. Parts move between neighbours with the chevrons on a card, and a move
// that would leave someone without a part trades instead, so the cast is always playable:
// "Set sail" (or Enter, anywhere) works from the first frame with nothing typed.
export default function TeamSetup({ scene, initial, onReady, onBack }) {
  const chars = scene.characters
  const maxPlayers = chars.length
  // Every crew starts with a rolled Homeric name: nothing to explain, keep it, edit it or roll again
  const [teamName, setTeamName] = useState(() => (initial?.name && initial.name !== 'Nameless Crew' ? initial.name : rollCrewName()))
  const [rolls, setRolls] = useState(0)
  const [count, setCount] = useState(Math.min(initial?.players.length || maxPlayers, maxPlayers))
  const [names, setNames] = useState(() => {
    const base = initial?.players.map((p) => (/^Player \d+$/.test(p.name) ? '' : p.name)) || []
    return [0, 1, 2, 3].map((i) => base[i] || '')
  })
  const [assign, setAssign] = useState(() =>
    // Reuse the previous casting only if it was for this same scene and crew size
    initial?.assignments && chars.every((c) => initial.assignments[c.id] < count)
      && Object.keys(initial.assignments).length === chars.length && isPlayable(scene, initial.assignments, count)
      ? initial.assignments : defaultAssign(scene, count))

  const root = useRef(null)
  const goBtn = useRef(null)
  const moved = useRef(null) // { id, dir }: the card that just changed hands, so focus can follow it

  // Enter continues from the first frame; typing a name is optional
  useEffect(() => { goBtn.current?.focus({ preventScroll: true }) }, [])
  // A card that changes hands is re-mounted in its new column: put focus back on its chevron
  useEffect(() => {
    if (!moved.current) return
    const { id, dir } = moved.current
    moved.current = null
    const card = [...(root.current?.querySelectorAll('.cs-card') || [])].find((el) => el.dataset.char === id)
    const btn = card?.querySelector(`.cs-move[data-dir="${dir}"]`) || card?.querySelector('.cs-move')
    btn?.focus({ preventScroll: true })
  }, [assign])

  const changeCount = (n) => { setCount(n); setAssign(defaultAssign(scene, n)) }
  const setName = (i, v) => setNames(names.map((n, j) => (j === i ? v : n)))
  const players = Array.from({ length: count }, (_, i) => ({ name: names[i]?.trim() || `Player ${i + 1}` }))
  const lineCount = (id) => scene.lines?.filter((l) => l.character === id).length || 0

  // Hand a character to the neighbouring player. If that empties the giver's hands, they take
  // one of the receiver's parts in return.
  const give = (id, dir) => {
    const from = assign[id]
    const to = from + dir
    const next = { ...assign, [id]: to }
    if (!chars.some((c) => next[c.id] === from)) {
      const back = chars.find((c) => c.id !== id && assign[c.id] === to)
      if (!back) return
      next[back.id] = from
    }
    moved.current = { id, dir }
    setAssign(next)
  }

  const submit = (e) => {
    e.preventDefault()
    const assignments = isPlayable(scene, assign, count) ? assign : defaultAssign(scene, count)
    onReady({ name: teamName.trim() || rollCrewName(), players, assignments })
  }

  return (
    <form ref={root} className="cs" style={{ '--n': maxPlayers }} onSubmit={submit} noValidate>
      <header className="cs-top">
        <button type="button" className="link cs-back" onClick={onBack}>← Back</button>
        <div className="cs-head">
          <p className="eyebrow">{scene.book}</p>
          <h2>{scene.title}</h2>
        </div>
        <span className="cs-top-spacer" aria-hidden="true" />
      </header>

      <div className="cs-bar">
        <label className="cs-pill cs-crew-pill">
          <span className="cs-tag">Crew</span>
          <input key={rolls} className="cs-crew" value={teamName} maxLength={32} placeholder="Crew name" aria-label="Crew name"
            autoComplete="off" spellCheck={false} enterKeyHint="go" onChange={(e) => setTeamName(e.target.value)} />
          <button type="button" className="cs-roll" title="Roll another name" aria-label="Roll another crew name"
            onClick={() => { setTeamName(rollCrewName()); setRolls(rolls + 1) }}>
            <DiceGlyph />
          </button>
        </label>
        {maxPlayers > 1 && (
          <div className="cs-pill cs-count" role="radiogroup" aria-label="Number of players">
            <span className="cs-tag" aria-hidden="true">Players</span>
            {Array.from({ length: maxPlayers }, (_, i) => i + 1).map((n) => (
              <label key={n} className="cs-n">
                <input type="radio" name="cs-count" value={n} checked={n === count}
                  aria-label={`${n} ${n === 1 ? 'player' : 'players'}`} onChange={() => changeCount(n)} />
                <span aria-hidden="true">{n}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="cs-stage">
        <div className="cs-spots">
          {players.map((pl, p) => {
            const mine = chars.filter((c) => assign[c.id] === p)
            return (
              <section key={p} className="cs-spot" aria-label={`${pl.name}: ${mine.map((c) => c.name).join(' and ')}`}
                style={{ '--pc': PLAYER_COLORS[p], '--k': mine.length || 1 }}>
                {/* first in the DOM so Tab reaches the name before the cards; drawn under them */}
                <div className="cs-plinth">
                  <span className="cs-num" aria-hidden="true">{p + 1}</span>
                  <input className="cs-name" value={names[p]} placeholder={`Player ${p + 1}`} maxLength={16}
                    autoComplete="off" spellCheck={false} enterKeyHint="go"
                    aria-label={`Player ${p + 1} name`} onChange={(e) => setName(p, e.target.value)} />
                </div>
                <div className="cs-roles">
                  {mine.map((c) => {
                    const ci = chars.indexOf(c)
                    const n = lineCount(c.id)
                    return (
                      <article key={c.id} className="cs-card" data-char={c.id} style={{ '--i': ci }}>
                        {[-1, 1].map((dir) => players[p + dir] && (
                          <button key={dir} type="button" className={`cs-move ${dir < 0 ? 'left' : 'right'}`} data-dir={dir}
                            title={`Give ${c.name} to ${players[p + dir].name}`}
                            aria-label={`Give ${c.name} to ${players[p + dir].name}`}
                            onClick={() => give(c.id, dir)}>
                            <Chevron dir={dir} />
                          </button>
                        ))}
                        <span className={`cs-medal${charPortrait(scene.id, c.id) ? ' has-portrait' : ''}`}>
                          {charPortrait(scene.id, c.id)
                            ? <img className="cs-portrait" src={charPortrait(scene.id, c.id)} alt="" width="84" height="84" decoding="async" />
                            : <StageMask tragic={ci % 2 === 1} className="cs-mask" />}
                        </span>
                        <h3 className="cs-char">{c.name}</h3>
                        <p className="cs-desc" title={c.description}>{c.description}</p>
                        {n > 0 && <span className="cs-lines">{n} {n === 1 ? 'line' : 'lines'}</span>}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
        {count > 1 && (
          <div className="cs-floor" aria-hidden="true">
            <CameraGlyph className="cs-cam" />
            <span>Camera</span>
          </div>
        )}
      </div>

      <div className="cs-actions">
        <button ref={goBtn} type="submit" className="btn big cs-go">Set sail →</button>
        <kbd className="cs-key" aria-hidden="true">↵</kbd>
      </div>
    </form>
  )
}

// Every player holds at least one part
function isPlayable(scene, assign, n) {
  const held = new Set(scene.characters.map((c) => assign[c.id]))
  return Array.from({ length: n }, (_, i) => i).every((i) => held.has(i))
}

// A full crew plays the characters in scene order. A short-handed one shares the work: the
// biggest parts go out first, each to whoever has the fewest lines so far, so the player who
// doubles gets the two small roles. Players are then numbered in scene order of their first part.
function defaultAssign(scene, n) {
  const chars = scene.characters
  if (n >= chars.length) return Object.fromEntries(chars.map((c, i) => [c.id, i]))
  const weight = chars.map((c) => 1 + (scene.lines?.filter((l) => l.character === c.id).length || 0))
  const load = Array(n).fill(0)
  const owner = []
  chars.map((_, i) => i).sort((a, b) => weight[b] - weight[a] || a - b).forEach((ci) => {
    const p = load.indexOf(Math.min(...load))
    owner[ci] = p
    load[p] += weight[ci]
  })
  const order = [...new Set(owner)]
  return Object.fromEntries(chars.map((c, i) => [c.id, order.indexOf(owner[i])]))
}
