import { PLAYER_COLORS } from '../vision.js'
import { chunkWords } from './chunks.js'

// Karaoke teleprompter. Nothing but the words, as big as they fit, one short chunk of a long line at
// a time so the band never changes height. The whole text area takes the
// colour of the player whose line it is (the same colour as their spotlight and plaque), so nobody
// has to read a name to know who is up. In the last two seconds before a line, a disc in the next
// speaker's colour shows their player number, its ring draining as the line comes up.
export default function Prompter({ scene, team, t }) {
  const current = scene.lines.find((l) => t >= l.start - 0.3 && t <= l.end + 0.5)
  const next = scene.lines.find((l) => l.start > t + 0.3 && l !== current)
  const lead = next ? next.start - t : Infinity
  const showRing = next && lead <= 2 && lead > 0
  const shown = current || next
  const colorOf = (line) => PLAYER_COLORS[team.assignments[line.character]]

  return (
    <div className={`sg-prompter ${current ? 'now' : 'soon'}`} style={shown ? { '--pc': colorOf(shown) } : undefined}>
      {showRing && <Countdown lead={lead} color={colorOf(next)} num={team.assignments[next.character] + 1} />}
      {shown
        ? <Line line={shown} t={t} live={Boolean(current)} />
        : <div className="sg-cue">Hold the final moment…</div>}
    </div>
  )
}

function Countdown({ lead, color, num }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className="sg-upnext" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="38" fill={color} className="sg-upnext-disc" />
        <circle cx="50" cy="50" r={r} className="sg-ring-bg" />
        <circle cx="50" cy="50" r={r} className="sg-ring" stroke={color}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, lead / 2))} transform="rotate(-90 50 50)" />
        <text x="50" y="50" dy=".36em" textAnchor="middle">{num}</text>
      </svg>
    </div>
  )
}

// live: the line is being spoken now, so words light up as time passes. Otherwise it is the
// upcoming line, dimmer in its speaker's colour. A long line shows one chunk at a time (chunks.js):
// the chunk being spoken, or the first one while the line is still coming up.
function Line({ line, t, live }) {
  const words = line.text.split(' ')
  const frac = Math.max(0, Math.min(1, (t - line.start) / Math.max(0.1, line.end - line.start)))
  const lit = live ? Math.round(frac * words.length) : 0
  const chunks = chunkWords(words)
  let k = 0 // the chunk being spoken
  let first = 0 // index of its first word
  while (k < chunks.length - 1 && lit >= first + chunks[k].length) first += chunks[k++].length
  const shown = chunks[k]
  return (
    // keyed by chunk so each new chunk fades in
    <div className="sg-words" key={first}>
      {shown.map((w, i) => <span key={i} className={live && first + i < lit ? 'lit' : ''}>{w} </span>)}
    </div>
  )
}
