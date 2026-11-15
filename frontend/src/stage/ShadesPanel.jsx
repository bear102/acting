import { useEffect, useRef } from 'react'
import { PLAYER_COLORS } from '../vision.js'
import { activeCharacter, refFrameAt } from './pose.js'
import { drawVaseFigure } from './shade.js'
import { EMOTION_ICONS } from './Prompter.jsx'

const CARD = 132 // css px

// "The Shades": one vase-painting roundel per character, animating that character's
// reference pose on the stage clock. Drawn imperatively at <=30fps (no React re-renders).
export default function ShadesPanel({ scene, team, getTime }) {
  const canvases = useRef({})
  const cards = useRef({})
  const hints = useRef({})
  const pose = scene.reference?.pose
  const fps = scene.reference?.fps || 10

  useEffect(() => {
    let raf = 0
    let last = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 33) return
      last = now
      const t = getTime() ?? 0
      const active = activeCharacter(scene, t)
      for (const c of scene.characters) {
        const card = cards.current[c.id]
        if (card) card.classList.toggle('active', active === c.id)
        const hint = hints.current[c.id]
        if (hint) {
          const line = scene.lines.find((l) => l.character === c.id && l.end + 0.5 >= t)
          const txt = line ? (line.direction || line.text) : 'Their part is done.'
          if (hint.textContent !== txt) hint.textContent = txt
        }
        const cv = canvases.current[c.id]
        if (!cv) continue
        if (cv.width !== CARD * dpr) { cv.width = CARD * dpr; cv.height = CARD * dpr }
        const ctx = cv.getContext('2d')
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, CARD, CARD)
        const r = pose && refFrameAt(pose[c.id], t, fps)
        const drew = r && drawVaseFigure(ctx, r.frame, CARD, CARD, { active: active === c.id, resting: r.resting })
        if (card) card.classList.toggle('resting', !drew || r.resting)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [scene, getTime, pose, fps])

  return (
    <section className="sg-shades">
      <h3 className="sg-panel-title"><span>✦</span> The Shades <span>✦</span></h3>
      <p className="sg-panel-sub">{pose ? 'Mirror the spirit of your character' : 'Your roles in this trial'}</p>
      <div className="sg-cards">
        {scene.characters.map((c) => {
          const pi = team.assignments[c.id]
          const firstLine = scene.lines.find((l) => l.character === c.id)
          return (
            <div key={c.id} className="sg-card" ref={(el) => { cards.current[c.id] = el }}
              style={{ '--pc': PLAYER_COLORS[pi] }}>
              <div className="sg-roundel">
                {pose?.[c.id] ? (
                  <canvas ref={(el) => { canvases.current[c.id] = el }} style={{ width: CARD, height: CARD }} />
                ) : (
                  <div className="sg-amphora">{EMOTION_ICONS[firstLine?.emotion] || '🏺'}</div>
                )}
              </div>
              <div className="sg-card-text">
                <div className="sg-card-name">{c.name}</div>
                <div className="sg-card-player">{team.players[pi].name}</div>
                <div className="sg-card-hint" ref={(el) => { hints.current[c.id] = el }}>
                  {firstLine?.direction || c.description}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
