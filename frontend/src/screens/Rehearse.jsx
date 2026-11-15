import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { speak } from '../api.js'
import { PLAYER_COLORS } from '../playerColors.js'
import { GOD_ART } from '../ui/Art.jsx'
import { Flame, MaskArt } from './setup/icons.jsx'
import { EMOTION_ICONS } from './setup/constants.js'
import './setup/setup.css'

// What the four gods score, as four icons: the idea of the game in place of a paragraph.
const JUDGED = [['athena', 'Words'], ['apollo', 'Voice'], ['ares', 'Body'], ['aphrodite', 'Face']]

function Judged() {
  return (
    <ul className="ss-judged" aria-label="The gods judge your words, voice, body and face">
      {JUDGED.map(([god, what]) => {
        const Art = GOD_ART[god]
        return <li key={god}><Art className="ss-judged-art" />{what}</li>
      })}
    </ul>
  )
}

export default function Rehearse({ scene, team, onGo }) {
  const [reading, setReading] = useState(-1)
  const [clipTime, setClipTime] = useState(-1)
  const stopRef = useRef(false)
  const lineRefs = useRef([])
  const clipRef = useRef(null)
  useEffect(() => () => { stopRef.current = true; window.speechSynthesis?.cancel() }, [])

  // The film starts by itself on arrival. The "Set sail" click counts as the gesture browsers
  // require for sound; if one refuses anyway, play it muted rather than not at all.
  useEffect(() => {
    const v = clipRef.current
    if (!v) return
    v.play().catch(() => {
      v.muted = true
      v.play().catch(() => { /* autoplay fully blocked: the controls still work */ })
    })
  }, [])

  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  const playerOf = (id) => team.assignments[id]

  // While the film plays, the line being spoken lights up
  const playing = clipTime >= 0
    ? scene.lines.findIndex((l) => clipTime >= l.start - 0.2 && clipTime <= l.end + 0.3)
    : -1
  const active = playing >= 0 ? playing : reading

  useEffect(() => {
    if (active >= 0) lineRefs.current[active]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active])

  const readThrough = async () => {
    stopRef.current = false
    const voices = {}
    scene.characters.forEach((c, i) => { voices[c.id] = { pitch: [0.7, 1.3, 1.0, 0.85][i % 4], rate: 0.95 } })
    for (let i = 0; i < scene.lines.length; i++) {
      if (stopRef.current) break
      setReading(i)
      await speak(scene.lines[i].text, voices[scene.lines[i].character])
    }
    setReading(-1)
  }
  const stopReading = () => { stopRef.current = true; window.speechSynthesis?.cancel() }

  return (
    <div className="panel ss-screen ss-rehearse">
      {/* Painted megaron hall behind the whole screen. Portalled to <body> so the panel's entrance
          transform can't turn this position:fixed layer into an absolutely positioned one. */}
      {createPortal(<div className="ss-hearth-bg" aria-hidden="true" />, document.body)}
      <header className="ss-head ss-hearth-head">
        <Flame className="ss-flame" />
        <div>
          <p className="eyebrow">Rehearsal at the hearth · {scene.book}</p>
          <h2>{scene.title}</h2>
        </div>
        <Flame className="ss-flame" />
      </header>

      <div className="ss-cast-strip" aria-label="Who plays whom">
        {scene.characters.map((c, ci) => {
          const p = playerOf(c.id)
          return (
            <span key={c.id} className="ss-cast-pill" style={{ '--pc': PLAYER_COLORS[p] }}>
              <MaskArt tragic={ci % 2 === 1} className="ss-pill-mask" />
              <strong>{team.players[p].name}</strong>
              <span className="muted">as</span> {c.name}
            </span>
          )
        })}
      </div>

      <div className={scene.video ? 'ss-rehearse-grid' : 'ss-rehearse-single'}>
        {scene.video && (
          <figure className="ss-frame">
            <figcaption>Watch the Shades of the past</figcaption>
            <div className="ss-frame-inner">
              <video ref={clipRef} src={`/${scene.video}`} controls playsInline
                onTimeUpdate={(e) => setClipTime(e.currentTarget.currentTime)}
                onEnded={() => setClipTime(-1)} />
              {/* whose line this is, in their colour: "that actor is you" without saying so */}
              {playing >= 0 && (
                <span className="ss-speaking" key={playing} style={{ '--pc': PLAYER_COLORS[playerOf(scene.lines[playing].character)] }}>
                  {team.players[playerOf(scene.lines[playing].character)].name}
                </span>
              )}
            </div>
            <Judged />
          </figure>
        )}

        <div className="ss-papyrus" role="list" aria-label="Script">
          {!scene.video && <Judged />}
          {scene.lines.map((l, i) => {
            const p = playerOf(l.character)
            return (
              <div key={i} role="listitem" ref={(el) => { lineRefs.current[i] = el }}
                className={`ss-line ${active === i ? 'on' : ''}`} style={{ '--pc': PLAYER_COLORS[p] }}>
                <div className="ss-line-who">
                  <span className="ss-line-char">{charName(l.character)}</span>
                  <span className="ss-line-player">{team.players[p].name}</span>
                  {l.emotion && (
                    <span className="ss-line-emo" title={`Emotion: ${l.emotion}`}>
                      {EMOTION_ICONS[l.emotion]} {l.emotion}
                    </span>
                  )}
                </div>
                <div className="ss-line-text">{l.text}</div>
                {l.direction && <div className="ss-line-dir">{l.direction}</div>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="ss-cta-row">
        {reading < 0 ? (
          <button className="btn ghost" onClick={readThrough}>🔊 Hear the read-through</button>
        ) : (
          <button className="btn ghost" onClick={stopReading}>■ Stop</button>
        )}
        <button className="btn big ss-cta" onClick={onGo}>Take the stage →</button>
      </div>
    </div>
  )
}
