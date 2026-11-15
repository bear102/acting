import { useEffect, useRef, useState } from 'react'
import { PLAYER_COLORS } from '../playerColors.js'
import { GOD_ART } from '../ui/Art.jsx'
import { LeafIcon } from '../screens/setup/icons.jsx'

const LANES = [
  { key: 'words', god: 'athena', label: 'Words' },
  { key: 'voice', god: 'apollo', label: 'Voice' },
  { key: 'body', god: 'ares', label: 'Body' },
  { key: 'face', god: 'aphrodite', label: 'Face' },
]
const STEP_MS = 620

/** The take, line by line. Plays through once, then rests on the best line; tap any line to inspect it. */
export default function Reel({ reel, scene, snaps, start, charName }) {
  const beats = reel.beats
  const [shown, setShown] = useState(0) // beats revealed so far
  const [sel, setSel] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    if (!start || shown >= beats.length) return
    timer.current = setTimeout(() => {
      setSel(beats[shown].line)
      setShown((n) => n + 1)
    }, shown === 0 ? 150 : STEP_MS)
    return () => clearTimeout(timer.current)
  }, [start, shown, beats])

  // Replay over: rest on the line of the night
  useEffect(() => {
    if (shown !== beats.length || reel.best == null) return
    const t = setTimeout(() => setSel(reel.best), STEP_MS + 250)
    return () => clearTimeout(t)
  }, [shown, beats.length, reel.best])

  const pick = (line) => {
    clearTimeout(timer.current)
    setShown(beats.length + 1) // past the end: the auto-rest above no longer fires
    setSel(line)
  }

  const beat = beats.find((b) => b.line === sel)

  return (
    <section className="rl">
      <header className="rl-head">
        <h3 className="section-title">The reel</h3>
        <span className="rl-tally">
          <LeafIcon className="rl-leaf on" /> {reel.laurels} of {reel.laurels_max} laurels
        </span>
      </header>

      <div className="rl-strip" role="tablist" aria-label="Lines of the scene">
        {beats.map((b, i) => (
          <button key={b.line} role="tab" aria-selected={sel === b.line}
            className={`rl-tile ${i < shown ? 'in' : ''} ${sel === b.line ? 'on' : ''}`}
            style={{ '--player': PLAYER_COLORS[b.player % PLAYER_COLORS.length] }}
            onClick={() => pick(b.line)}>
            <span className="rl-who">{charName(b.character)}</span>
            <span className="rl-leaves" aria-label={`${b.laurels} of 3 laurels`}>
              {[0, 1, 2].map((k) => <LeafIcon key={k} className={`rl-leaf ${k < b.laurels ? 'on' : ''}`} filled={k < b.laurels} />)}
            </span>
            <span className="rl-bars" aria-hidden="true">
              {LANES.map((l) => <i key={l.key} style={{ height: `${Math.max(6, b.scores[l.key])}%` }} />)}
            </span>
            {b.line === reel.best && <span className="rl-flag">best</span>}
          </button>
        ))}
      </div>

      {beat ? <Beat key={beat.line} beat={beat} reel={reel} scene={scene} snaps={snaps} charName={charName} />
        : <p className="rl-hint muted">Replaying your take…</p>}
    </section>
  )
}

function Beat({ beat, reel, scene, snaps, charName }) {
  const snap = nearestSnap(snaps, beat)
  const unheard = beat.offset == null && beat.scores.words === 0
  return (
    <div className="rl-beat" style={{ '--player': PLAYER_COLORS[beat.player % PLAYER_COLORS.length] }}>
      <div className="rl-main">
        <div className="rl-meta">
          <strong>{charName(beat.character)}</strong>
          {beat.player_name && <span className="muted"> · {beat.player_name}</span>}
          <span className={`rl-cue ${cueClass(beat.offset)}`}>{cueLabel(beat.offset)}</span>
          {beat.line === reel.best && <span className="rl-cue good">line of the night</span>}
          {beat.line === reel.worst && <span className="rl-cue bad">the gods winced</span>}
        </div>

        <p className="rl-line">
          {beat.words.map((w, i) => (
            <span key={i} className={unheard || w.hit === 0 ? 'miss' : w.hit < 0.8 ? 'near' : 'hit'}>{w.w} </span>
          ))}
        </p>
        {beat.heard && !unheard && beat.scores.words < 95 && (
          <p className="rl-heard">The gods heard “{beat.heard}”</p>
        )}

        <div className="rl-meters">
          {LANES.map((l) => {
            const Art = GOD_ART[l.god]
            return (
              <div key={l.key} className="rl-meter">
                <Art className="rl-meter-art" />
                <span className="rl-meter-name">{l.label}</span>
                <span className="rl-meter-bar"><i style={{ width: `${beat.scores[l.key]}%` }} /></span>
                <span className="rl-meter-num">{beat.scores[l.key]}</span>
              </div>
            )
          })}
        </div>
      </div>

      {snap && (
        <div className="rl-pair">
          {scene.video && (
            <figure>
              <img src={`/api/scenes/${scene.id}/frame?t=${snap.t.toFixed(1)}`} alt="The film at this line"
                onError={(e) => { e.currentTarget.parentElement.hidden = true }} />
              <figcaption>The film</figcaption>
            </figure>
          )}
          <figure>
            <img src={snap.url} alt="Your crew at this line" />
            <figcaption>You</figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}

function nearestSnap(snaps, beat) {
  const mid = (beat.start + beat.end) / 2
  const inLine = (snaps || []).filter((s) => s.t >= beat.start - 0.3 && s.t <= beat.end + 0.5)
  return inLine.sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid))[0] || null
}

function cueLabel(o) {
  if (o == null) return 'never heard'
  if (Math.abs(o) <= 0.3) return 'on cue'
  return `${Math.abs(o).toFixed(1)}s ${o > 0 ? 'late' : 'early'}`
}

function cueClass(o) {
  if (o == null) return 'bad'
  return Math.abs(o) <= 0.3 ? 'good' : Math.abs(o) > 1.2 ? 'bad' : ''
}
