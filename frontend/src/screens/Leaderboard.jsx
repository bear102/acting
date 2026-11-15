import { loop, play, stopLoop } from '../audio/sfx.js'
import PageBackdrop from '../ui/PageBackdrop.jsx'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Laurel } from '../ui/Art.jsx'
import { Pediment } from '../theme/Temple.jsx'
import '../theme/hall.css'
import { rankArt } from '../ui/rankArt.js'

export default function Leaderboard({ onBack, highlight, onRetry }) {
  const [rows, setRows] = useState(null)
  const [scenes, setScenes] = useState([])
  const [sceneId, setSceneId] = useState(highlight?.scene_id || '')
  const meRef = useRef(null)

  useEffect(() => { api.scenes().then(setScenes).catch(() => {}) }, [])
  useEffect(() => {
    let live = true
    api.leaderboard(sceneId).then((r) => live && setRows(r)).catch(() => live && setRows([]))
    return () => { live = false }
  }, [sceneId])
  useEffect(() => { meRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [rows])

  const choose = (id) => {
    if (id === sceneId) return
    setRows(null)
    setSceneId(id)
  }
  const tabs = [{ id: '', title: 'All trials' }, ...scenes.map((s) => ({ id: s.id, title: s.title }))]
  const isMine = (r) => highlight && r.team_name === highlight.team_name && r.kleos === highlight.kleos
    && r.scene_id === highlight.scene_id
  const mine = rows ? rows.findIndex(isMine) : -1
  // Outside the top 20 the API returns: pin your own row under the table. The place is per trial, so never on "All trials".
  const pinned = !!(rows && highlight?.hall && sceneId === highlight.scene_id && mine < 0)
  const next = highlight?.reel?.voyage?.next
  // Wind over the stele; applause once if this crew's run made the top three
  useEffect(() => { loop('ambience', 'amb-wind'); return () => stopLoop('ambience') }, [])
  const cheered = useRef(false)
  useEffect(() => {
    if (!cheered.current && mine >= 0 && mine < 3) { cheered.current = true; play('applause') }
  }, [mine])

  return (
    <div className="panel ol">
      <PageBackdrop variant="stars" />
      <div className="ol-bar">
        <button className="link" onClick={onBack}>{highlight ? '← Back to your verdict' : '← Back'}</button>
        {onRetry && <button className="btn" onClick={onRetry}>↻ {next ? `Chase ${next.name}` : 'Sail it again'}</button>}
      </div>
      <div className="ol-stele">
        <Pediment className="ol-pediment" />
        <div className="ol-slab">
          <p className="ol-eyebrow">Carved in stone forever</p>
          <h2 className="ol-title">
            <Laurel className="ol-laurel" />
            <span>Hall of Heroes</span>
            <Laurel className="ol-laurel flip" />
          </h2>

          <div className="ol-tabs" role="tablist" aria-label="Filter by trial">
            {tabs.map((t) => (
              <button key={t.id || 'all'} role="tab" aria-selected={t.id === sceneId}
                className={`ol-tab ${t.id === sceneId ? 'on' : ''}`} onClick={() => choose(t.id)}>
                {t.title}
              </button>
            ))}
          </div>

          {!rows && <p className="ol-empty">Reading the stone tablets…</p>}
          {rows?.length === 0 && !pinned && (
            <div className="ol-empty ol-empty-art">
              <img src="/art/generated/empty-laurel.webp" alt="" width="384" height="384" decoding="async" />
              <p>No heroes carved here yet. Be the first.</p>
            </div>
          )}
          {(rows?.length > 0 || pinned) && (
            <table className="hall ol-table">
              <thead><tr><th>#</th><th>Crew</th><th>Trial</th><th>Rank</th><th className="num">Kleos</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} ref={i === mine ? meRef : null} className={`${i === mine ? 'me' : ''} ${i < 3 ? `ol-top ol-top-${i + 1}` : ''}`}>
                    <td>
                      <span className="ol-place">
                        {i < 3 && <Laurel className="ol-place-laurel" />}
                        <span className={`place place-${i + 1}`}>{i + 1}</span>
                      </span>
                    </td>
                    <td><strong className="ol-crew">{r.team_name}</strong>{r.epithet && <div className="ol-epithet">{r.epithet}</div>}</td>
                    <td>{r.scene_title}<div className="ol-sub">{r.team_size} player{r.team_size > 1 ? 's' : ''}</div></td>
                    <td className="ol-rank"><RankCell rank={r.rank} /></td>
                    <td className="num kleos">{r.kleos}</td>
                  </tr>
                ))}
                {pinned && (
                  <tr ref={meRef} className="me ol-pinned">
                    <td><span className="ol-place"><span className="place">{highlight.hall.place}</span></span></td>
                    <td>
                      <strong className="ol-crew">{highlight.team_name}</strong>
                      {highlight.verdict?.epithet && <div className="ol-epithet">{highlight.verdict.epithet}</div>}
                    </td>
                    <td>{highlight.scene_title}<div className="ol-sub">{highlight.team_size} player{highlight.team_size > 1 ? 's' : ''}</div></td>
                    <td className="ol-rank"><RankCell rank={highlight.rank} /></td>
                    <td className="num kleos">{highlight.kleos}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="ol-base" />
      </div>
    </div>
  )
}

// Rank name with its small painted badge (lazy: rows below the fold don't fetch them).
function RankCell({ rank }) {
  const src = rankArt(rank)
  return (
    <span className="ol-rank-cell">
      {src && <img className="ol-rank-badge" src={src} alt="" width="384" height="384" loading="lazy" decoding="async" />}
      {rank}
    </span>
  )
}
