import { useEffect, useRef, useState } from 'react'
import { speak } from '../api.js'
import { PLAYER_COLORS } from '../vision.js'
import { Bolt, GOD_ART, Laurel, Meander } from '../ui/Art.jsx'

const GODS = [
  { key: 'athena', name: 'Athena', domain: 'Words' },
  { key: 'apollo', name: 'Apollo', domain: 'Voice' },
  { key: 'ares', name: 'Ares', domain: 'Movement' },
  { key: 'aphrodite', name: 'Aphrodite', domain: 'Emotion' },
]

const STT_NAMES = { elevenlabs: 'ElevenLabs Scribe', whisper: 'Whisper', browser: 'browser speech recognition' }

export default function Verdict({ result, scene, team, onRetry, onNew, onHall }) {
  const [kleos, setKleos] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const audioRef = useRef(null)
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name || id

  // Count-up, then reveal the gods one by one, then Zeus speaks
  useEffect(() => {
    let raf
    const t0 = performance.now()
    const step = (now) => {
      const f = Math.min(1, (now - t0) / 1800)
      setKleos(Math.round(result.kleos * (1 - (1 - f) ** 3)))
      if (f < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    const timers = GODS.map((_, i) => setTimeout(() => setRevealed(i + 1), 700 + i * 650))
    timers.push(setTimeout(zeusSpeaks, 700 + GODS.length * 650 + 300))
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
      audioRef.current?.pause()
      window.speechSynthesis?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  function zeusSpeaks() {
    audioRef.current?.pause()
    window.speechSynthesis?.cancel()
    if (result.zeus_audio) {
      audioRef.current = new Audio(`data:audio/mpeg;base64,${result.zeus_audio}`)
      audioRef.current.play().catch(() => {})
    } else {
      speak(result.verdict.zeus, { pitch: 0.6, rate: 0.92 })
    }
  }

  return (
    <div className="panel verdict">
      <p className="eyebrow center">{result.scene_title} · {result.team_name}</p>
      <div className="kleos-block">
        <div className="wreath">
          <Laurel className="laurel" />
          <div className="wreath-inner">
            <div className="kleos-num">{kleos}</div>
            <div className="kleos-label">kleos</div>
          </div>
        </div>
        <div className="rank">{result.rank}</div>
        {result.verdict.epithet && <div className="epithet">“{result.team_name}, {result.verdict.epithet}”</div>}
      </div>

      <Meander />

      <div className="gods">
        {GODS.map((g, i) => {
          const j = result.judges[g.key] || { score: 0 }
          const Art = GOD_ART[g.key]
          const notes = extraNotes(j, charName)
          return (
            <div key={g.key} className={`god shard-${i} ${i < revealed ? 'in' : ''}`}>
              <div className="god-head">
                <Art className="god-art" />
                <div>
                  <div className="god-name">{g.name}</div>
                  <div className="god-domain">{g.domain}</div>
                </div>
                <div className="god-score">{j.score}</div>
              </div>
              <div className="bar"><div style={{ width: i < revealed ? `${j.score}%` : 0 }} /></div>
              {result.verdict[g.key] && <p className="quote">“{result.verdict[g.key]}”</p>}
              {j.note && <p className="god-note">{j.note}</p>}
              {notes.length > 0 && (
                <ul className="god-moments">
                  {notes.map((n, k) => <li key={k}>{n}</li>)}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <div className={`zeus ${revealed >= GODS.length ? 'in' : ''}`}>
        <div className="zeus-head"><Bolt className="zeus-icon" /> Zeus speaks</div>
        <p>{result.verdict.zeus}</p>
        <button className="link" onClick={zeusSpeaks}>🔊 Hear again</button>
      </div>

      {result.stars?.length > 0 && (
        <>
          <h3 className="section-title">Stars of the crew</h3>
          <div className="stars">
            {result.stars.map((s, i) => (
              <div key={i} className="star" style={{ borderColor: PLAYER_COLORS[i] }}>
                <strong style={{ color: PLAYER_COLORS[i] }}>{s.name}</strong>
                <span className="muted small">{s.characters.map(charName).join(' / ')}</span>
                <span className="star-score">{s.score}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <details className="lines-detail">
        <summary>Line by line (what the gods heard)</summary>
        <table>
          <tbody>
            {result.judges.athena.lines.map((l, i) => (
              <tr key={i}>
                <td style={{ color: PLAYER_COLORS[team.assignments[l.character]] }}>{charName(l.character)}</td>
                <td>{l.text}</td>
                <td className={`num ${l.accuracy >= 70 ? 'good' : l.accuracy >= 40 ? '' : 'bad'}`}>{l.accuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Heard ({STT_NAMES[result.stt_source] || result.stt_source || 'unknown'}):
          “{result.transcript || '…silence…'}”
        </p>
        <p className="muted small">Commentary by {result.verdict.source === 'gemini' ? 'Gemini' : 'the house oracle'}.</p>
      </details>

      <div className="row center-row">
        <button className="btn" onClick={onRetry}>↻ Try again</button>
        <button className="btn ghost" onClick={onNew}>New trial</button>
        <button className="btn ghost" onClick={onHall}>Hall of Heroes</button>
      </div>
    </div>
  )
}

// Optional richer detail from judges (moments / per-line notes); tolerate any shape.
function extraNotes(j, charName) {
  const out = []
  const list = j.moments || j.line_notes || j.lines_notes
  if (Array.isArray(list)) {
    for (const m of list.slice(0, 3)) {
      if (typeof m === 'string') out.push(m)
      else if (m && typeof m === 'object') {
        const who = m.character ? `${charName(m.character)}: ` : ''
        const when = typeof m.t === 'number' ? `${m.t.toFixed(1)}s · ` : typeof m.time === 'number' ? `${m.time.toFixed(1)}s · ` : ''
        const text = m.note || m.text || m.label || (typeof m.score === 'number' ? `${m.score}` : '')
        if (text) out.push(`${when}${who}${text}`)
      }
    }
  }
  return out
}
