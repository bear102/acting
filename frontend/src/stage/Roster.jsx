import { PLAYER_COLORS } from '../vision.js'
import { activeCharacter } from './pose.js'
import { EMOTION_ICONS } from './emotions.js'

// Cast list: who plays whom, the mood of their current/next line, and who is "on" right now.
// The words themselves are only in the subtitle band under the stage.
export default function Roster({ scene, team, t, compact = false }) {
  const active = t == null ? null : activeCharacter(scene, t)
  return (
    <section className={`sg-roster ${compact ? 'compact' : ''}`}>
      {!compact && <h3 className="sg-panel-title"><span>✦</span> The Players <span>✦</span></h3>}
      <div className="sg-roster-list">
        {scene.characters.map((c) => {
          const pi = team.assignments[c.id]
          const line = scene.lines.find((l) => l.character === c.id && l.end + 0.5 >= (t ?? 0))
          return (
            <div key={c.id} className={`sg-role ${active === c.id ? 'active' : ''}`} style={{ '--pc': PLAYER_COLORS[pi] }}>
              <span className="sg-role-emo">{EMOTION_ICONS[line?.emotion] || '🏺'}</span>
              <div className="sg-role-text">
                <div className="sg-role-name">{c.name}</div>
                <div className="sg-role-player">{team.players[pi].name}</div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
