import { useEffect, useRef, useState } from 'react'
import { speak } from '../api.js'
import { PLAYER_COLORS } from '../vision.js'

const EMOTION_ICONS = {
  rage: '😠', fear: '😨', joy: '😄', sorrow: '😢', cunning: '😏', awe: '😲', resolve: '😤', longing: '🥺',
}

export default function Rehearse({ scene, team, onBack, onGo }) {
  const [reading, setReading] = useState(-1)
  const stopRef = useRef(false)
  useEffect(() => () => { stopRef.current = true; window.speechSynthesis?.cancel() }, [])

  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  const playerOf = (id) => team.assignments[id]

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

  return (
    <div className="panel">
      <button className="link" onClick={onBack}>← Back</button>
      <p className="eyebrow">Rehearsal · {scene.book}</p>
      <h2>{scene.title}</h2>

      {scene.video ? (
        <video className="clip" src={`/${scene.video}`} controls />
      ) : (
        <p className="muted">
          Study the scroll. Each line shows the emotion the gods will look for on your face.
        </p>
      )}

      <div className="script">
        {scene.lines.map((l, i) => {
          const p = playerOf(l.character)
          return (
            <div key={i} className={`script-line ${reading === i ? 'reading' : ''}`}
              style={{ borderLeftColor: PLAYER_COLORS[p] }}>
              <div className="who" style={{ color: PLAYER_COLORS[p] }}>
                {charName(l.character)} <small>({team.players[p].name})</small>
                <span className="emo">{EMOTION_ICONS[l.emotion]} {l.emotion}</span>
              </div>
              <div className="text">{l.text}</div>
              {l.direction && <div className="direction">{l.direction}</div>}
            </div>
          )
        })}
      </div>

      <div className="row">
        {reading < 0 ? (
          <button className="btn ghost" onClick={readThrough}>🔊 Hear the read-through</button>
        ) : (
          <button className="btn ghost" onClick={() => { stopRef.current = true; window.speechSynthesis?.cancel() }}>
            ■ Stop
          </button>
        )}
        <button className="btn big" onClick={onGo}>Take the stage →</button>
      </div>
    </div>
  )
}
