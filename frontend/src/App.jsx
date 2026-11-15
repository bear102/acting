import { useEffect, useState } from 'react'
import { api } from './api.js'
import Home from './screens/Home.jsx'
import SceneSelect from './screens/SceneSelect.jsx'
import TeamSetup from './screens/TeamSetup.jsx'
import Rehearse from './screens/Rehearse.jsx'
import Stage from './screens/Stage.jsx'
import Judging from './screens/Judging.jsx'
import Verdict from './screens/Verdict.jsx'
import Leaderboard from './screens/Leaderboard.jsx'
import Backdrop from './ui/Backdrop.jsx'
import { Trident } from './ui/Art.jsx'
import OdysseyFrame from './theme/OdysseyFrame.jsx'

// Screen flow: home -> scenes -> team -> rehearse -> stage -> judging -> verdict
export default function App() {
  const [screen, setScreen] = useState('home')
  const [scene, setScene] = useState(null)
  const [team, setTeam] = useState(null) // { name, players: [{name}], assignments: {charId: playerIdx} }
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [snaps, setSnaps] = useState([]) // [{t, url}] the players' own snapshots, for the verdict reel

  // Dev only: /?preview=verdict opens the verdict on a canned take, no camera or backend needed.
  useEffect(() => {
    if (!import.meta.env.DEV || new URLSearchParams(location.search).get('preview') !== 'verdict') return
    import('./dev/mockVerdict.js').then((m) => {
      setScene(m.scene)
      setTeam(m.team)
      setSnaps(m.snaps)
      setResult(m.result)
      setScreen('verdict')
    })
  }, [])

  const pickScene = async (id) => {
    setScene(await api.scene(id))
    setScreen('team')
  }

  const submit = async (take) => {
    setScreen('judging')
    setError(null)
    snaps.forEach((s) => URL.revokeObjectURL(s.url))
    setSnaps(take.frames.map((blob, i) => ({ t: take.meta.snapshot_times[i], url: URL.createObjectURL(blob) })))
    try {
      setResult(await api.perform(take))
      setScreen('verdict')
    } catch (e) {
      console.error(e)
      setError(String(e))
      setScreen('stage-error')
    }
  }

  return (
    <OdysseyFrame variant={screen === 'stage' ? 'thin' : 'full'}>
    <Backdrop />
    <div className={`app screen-${screen}`}>
      {screen === 'home' && <Home onStart={() => setScreen('scenes')} onHall={() => setScreen('hall')} />}
      {screen === 'scenes' && <SceneSelect onPick={pickScene} onBack={() => setScreen('home')} />}
      {screen === 'team' && (
        <TeamSetup scene={scene} initial={team} onBack={() => setScreen('scenes')}
          onReady={(t) => { setTeam(t); setScreen('rehearse') }} />
      )}
      {screen === 'rehearse' && (
        <Rehearse scene={scene} team={team} onBack={() => setScreen('team')} onGo={() => setScreen('stage')} />
      )}
      {screen === 'stage' && (
        <Stage scene={scene} team={team} onCancel={() => setScreen('rehearse')} onFinish={submit} />
      )}
      {screen === 'judging' && <Judging />}
      {screen === 'stage-error' && (
        <div className="panel center tablet">
          <Trident className="err-art" />
          <h2>Poseidon swallowed your performance</h2>
          <p className="muted">{error}</p>
          <p>Is the backend running on port 8000?</p>
          <button className="btn" onClick={() => setScreen('stage')}>Try the scene again</button>
        </div>
      )}
      {screen === 'verdict' && (
        <Verdict result={result} scene={scene} team={team} snaps={snaps}
          onRetry={() => setScreen('stage')}
          onNew={() => setScreen('scenes')}
          onHall={() => setScreen('hall')} />
      )}
      {screen === 'hall' && <Leaderboard onBack={() => setScreen('home')} highlight={result} />}
    </div>
    </OdysseyFrame>
  )
}
