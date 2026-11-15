import { useState } from 'react'
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

// Screen flow: home -> scenes -> team -> rehearse -> stage -> judging -> verdict
export default function App() {
  const [screen, setScreen] = useState('home')
  const [scene, setScene] = useState(null)
  const [team, setTeam] = useState(null) // { name, players: [{name}], assignments: {charId: playerIdx} }
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const pickScene = async (id) => {
    setScene(await api.scene(id))
    setScreen('team')
  }

  const submit = async (take) => {
    setScreen('judging')
    setError(null)
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
    <>
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
        <Verdict result={result} scene={scene} team={team}
          onRetry={() => setScreen('stage')}
          onNew={() => setScreen('scenes')}
          onHall={() => setScreen('hall')} />
      )}
      {screen === 'hall' && <Leaderboard onBack={() => setScreen('home')} highlight={result} />}
    </div>
    </>
  )
}
