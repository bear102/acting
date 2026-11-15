import { PLAYER_COLORS } from '../vision.js'

export const EMOTION_ICONS = {
  rage: '😠', fear: '😨', joy: '😄', sorrow: '😢', cunning: '😏', awe: '😲', resolve: '😤', longing: '🥺',
}

// Karaoke teleprompter + "you're up" countdown ring for the next line.
export default function Prompter({ scene, team, t }) {
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  const current = scene.lines.find((l) => t >= l.start - 0.3 && t <= l.end + 0.5)
  const next = scene.lines.find((l) => l.start > t + 0.3 && l !== current)
  const lead = next ? next.start - t : Infinity
  const showRing = next && lead <= 2 && lead > 0

  return (
    <div className="sg-prompter">
      {showRing && <UpNext line={next} lead={lead} team={team} name={charName(next.character)} />}
      {current ? (
        <Line line={current} t={t} team={team} name={charName(current.character)} big />
      ) : next ? (
        <div className="sg-cue">
          <span className="sg-cue-label">Next</span>
          <Line line={next} t={t} team={team} name={charName(next.character)} />
        </div>
      ) : (
        <div className="sg-cue">Hold the final moment…</div>
      )}
    </div>
  )
}

function UpNext({ line, lead, team, name }) {
  const p = team.assignments[line.character]
  const frac = 1 - lead / 2
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <div className="sg-upnext" style={{ color: PLAYER_COLORS[p] }}>
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="sg-ring-bg" />
        <circle cx="20" cy="20" r={r} className="sg-ring" stroke={PLAYER_COLORS[p]}
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} transform="rotate(-90 20 20)" />
        <text x="20" y="25" textAnchor="middle">{Math.ceil(lead)}</text>
      </svg>
      <span>{team.players[p].name}, ready as {name}</span>
    </div>
  )
}

function Line({ line, t, team, name, big }) {
  const p = team.assignments[line.character]
  const words = line.text.split(' ')
  const frac = Math.max(0, Math.min(1, (t - line.start) / Math.max(0.1, line.end - line.start)))
  const lit = Math.round(frac * words.length)
  return (
    <div className={big ? 'sg-line big' : 'sg-line'}>
      <div className="sg-speaker" style={{ color: PLAYER_COLORS[p] }}>
        {EMOTION_ICONS[line.emotion] && <span className="sg-emo" title={line.emotion}>{EMOTION_ICONS[line.emotion]}</span>}
        {name} <span className="sg-player">· {team.players[p].name}</span>
        {line.direction && <span className="sg-dir">{line.direction}</span>}
      </div>
      <div className="sg-words">
        {words.map((w, i) => <span key={i} className={big && i < lit ? 'lit' : ''}>{w} </span>)}
      </div>
    </div>
  )
}
