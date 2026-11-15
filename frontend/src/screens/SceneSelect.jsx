import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Helmet, Lyre, Owl, Rose, Ship, Trident } from '../ui/Art.jsx'
import VoyageMap, { isConquered } from './setup/VoyageMap.jsx'
import { NUMERALS } from './setup/constants.js'
import { Difficulty, HelmetIcon, HourglassIcon } from './setup/icons.jsx'
import './setup/setup.css'
import './setup/scene-select.css'
import { SCENE_ART } from './setup/sceneArt.js'

// Resting frame for film cards: a well-lit shot of Penelope, not the dark opening crowd shot.
const POSTER_T = 3.1
// Cards per row at full size; more than this and the row scrolls sideways
const ROW = 5

// The Cyclops's single eye, for the cave scene
function CyclopsEye({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 40" aria-hidden="true">
      <path d="M2 20 Q32 -6 62 20 Q32 46 2 20 Z" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="32" cy="20" r="10" fill="currentColor" />
      <circle cx="32" cy="20" r="4" fill="#f6ecd0" />
      <path d="M14 6 L20 11 M32 1 L32 7 M50 6 L44 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

// Emblem painted on each text scene's papyrus: a fitting symbol per scene, else cycled.
const SCENE_EMBLEMS = {
  'i-am-odysseus': Ship, 'my-name-is-noman': CyclopsEye, 'bound-to-the-mast': Lyre, 'secret-of-the-bed': Rose,
}
const EMBLEMS = [Trident, Owl, Helmet, Ship, Lyre, Rose]


export default function SceneSelect({ onPick, onBack }) {
  const [scenes, setScenes] = useState(null)
  const [error, setError] = useState(null)
  const [hovered, setHovered] = useState(null)
  const [progress, setProgress] = useState({})
  useEffect(() => { api.scenes().then(setScenes).catch((e) => setError(String(e))) }, [])
  // Best run per trial (from the Hall of Heroes); progress is a nice-to-have, so failures are silent
  useEffect(() => { api.progress().then(setProgress).catch(() => {}) }, [])

  // Film scenes first (hard modes last), then the scrolls; numerals follow that order everywhere.
  const hard = (s) => (s.difficulty === 'Hard' ? 1 : 0)
  const films = scenes ? scenes.filter((s) => s.video).sort((a, b) => hard(a) - hard(b)) : []
  const scrolls = scenes ? scenes.filter((s) => !s.video) : []
  const ordered = [...films, ...scrolls]
  // More trials than fit one row at full size: one sideways-scrolling row, cards keep their size
  const many = ordered.length > ROW
  const card = (s) => {
    const i = ordered.indexOf(s)
    return (
      <SceneCard key={s.id} s={s} n={NUMERALS[i]} emblem={SCENE_EMBLEMS[s.id] || EMBLEMS[i % EMBLEMS.length]}
        on={hovered === s.id} start={i === 0 && hovered === null && !progress[s.id]} onHover={setHovered} onPick={onPick}
        best={progress[s.id]} />
    )
  }
  const row = useRef(null)
  // Pointing at an island brings its card into view
  const hoverIsland = (id) => {
    setHovered(id)
    if (id) row.current?.querySelector(`[data-scene="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className={`panel sx ${many ? 'sx-many' : ''}`}>
      <div className="sx-top">
        <button className="link sx-back" onClick={onBack}>← Back</button>
        <header className="sx-head">
          <p className="sx-eyebrow">The wine-dark sea awaits</p>
          <h2 className="sx-title">Choose your trial</h2>
        </header>
        <span className="sx-top-spacer" aria-hidden="true" />
      </div>

      {error && <p className="bad center">{error}</p>}
      {!scenes && !error && <p className="muted center">Unrolling the sea charts…</p>}

      {ordered.length > 0 && (
        <>
          <VoyageMap scenes={ordered} hovered={hovered} onHover={hoverIsland} onPick={onPick} progress={progress} />
          <VoyageTally scenes={ordered} progress={progress} />
          {many ? (
            <CardRow innerRef={row}>{ordered.map(card)}</CardRow>
          ) : (
            <div className="sx-grid">{ordered.map(card)}</div>
          )}
        </>
      )}
    </div>
  )
}

// One row of full-size cards that scrolls sideways: arrows at the ends, the mouse wheel scrolls it,
// and the edge that has more trials behind it fades out.
function CardRow({ innerRef, children }) {
  const [ends, setEnds] = useState({ left: false, right: true })
  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const update = () => setEnds({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    const wheel = (e) => {
      // A vertical wheel scrolls the row, unless it is already at that end
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      el.removeEventListener('wheel', wheel)
      window.removeEventListener('resize', update)
    }
  }, [innerRef])
  const page = (dir) => {
    const el = innerRef.current
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  return (
    <div className={`sx-rowwrap ${ends.left ? 'more-left' : ''} ${ends.right ? 'more-right' : ''}`}>
      <div className="sx-row" ref={innerRef}>{children}</div>
      <button className="sx-arrow left" onClick={() => page(-1)} aria-label="Earlier trials" tabIndex={-1}>‹</button>
      <button className="sx-arrow right" onClick={() => page(1)} aria-label="More trials" tabIndex={-1}>›</button>
    </div>
  )
}

function VoyageTally({ scenes, progress }) {
  const conquered = scenes.filter((s) => isConquered(progress[s.id])).length
  const tried = scenes.filter((s) => progress[s.id] && !isConquered(progress[s.id])).length
  const pct = Math.round((100 * conquered) / scenes.length)
  return (
    <div className="sx-tally" aria-label={`${conquered} of ${scenes.length} trials conquered`}>
      <span className="sx-tally-count"><strong>{conquered}</strong> of {scenes.length} trials conquered</span>
      <span className="sx-tally-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="sx-tally-note">
        {conquered === scenes.length ? 'You have reached Ithaca.' : tried ? `${tried} attempted · reach Oarsman of Ithaca to conquer` : 'Reach Oarsman of Ithaca to conquer a trial'}
      </span>
    </div>
  )
}

function SceneCard({ s, n, emblem: Emblem, on, start, onHover, onPick, best }) {
  const ref = useRef(null)
  const film = Boolean(s.video)
  const enter = () => {
    onHover(s.id)
    const v = ref.current
    if (v) { v.currentTime = 0; v.play().catch(() => {}) }
  }
  const leave = () => {
    onHover(null)
    const v = ref.current
    if (v) { v.pause(); v.currentTime = POSTER_T }
  }
  const players = s.characters.length === 1 ? '1' : `1–${s.characters.length}`

  return (
    <button data-scene={s.id} className={`sx-card ${film ? 'film' : 'scroll'} ${on ? 'on' : ''} ${start ? 'start' : ''}`} onClick={() => onPick(s.id)}
      onMouseEnter={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
      title={s.characters.map((c) => c.name).join(' · ')}>
      <div className="sx-art">
        {film ? (
          <>
            <video ref={ref} src={`/${s.video}#t=${POSTER_T}`} preload="metadata" muted playsInline loop />
            <span className="sx-ribbon">From the film</span>
            <span className="sx-play" aria-hidden="true">▶</span>
          </>
        ) : SCENE_ART[s.id] ? (
          <img className="sx-illo" src={SCENE_ART[s.id]} alt="" width="1200" height="896"
            loading="lazy" decoding="async" />
        ) : (
          <Emblem className="sx-emblem" />
        )}
        <span className="sx-num" aria-hidden="true">{n}</span>
        {best && (
          <span className={`sx-best ${isConquered(best) ? 'done' : ''}`} title={`Best: ${best.team_name}`}>
            {isConquered(best) ? `★ ${best.rank} · ${best.kleos}` : `Attempted · best ${best.kleos}`}
          </span>
        )}
      </div>
      <div className="sx-body">
        <span className="sx-book">{s.book.split('·')[0].trim()}</span>
        <h3 className="sx-name">{s.title}</h3>
        <p className="sx-blurb">{s.blurb}</p>
        <div className="sx-meta">
          <span title="Players"><HelmetIcon className="ss-ico" />{players}</span>
          <span title="Length"><HourglassIcon className="ss-ico" />{Math.round(s.duration)}s</span>
          <Difficulty level={s.difficulty || 'Medium'} />
        </div>
      </div>
    </button>
  )
}
