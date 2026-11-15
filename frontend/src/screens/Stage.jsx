import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FEATURE_FPS, PLAYER_COLORS, PlayerTracker, drawSkeleton, faceFeature, loadLandmarkers, poseFeature,
} from '../vision.js'
import { guideCharacterFor, refFrameAt, similarity } from '../stage/pose.js'
import FilmPanel from '../stage/FilmPanel.jsx'
import Prompter from '../stage/Prompter.jsx'
import Roster from '../stage/Roster.jsx'
import { snapshotPlan } from '../stage/snapshots.js'
import '../stage/stage.css'

const PRAISE = ['Ares approves!', 'Athena nods.', 'Apollo smiles upon you.', 'Zeus is watching…', 'Hermes takes note.', 'The Muse sings of this!']
const STREAK_MS = 2500
const PLAYER_COOLDOWN_MS = 9000
const GLOBAL_COOLDOWN_MS = 4000

export default function Stage({ scene, team, onCancel, onFinish }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const live = useRef({ phase: 'loading' }) // mutable per-take state read by render loops
  const [phase, setPhaseState] = useState('loading') // loading | ready | countdown | live | sending
  const [error, setError] = useState(null)
  const [count, setCount] = useState(3)
  const [t, setT] = useState(0)
  const [present, setPresent] = useState([])
  const [meters, setMeters] = useState([])
  const [toasts, setToasts] = useState([])

  const nPlayers = team.players.length
  const hasRef = !!scene.reference?.pose
  const hasFilm = !!scene.video
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  const charsOf = (pi) => Object.entries(team.assignments).filter(([, p]) => p === pi).map(([c]) => c)

  const setPhase = (p) => { live.current.phase = p; setPhaseState(p) }

  // Stage clock shared with the film panel and the favor meters.
  // Before "Action!" it loops the scene as a silent preview so players can study the film.
  const getTime = useCallback(() => {
    const L = live.current
    const now = performance.now()
    if (L.recording) return (now - L.start) / 1000
    if (L.phase === 'countdown') return 0
    if (L.phase === 'sending') return L.lastT ?? 0
    if (L.previewStart == null) L.previewStart = now
    return ((now - L.previewStart) / 1000) % Math.max(1, scene.duration)
  }, [scene.duration])
  const getPhase = useCallback(() => live.current.phase, [])

  // ---------------------------------------------------------------- camera + models + render loop
  useEffect(() => {
    let raf = 0
    let stream = null
    let cancelled = false
    const L = live.current
    L.tracker = new PlayerTracker(nPlayers)
    L.meter = Array(nPlayers).fill(null)
    L.streakSince = Array(nPlayers).fill(null)
    L.lastPraise = Array(nPlayers).fill(-Infinity)
    L.lastAnyPraise = -Infinity

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (cancelled) return
        L.stream = stream
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        L.models = await loadLandmarkers(nPlayers)
        if (cancelled) return
        L.tracker.setAspect(v.videoWidth / v.videoHeight)
        stats.model = L.models.model
        setPhase('ready')
        raf = requestAnimationFrame(loop)
      } catch (e) {
        console.error(e)
        setError(e.name === 'NotAllowedError' ? 'Camera/microphone permission was denied.' : String(e))
      }
    })()

    // Debug overlay (press D): track ages, detection count, fps, detector cost. For venue testing.
    const onKey = (e) => {
      if ((e.key === 'd' || e.key === 'D') && !e.target.closest?.('input, textarea')) L.debug = !L.debug
    }
    window.addEventListener('keydown', onKey)

    let lastVideoTime = -1
    let frameNo = 0
    let lastUi = 0
    let lastFrameAt = performance.now()
    const stats = { fps: 0, poseMs: 0, faceMs: 0, skipped: 0, frames: 0, detects: 0, faceDetects: 0, detectMsTotal: 0 }
    window.__stagePerf = stats // read by frontend/scripts/bench-stage.mjs (and handy in devtools)
    // With 3+ people the face mesh is the expensive part: run it every 3rd frame (else 2nd).
    const faceEvery = nPlayers >= 3 ? 3 : 2
    function loop() {
      const v = videoRef.current
      const canvas = canvasRef.current
      if (!v || !canvas) return
      const now = performance.now()
      if (v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime
        frameNo++
        stats.frames++
        stats.fps += (1000 / Math.max(1, now - lastFrameAt) - stats.fps) * 0.1
        const { pose, face } = L.models
        // If detection is running slow, only detect every other frame. The tracker holds
        // poses between detections, and the 10 Hz sampling grid below is unaffected.
        const slow = stats.poseMs + stats.faceMs / faceEvery > 45
        let poses = L.poses || Array(nPlayers).fill(null)
        if (!slow || frameNo % 2 === 0) {
          let t0 = performance.now()
          const pr = pose.detectForVideo(v, now)
          poses = L.tracker.update(pr.landmarks || [], now)
          const dPose = performance.now() - t0
          stats.poseMs += (dPose - stats.poseMs) * 0.2
          stats.detects++
          stats.detectMsTotal += dPose
          if (frameNo % faceEvery === 0 || !L.faces) {
            t0 = performance.now()
            const fr = face.detectForVideo(v, now)
            L.faces = L.tracker.assignFaces(fr.faceLandmarks || [], fr.faceBlendshapes || [], now)
            const dFace = performance.now() - t0
            stats.faceMs += (dFace - stats.faceMs) * 0.2
            stats.faceDetects++
            stats.detectMsTotal += dFace
          }
        } else {
          stats.skipped++
        }
        L.poses = poses
        const st = getTime()
        const dt = Math.min(0.25, (now - lastFrameAt) / 1000)
        lastFrameAt = now
        if (hasRef) updateMeters(poses, st, dt, now)
        draw(canvas, v, poses)
        if (L.debug) drawDebug(canvas, now)
        if (now - lastUi > 100) {
          lastUi = now
          setPresent(poses.map(Boolean))
          setMeters(L.meter.map((m) => (m == null ? null : Math.round(m))))
          if (L.recording) setT(st)
        }
      }
      if (L.recording) tick(now)
      raf = requestAnimationFrame(loop)
    }

    // Rolling (~1s) similarity between each player and their film actor at this instant.
    // Purely numeric: nothing is drawn on the webcam, players copy the film itself.
    function updateMeters(poses, st, dt, now) {
      const fps = scene.reference.fps || FEATURE_FPS
      poses.forEach((lm, i) => {
        const c = guideCharacterFor(scene, charsOf(i), st)
        const ref = refFrameAt(scene.reference.pose[c], st, fps)
        const s = ref && lm && !ref.resting ? similarity(poseFeature(lm), ref.frame) : null
        if (s != null) {
          L.meter[i] = L.meter[i] == null ? s : L.meter[i] + (s - L.meter[i]) * Math.min(1, dt / 1.0)
        } else if (L.meter[i] != null) {
          L.meter[i] = Math.max(0, L.meter[i] - 8 * dt) // slowly fade while out of frame / actor off screen
        }
        if (L.recording) praise(i, now)
      })
    }

    function praise(i, now) {
      if ((L.meter[i] ?? 0) >= 72) {
        L.streakSince[i] ??= now
        if (now - L.streakSince[i] > STREAK_MS && now - L.lastPraise[i] > PLAYER_COOLDOWN_MS &&
          now - L.lastAnyPraise > GLOBAL_COOLDOWN_MS) {
          L.lastPraise[i] = now
          L.lastAnyPraise = now
          L.streakSince[i] = null
          const id = now
          const text = PRAISE[Math.floor(Math.random() * PRAISE.length)]
          setToasts((ts) => [...ts, { id, text, color: PLAYER_COLORS[i], name: team.players[i].name }])
          setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 2600)
        }
      } else {
        L.streakSince[i] = null
      }
    }

    function draw(canvas, v, poses) {
      const w = (canvas.width = v.videoWidth)
      const h = (canvas.height = v.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -w, 0, w, h); ctx.restore()
      // warm torchlit vignette
      const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h / 2, h * 0.95)
      g.addColorStop(0, 'rgba(40,20,5,0)')
      g.addColorStop(1, 'rgba(10,6,14,.6)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      // Identity only: a faint skeleton + name tag so players know they're being tracked.
      poses.forEach((p, i) => {
        drawSkeleton(ctx, p, PLAYER_COLORS[i], `${team.players[i].name} · ${charsOf(i).map(charName).join('/')}`, w, h)
      })
    }

    function drawDebug(canvas, now) {
      const ctx = canvas.getContext('2d')
      const rows = [
        `model ${L.models.model} · ${stats.fps.toFixed(0)} fps · pose ${stats.poseMs.toFixed(0)}ms · face ${stats.faceMs.toFixed(0)}ms/${faceEvery}f`,
        `detections ${L.tracker.lastDetections} · players ${nPlayers} · ${L.tracker.locked ? 'LOCKED' : 'settling order'} · skipped ${stats.skipped}`,
        ...L.tracker.debug(now).map((d) => `P${d.slot + 1} ${team.players[d.slot].name}: ${d.age == null ? 'never seen'
          : d.age < 60 ? 'tracked' : d.held ? `held ${d.age}ms` : `lost ${d.age}ms`}${d.face ? ' · face' : ''}`),
      ]
      ctx.save()
      ctx.font = '600 18px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(0,0,0,.65)'
      ctx.fillRect(8, 8, 640, rows.length * 24 + 12)
      rows.forEach((r, k) => {
        ctx.fillStyle = k < 2 ? '#f3d58c' : PLAYER_COLORS[k - 2]
        ctx.fillText(r, 18, 32 + k * 24)
      })
      ctx.restore()
    }

    function tick(now) {
      const st = (now - L.start) / 1000
      // Sample features on a fixed 10 Hz grid so index == time * FEATURE_FPS
      while (L.nextSample <= st) {
        for (let i = 0; i < nPlayers; i++) {
          L.features[i].pose.push(poseFeature(L.poses?.[i]))
          L.features[i].face.push(faceFeature(L.faces?.[i]))
        }
        L.nextSample += 1 / FEATURE_FPS
      }
      if (L.snapIdx < L.snapPlan.length && st >= L.snapPlan[L.snapIdx]) {
        L.snapIdx++
        snapshot(st)
      }
      if (st >= scene.duration) finish()
    }

    function snapshot(st) {
      const v = videoRef.current
      L.snapTimes.push(+st.toFixed(2))
      const c = document.createElement('canvas')
      c.width = 640
      c.height = Math.round((640 * v.videoHeight) / v.videoWidth)
      const ctx = c.getContext('2d')
      ctx.scale(-1, 1)
      ctx.drawImage(v, -c.width, 0, c.width, c.height)
      L.snaps.push(new Promise((res) => c.toBlob(res, 'image/jpeg', 0.75)))
    }

    L.snapshot = snapshot
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      L.recording = false
      try { if (L.recorder?.state === 'recording') L.recorder.stop() } catch { /* already stopped */ }
      try { L.speech?.abort() } catch { /* not running */ }
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- take control
  const begin = () => {
    setPhase('countdown')
    let n = 3
    setCount(n)
    const iv = setInterval(() => {
      n--
      setCount(n)
      if (n === 0) {
        clearInterval(iv)
        startRecording()
      }
    }, 900)
  }

  function startRecording() {
    const L = live.current
    L.features = Array.from({ length: nPlayers }, () => ({ pose: [], face: [] }))
    L.nextSample = 0
    L.snaps = []
    L.snapTimes = []
    L.snapPlan = snapshotPlan(scene)
    L.snapIdx = 0
    L.transcript = []
    L.chunks = []
    L.meter = Array(nPlayers).fill(null)

    const audioStream = new MediaStream(L.stream.getAudioTracks())
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    L.recorder = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined)
    L.recorder.ondataavailable = (e) => e.data.size && L.chunks.push(e.data)
    L.recorder.start(500)

    // Browser speech recognition: free backup ears if the server-side STT is unavailable
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            L.transcript.push({ text: e.results[i][0].transcript.trim(), t: (performance.now() - L.start) / 1000 })
          }
        }
      }
      rec.onend = () => { if (L.recording) try { rec.start() } catch { /* restarting */ } }
      try { rec.start() } catch { /* unsupported */ }
      L.speech = rec
    }

    // Freeze who-is-who: people crossing mid-take must not swap identities.
    L.tracker.lock()
    L.start = performance.now()
    L.recording = true
    setT(0)
    setPhase('live')
  }

  async function finish() {
    const L = live.current
    if (!L.recording) return
    L.lastT = (performance.now() - L.start) / 1000
    L.recording = false
    setPhase('sending')
    try { L.speech?.stop() } catch { /* already stopped */ }
    const audio = await new Promise((resolve) => {
      if (L.recorder.state === 'inactive') return resolve(new Blob(L.chunks, { type: 'audio/webm' }))
      L.recorder.onstop = () => resolve(new Blob(L.chunks, { type: L.recorder.mimeType || 'audio/webm' }))
      L.recorder.stop()
    })
    if (L.snaps.length === 0) L.snapshot(L.lastT)
    // Keep frames and their times paired even if a toBlob() failed
    const blobs = await Promise.all(L.snaps)
    const frames = []
    const snapshotTimes = []
    blobs.forEach((b, k) => { if (b) { frames.push(b); snapshotTimes.push(L.snapTimes[k]) } })
    // Give the speech recognizer a moment to flush its last result
    await new Promise((r) => setTimeout(r, 600))
    onFinish({
      meta: {
        scene_id: scene.id,
        team_name: team.name,
        players: team.players,
        assignments: team.assignments,
        duration: L.lastT,
        features: { fps: FEATURE_FPS, players: L.features },
        browser_transcript: L.transcript,
        snapshot_times: snapshotTimes,
      },
      audio,
      frames,
    })
  }

  // ---------------------------------------------------------------- render
  const progress = Math.min(1, t / scene.duration)
  const isLive = phase === 'live'

  const camera = (
    <div className="sg-frame">
      <video ref={videoRef} className="sg-hidden-video" playsInline muted />
      <canvas ref={canvasRef} className="sg-canvas" />
      {hasFilm && <div className="sg-frame-label">You</div>}

      {phase === 'loading' && !error && <div className="sg-overlay"><div className="sg-spinner" />Summoning the all-seeing eye…</div>}
      {error && (
        <div className="sg-overlay">
          <p className="bad">{error}</p>
          <button className="btn" onClick={onCancel}>Back</button>
        </div>
      )}

      {phase === 'ready' && (
        <div className="sg-overlay soft">
          <h2 className="sg-overlay-title">Take your places</h2>
          <p>
            Stand left to right, upper body in frame.
            {hasFilm && ' Watch the film beside you: when the scene begins, copy the actors and speak their lines.'}
          </p>
          <div className="row center-row">
            <button className="btn big" onClick={begin}>Action!</button>
          </div>
        </div>
      )}

      {phase === 'countdown' && <div className="sg-overlay sg-countdown" key={count}>{count || 'Action!'}</div>}
      {phase === 'sending' && <div className="sg-overlay"><div className="sg-spinner" />Cut! Sending your performance to Olympus…</div>}

      {isLive && !hasFilm && <Prompter scene={scene} team={team} t={t} />}
      {isLive && <div className="sg-progress"><div style={{ width: `${progress * 100}%` }} /></div>}

      <div className="sg-toasts">
        {toasts.map((x) => (
          <div key={x.id} className="sg-toast" style={{ '--pc': x.color }}>
            <span className="sg-toast-name">{x.name}</span> {x.text}
          </div>
        ))}
      </div>
    </div>
  )

  const plaques = (
    <div className="sg-plaques">
      {team.players.map((p, i) => (
        <Plaque key={i} i={i} name={p.name} roles={charsOf(i).map(charName).join(' / ')}
          present={present[i]} meter={meters[i]} hasRef={hasRef} />
      ))}
    </div>
  )

  return (
    <div className="sg-wrap">
      <header className="sg-head">
        <div>
          <p className="sg-eyebrow">{scene.book} · The Trial</p>
          <h2 className="sg-title">{scene.title}</h2>
        </div>
        <div className="sg-head-right">
          {isLive && <div className="sg-rec"><span className="sg-rec-dot" /> {t.toFixed(1)}s / {scene.duration}s</div>}
          {isLive ? (
            <button className="btn ghost sg-small-btn" onClick={finish}>End scene</button>
          ) : (phase === 'ready' || phase === 'loading' || error) && (
            <button className="btn ghost sg-small-btn" onClick={onCancel}>Back</button>
          )}
        </div>
      </header>

      {hasFilm ? (
        <>
          <div className="sg-duo">
            <FilmPanel src={`/${scene.video}`} getTime={getTime} getPhase={getPhase} />
            {camera}
          </div>
          <div className="sg-band">
            {isLive ? <Prompter scene={scene} team={team} t={t} /> : (
              <div className="sg-band-idle">The lines will appear here, in time with the film.</div>
            )}
          </div>
          {plaques}
        </>
      ) : (
        <>
          {camera}
          {plaques}
          <Roster scene={scene} team={team} t={isLive ? t : null} />
        </>
      )}
    </div>
  )
}

