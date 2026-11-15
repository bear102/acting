import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Laurel, Meander } from '../ui/Art.jsx'

export default function Leaderboard({ onBack, highlight }) {
  const [rows, setRows] = useState(null)
  const [scenes, setScenes] = useState([])
  const [sceneId, setSceneId] = useState('')

  useEffect(() => { api.scenes().then(setScenes).catch(() => {}) }, [])
  useEffect(() => { setRows(null); api.leaderboard(sceneId).then(setRows).catch(() => setRows([])) }, [sceneId])

  return (
    <div className="panel narrow tablet">
      <button className="link" onClick={onBack}>← Back</button>
      <p className="eyebrow">Carved in stone forever</p>
      <h2 className="hall-title"><Laurel className="hall-laurel" />Hall of Heroes</h2>
      <Meander className="short left" />
      <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
        <option value="">All trials</option>
        {scenes.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      {!rows && <p className="muted">Reading the stone tablets…</p>}
      {rows?.length === 0 && <p className="muted">No heroes yet. Be the first.</p>}
      {rows?.length > 0 && (
        <table className="hall">
          <thead><tr><th>#</th><th>Crew</th><th>Trial</th><th>Rank</th><th className="num">Kleos</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={highlight && r.created_at && highlight.team_name === r.team_name
                && highlight.kleos === r.kleos ? 'me' : ''}>
                <td><span className={`place place-${i + 1}`}>{i + 1}</span></td>
                <td><strong>{r.team_name}</strong>{r.epithet && <div className="muted small">{r.epithet}</div>}</td>
                <td>{r.scene_title}<div className="muted small">{r.team_size} player{r.team_size > 1 ? 's' : ''}</div></td>
                <td>{r.rank}</td>
                <td className="num kleos">{r.kleos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
