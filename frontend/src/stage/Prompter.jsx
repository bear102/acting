import { PLAYER_COLORS } from '../vision.js'

// Karaoke teleprompter. Nothing but the words, as big as they fit: the whole text area takes the
// colour of the player whose line it is (the same colour as their spotlight and plaque), so nobody
// has to read a name to know who is up. A small ring counts down the last two seconds to a line.
export default function Prompter({ scene, team, t }) {
  const current = scene.lines.find((l) => t >= l.start - 0.3 && t <= l.end + 0.5)
  const next = scene.lines.find((l) => l.start > t + 0.3 && l !== current)
  const lead = next ? next.start - t : Infinity
  const showRing = next && lead <= 2 && lead > 0
  const shown = current || next
  const colorOf = (line) => PLAYER_COLORS[team.assignments[line.character]]

  return (
    <div className={`sg-prompter ${current ? 'now' : 'soon'}`} style={shown ? { '--pc': colorOf(shown) } : undefined}>
      {showRing && <Countdown lead={lead} color={colorOf(next)} />}
      {shown
        ? <Line line={shown} t={t} live={Boolean(current)} />
        : <div className="sg-cue">Hold the final moment…</div>}
    </div>
  )
}

function Countdown({ lead, color }) {
  const r = 16
  const c = 2 * Math.PI * r
  return (
    <div className="sg-upnext" style={{ color }} aria-hidden="true">
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} className="sg-ring-bg" />
        <circle cx="20" cy="20" r={r} className="sg-ring" stroke={color}
          strokeDasharray={c} strokeDashoffset={c * (lead / 2)} transform="rotate(-90 20 20)" />
        <text x="20" y="25" textAnchor="middle">{Math.ceil(lead)}</text>
      </svg>
    </div>
  )
}

// live: the line is being spoken now, so words light up as time passes. Otherwise it is the
// upcoming line, shown whole and dimmer in its speaker's colour.
function Line({ line, t, live }) {
  const words = line.text.split(' ')
  const frac = Math.max(0, Math.min(1, (t - line.start) / Math.max(0.1, line.end - line.start)))
  const lit = Math.round(frac * words.length)
  return (
    <div className="sg-words">
      {words.map((w, i) => <span key={i} className={live && i < lit ? 'lit' : ''}>{w} </span>)}
    </div>
  )
}