function Plaque({ i, name, roles, present, meter, hasRef }) {
  const pct = meter ?? 0
  const label = !present ? 'Step into the light' : !hasRef ? 'In frame' : meter == null ? 'Watching the film…' : favorWord(pct)
  return (
    <div className={`sg-plaque ${present ? 'here' : ''}`} style={{ '--pc': PLAYER_COLORS[i] }}>
      <div className="sg-plaque-top">
        <span className="sg-badge">{i + 1}</span>
        <div className="sg-plaque-names">
          <strong>{name}</strong>
          <small>{roles}</small>
        </div>
        {hasRef && present && meter != null && <span className="sg-plaque-num">{Math.round(pct)}</span>}
      </div>
      {hasRef && (
        <div className="sg-favor" title="Favor of the Gods: how closely you match your film actor">
          <span className="sg-laurel">❧</span>
          <div className="sg-favor-bar"><div style={{ width: `${present ? pct : 0}%` }} /></div>
          <span className="sg-laurel flip">❧</span>
        </div>
      )}
      <div className="sg-plaque-label">{label}</div>
    </div>
  )
}

function favorWord(p) {
  if (p >= 80) return 'Godlike'
  if (p >= 65) return 'Heroic'
  if (p >= 45) return 'Worthy'
  if (p >= 25) return 'Mortal'
  return 'Lost at sea'
}
