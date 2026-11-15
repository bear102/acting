import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Laurel } from '../ui/Art.jsx'
import { Pediment } from '../theme/Temple.jsx'
import '../theme/hall.css'

export default function Leaderboard({ onBack, highlight }) {
  const [rows, setRows] = useState(null)
  const [scenes, setScenes] = useState([])
  const [sceneId, setSceneId] = useState('')

  useEffect(() => { api.scenes().then(setScenes).catch(() => {}) }, [])
  useEffect(() => {
    let live = true
    api.leaderboard(sceneId).then((r) => live && setRows(r)).catch(() => live && setRows([]))
    return () => { live = false }
  }, [sceneId])

  const choose = (id) => {
    if (id === sceneId) return
    setRows(null)
    setSceneId(id)
  }
  const tabs = [{ id: '', title: 'All trials' }, ...scenes.map((s) => ({ id: s.id, title: s.title }))]
  const isMine = (r) => highlight && r.team_name === highlight.team_name && r.kleos === highlight.kleos
    && r.scene_id === highlight.scene_id

  return (
    <div className="panel ol">
      <button className="link" onClick={onBack}>← Back</button>
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
          {rows?.length === 0 && <p className="ol-empty">No heroes carved here yet. Be the first.</p>}
          {rows?.length > 0 && (
            <table className="hall ol-table">
              <thead><tr><th>#</th><th>Crew</th><th>Trial</th><th>Rank</th><th className="num">Kleos</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`${isMine(r) ? 'me' : ''} ${i < 3 ? `ol-top ol-top-${i + 1}` : ''}`}>
                    <td>
                      <span className="ol-place">
                        {i < 3 && <Laurel className="ol-place-laurel" />}
                        <span className={`place place-${i + 1}`}>{i + 1}</span>
                      </span>
                    </td>
                    <td><strong className="ol-crew">{r.team_name}</strong>{r.epithet && <div className="ol-epithet">{r.epithet}</div>}</td>
                    <td>{r.scene_title}<div className="ol-sub">{r.team_size} player{r.team_size > 1 ? 's' : ''}</div></td>
                    <td className="ol-rank">{r.rank}</td>
                    <td className="num kleos">{r.kleos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="ol-base" />
      </div>
    </div>
  )
}
