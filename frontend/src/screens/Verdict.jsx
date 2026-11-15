import { useCallback, useEffect, useState } from 'react'
import { PLAYER_COLORS } from '../vision.js'
import { Bolt, GOD_ART } from '../ui/Art.jsx'
import Voyage from '../verdict/Voyage.jsx'
import Reel from '../verdict/Reel.jsx'
import '../theme/verdict.css'

const GODS = [
  { key: 'athena', name: 'Athena', domain: 'Words' },
  { key: 'apollo', name: 'Apollo', domain: 'Voice' },
  { key: 'ares', name: 'Ares', domain: 'Movement' },
  { key: 'aphrodite', name: 'Aphrodite', domain: 'Emotion' },
]
const RING = 2 * Math.PI * 34
const STT_NAMES = { elevenlabs: 'ElevenLabs Scribe', whisper: 'Whisper', browser: 'browser speech recognition' }

// Verdict = where you landed (voyage) -> how each line went (reel) -> the four gods -> laurels.
export default function Verdict({ result, scene, snaps, onRetry, onNew, onHall }) {
  const [arrived, setArrived] = useState(false)
  const [past] = useState(() => recall(result)) // this crew's earlier voyages, read before we record this one
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name || id
  const { reel, verdict, hall } = result
  const next = reel.voyage.next

  useEffect(() => { record(result) }, [result])
  const onArrive = useCallback(() => setArrived(true), [])

  const delta = past.last == null ? null : result.kleos - past.last
  const isBest = past.best != null && result.kleos > past.best

  return (
    <div className="panel verdict vd">
      <p className="eyebrow center">{result.scene_title} · {result.team_name}</p>

      <Voyage voyage={reel.voyage} onArrive={onArrive} />

      <div className={`vd-after ${arrived ? 'in' : ''}`}>
        {verdict.epithet && <div className="vd-epithet">“{result.team_name}, {verdict.epithet}”</div>}
        <div className="vd-chips">
          {next
            ? <span className="vd-chip goal"><b>{next.gap}</b> kleos to {next.name}</span>
            : <span className="vd-chip goal">No rank stands above you</span>}
          {isBest && <span className="vd-chip up">★ Personal best</span>}
          {delta != null && delta !== 0 && (
            <span className={`vd-chip ${delta > 0 ? 'up' : 'down'}`}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} on your last voyage
            </span>
          )}
          {hall && (
            <span className="vd-chip">
              #{hall.place} of {hall.of} in the Hall
              {hall.rival && <> · <b>{hall.rival.gap}</b> behind {hall.rival.team_name}</>}
            </span>
          )}
        </div>
        {/* Right under the score, in normal flow: reachable without scrolling, never floats over content */}
        <div className="row center-row vd-actions">
          <button className="btn" onClick={onRetry}>↻ {next ? `Chase ${next.name}` : 'Sail it again'}</button>
          <button className="btn ghost" onClick={onNew}>New trial</button>
          <button className="btn ghost" onClick={onHall}>Hall of Heroes</button>
        </div>
      </div>

      <Reel reel={reel} scene={scene} snaps={snaps} start={arrived} charName={charName} />

      <h3 className="section-title">The council</h3>
      <div className="vd-gods">
        {GODS.map((g, i) => {
          const score = result.judges[g.key]?.score ?? 0
          const Art = GOD_ART[g.key]
          return (
            <div key={g.key} className={`vd-god ${arrived ? 'in' : ''}`} style={{ '--i': i }}>
              <div className="vd-ring">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle className="track" cx="40" cy="40" r="34" />
                  <circle className="fill" cx="40" cy="40" r="34" strokeDasharray={RING}
                    strokeDashoffset={arrived ? RING * (1 - score / 100) : RING} />
                </svg>
                <span className="vd-ring-num">{score}</span>
              </div>
              <div className="vd-god-name"><Art className="vd-god-art" /> {g.name}</div>
              <div className="vd-god-domain">{g.domain}</div>
              {verdict[g.key] && <p className="vd-zinger">“{verdict[g.key]}”</p>}
            </div>
          )
        })}
      </div>

      <p className={`vd-zeus ${arrived ? 'in' : ''}`}>
        <Bolt className="vd-zeus-bolt" />
        <span><b>Zeus</b> {verdict.zeus}</span>
      </p>

      {(reel.awards.length > 0 || reel.crew.length > 0) && <h3 className="section-title">Laurels</h3>}
      {reel.awards.length > 0 && (
        <div className="vd-awards">
          {reel.awards.map((a) => (
            <div key={a.id} className={`vd-award ${a.tone}`}>
              <span className="vd-award-title">{a.title}</span>
              <span className="vd-award-detail">{a.detail}</span>
            </div>
          ))}
        </div>
      )}
      {reel.crew.length > 0 && (
        <div className="crew">
          {reel.crew.map((s, i) => (
            <div key={i} className="crew-card" style={{ '--player': PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
              <div className="crew-info">
                <span className="crew-name">{s.name} <em className="vd-crew-epithet">{s.epithet}</em></span>
                <span className="crew-role">as {s.characters.map(charName).join(' / ')}</span>
              </div>
              <span className="crew-score" aria-label={`score ${s.score}`}>{s.score}</span>
            </div>
          ))}
        </div>
      )}

      <details className="vd-fine">
        <summary>How the gods measured</summary>
        <dl>
          {GODS.map((g) => result.judges[g.key]?.note && (
            <div key={g.key}><dt>{g.name}</dt><dd>{result.judges[g.key].note}</dd></div>
          ))}
          <div>
            <dt>Heard</dt>
            <dd>“{result.transcript || '…silence…'}” ({STT_NAMES[result.stt_source] || result.stt_source || 'unknown'})</dd>
          </div>
        </dl>
        <p className="muted small">
          Each line earns up to three laurels from the same four measurements that make up your kleos.
          Commentary by {verdict.source === 'gemini' ? 'Gemini' : 'the house oracle'}.
        </p>
      </details>
    </div>
  )
}

// This crew's last and best kleos on this scene, kept in the browser so a retry can show progress.
const keyOf = (r) => `trials:voyages:${r.scene_id}:${r.team_name}`

function recall(result) {
  try {
    return JSON.parse(localStorage.getItem(keyOf(result))) || {}
  } catch {
    return {}
  }
}

function record(result) {
  try {
    const prev = recall(result)
    if (prev.stamp === stampOf(result)) return // same take re-rendered (StrictMode, back from the Hall)
    localStorage.setItem(keyOf(result), JSON.stringify({
      last: result.kleos, best: Math.max(result.kleos, prev.best ?? 0), stamp: stampOf(result),
    }))
  } catch { /* storage unavailable: the progress chips just don't show */ }
}

const stamps = new WeakMap()
function stampOf(result) {
  if (!stamps.has(result)) stamps.set(result, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  return stamps.get(result)
}
