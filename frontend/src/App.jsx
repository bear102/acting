import MuteToggle from './audio/MuteToggle.jsx'
import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './api.js'
import { rollCrewName } from './crewNames.js'
import Home from './screens/Home.jsx'
import SceneSelect from './screens/SceneSelect.jsx'
import TeamSetup from './screens/TeamSetup.jsx'
import Rehearse from './screens/Rehearse.jsx'
// The stage (and MediaPipe with it) is a separate chunk: the first page loads without ~300 kB of
// vision code. It is fetched during team setup and the detector is warmed during rehearsal,
// so 'Take the stage' starts without waiting for workers, WASM and models.
const loadStage = () => import('./screens/Stage.jsx')
const Stage = lazy(loadStage)
import Judging from './screens/Judging.jsx'
import Verdict from './screens/Verdict.jsx'
import Leaderboard from './screens/Leaderboard.jsx'
import Backdrop from './ui/Backdrop.jsx'
import FullscreenButton from './ui/FullscreenButton.jsx'
import Journey from './ui/Journey.jsx'
import OdysseyFrame from './theme/OdysseyFrame.jsx'

// Screen flow: home -> scenes -> team -> rehearse -> stage -> judging -> verdict
export default function App() {
  const [screen, setScreen] = useState('home')
  const [scene, setScene] = useState(null)
  const [team, setTeam] = useState(null) // { name, players: [{name}], assignments: {charId: playerIdx} }
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [snaps, setSnaps] = useState([]) // [{t, url}] the players' own snapshots, for the verdict reel
  const [hallFrom, setHallFrom] = useState('home') // 'home' | 'verdict': where the Hall's back link returns to
  const [lastTake, setLastTake] = useState(null) // the take being judged, kept so a failed upload can be resent

  // Dev only: /?preview=<screen> (scenes, team, rehearse, stage, judging, verdict) opens that screen on a canned
  // take, skipping the screens before it.
  useEffect(() => {
    const preview = new URLSearchParams(location.search).get('preview')
    if (!import.meta.env.DEV || !['scenes', 'team', 'rehearse', 'stage', 'judging', 'verdict'].includes(preview)) return
    import('./dev/mockVerdict.js').then((m) => {
      setScene(m.scene)
      setTeam(m.team)
      setSnaps(m.snaps)
      if (preview === 'verdict') setResult(m.result)
      setScreen(preview)
    })
  }, [])

  // Warm-up: fetch the stage chunk on team setup; spin up the detector (workers + WASM + models)
  // for this crew size while they rehearse. preloadDetector is idempotent per team size.
  const crewSize = team?.players?.length
  useEffect(() => {
    if (screen === 'team') loadStage().catch(() => {})
    if (screen === 'rehearse' && crewSize) {
      loadStage().catch(() => {})
      import('./stage/detector.js').then((m) => m.preloadDetector(crewSize)).catch(() => {})
    }
  }, [screen, crewSize])

  const pickScene = async (id) => {
    setScene(await api.scene(id))
    setScreen('team')
  }

  // Uploads a take. Resending after a failure calls this alone, so the snapshot URLs stay as they are.
  const send = async (take) => {
    setScreen('judging')
    setError(null)
    try {
      setResult(await api.perform(take))
      setLastTake(null)
      setScreen('verdict')
    } catch (e) {
      console.error(e)
      setError(String(e))
      setScreen('stage-error')
    }
  }

  const submit = (take) => {
    setLastTake(take)
    snaps.forEach((s) => URL.revokeObjectURL(s.url))
    setSnaps(take.frames.map((blob, i) => ({ t: take.meta.snapshot_times[i], url: URL.createObjectURL(blob) })))
    return send(take)
  }

  return (
    <OdysseyFrame variant={screen === 'stage' ? 'thin' : 'full'}>
    <Backdrop />
    {screen !== 'stage' && <MuteToggle />}
    {screen !== 'stage' && <FullscreenButton />}
    <div className={`app screen-${screen}`}>
      {/* Where you are in the game. Finished steps are links back; judging shows the last step pending.
          Not on the stage itself: that screen is sized to the pixel and must stay uncluttered. */}
      {screen === 'judging'
        ? <div className="jy-wrap"><Journey at="verdict" /></div>
        : screen !== 'stage' && <Journey at={screen} onGo={setScreen} />}
      {screen === 'home' && <Home onStart={() => setScreen('scenes')} onHall={() => { setHallFrom('home'); setScreen('hall') }} />}
      {screen === 'scenes' && <SceneSelect onPick={pickScene} onBack={() => setScreen('home')} />}
      {screen === 'team' && (
        <TeamSetup scene={scene} initial={team} onBack={() => setScreen('scenes')}
          onReady={(t) => { setTeam(t.name === 'Nameless Crew' ? { ...t, name: rollCrewName() } : t); setScreen('rehearse') }} />
      )}
      {screen === 'rehearse' && (
        <Rehearse scene={scene} team={team} onGo={() => setScreen('stage')} />
      )}
      {screen === 'stage' && (
        <Suspense fallback={<div className="panel center"><p className="muted">Raising the curtainâ€¦</p></div>}>
          <Stage scene={scene} team={team} onCancel={() => setScreen('rehearse')} onFinish={submit} />
        </Suspense>
      )}
      {screen === 'judging' && <Judging snaps={snaps} />}
      {screen === 'stage-error' && (
        <div className="panel center tablet">
          <img className="err-art err-poseidon" src="/art/generated/poseidon.webp" alt="" width="384" height="384" />
          <h2>Poseidon swallowed your performance</h2>
          {lastTake && <p>Your take is safe.</p>}
          <div className="row center-row">
            {lastTake && <button className="btn" onClick={() => send(lastTake)}>Send it again</button>}
            <button className="btn ghost" onClick={() => setScreen('stage')}>Perform again</button>
          </div>
          <details className="muted small"><summary>Details</summary>{error}</details>
        </div>
      )}
      {/* Stays mounted (hidden) under the Hall, so coming back does not replay the reveal or lose its progress chips. */}
      {result && (screen === 'verdict' || (screen === 'hall' && hallFrom === 'verdict')) && (
        <div hidden={screen !== 'verdict'}>
          <Verdict result={result} scene={scene} team={team} snaps={snaps}
            onRetry={() => setScreen('stage')}
            onNew={() => setScreen('scenes')}
            onHome={() => { setTeam(null); setResult(null); setScreen('home') }}
            onHall={() => { setHallFrom('verdict'); setScreen('hall'); window.scrollTo(0, 0) }} />
        </div>
      )}
      {screen === 'hall' && (
        <Leaderboard highlight={hallFrom === 'verdict' ? result : null}
          onBack={() => { setScreen(hallFrom); window.scrollTo(0, 0) }}
          onRetry={hallFrom === 'verdict' ? () => setScreen('stage') : null} />
      )}
    </div>
    </OdysseyFrame>
  )
}
