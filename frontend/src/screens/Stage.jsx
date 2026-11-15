import { useEffect, useRef, useState } from 'react'
import {
  FEATURE_FPS, PLAYER_COLORS, PlayerTracker, drawGhost, drawSkeleton, faceFeature, loadLandmarkers, poseFeature,
} from '../vision.js'

const SNAPSHOT_AT = [0.2, 0.45, 0.7, 0.9] // fractions of the scene sent to Gemini

export default function Stage({ scene, team, onCancel, onFinish }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const live = useRef({}) // mutable per-take state the render loop reads without re-rendering
  const [phase, setPhase] = useState('loading') // loading | ready | countdown | live | sending
  const [error, setError] = useState(null)
  const [count, setCount] = useState(3)
  const [t, setT] = useState(0)
  const [present, setPresent] = useState([])

  const nPlayers = team.players.length
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  const charsOf = (pi) => Object.entries(team.assignments).filter(([, p]) => p === pi).map(([c]) => c)

  // ---------------------------------------------------------------- camera + models
  useEffect(() => {
    let raf = 0
    let stream = null
    let cancelled = false
    const L = live.current
    L.tracker = new PlayerTracker(nPlayers)

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
        L.models = await loadLandmarkers()
        if (cancelled) return
        setPhase('ready')
        raf = requestAnimationFrame(loop)
      } catch (e) {
        console.error(e)
        setError(e.name === 'NotAllowedError' ? 'Camera/microphone permission was denied.' : String(e))
      }
    })()

    let lastVideoTime = -1
    let frameNo = 0
    let lastUi = 0
    function loop() {
      const v = videoRef.current
      const canvas = canvasRef.current
      if (!v || !canvas) return
      const now = performance.now()
      if (v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime
        frameNo++
        const { pose, face } = L.models
        const pr = pose.detectForVideo(v, now)
        const poses = L.tracker.assignPoses(pr.landmarks || [])
        // Face mesh is heavier: run it every other frame
        if (frameNo % 2 === 0 || !L.faces) {
          const fr = face.detectForVideo(v, now)
          L.faces = L.tracker.assignFaces(fr.faceLandmarks || [], fr.faceBlendshapes || [], poses)
        }
        L.poses = poses
        draw(canvas, v, poses, now)
        if (now - lastUi > 400) {
          lastUi = now
          setPresent(poses.map(Boolean))
        }
      }
      if (L.recording) tick(now)
      raf = requestAnimationFrame(loop)
    }

    function draw(canvas, v, poses, now) {
      const w = (canvas.width = v.videoWidth)
      const h = (canvas.height = v.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.save(); ctx.scale(-1, 1); ctx.drawImage(v, -w, 0, w, h); ctx.restore()
      const st = L.recording ? (now - L.start) / 1000 : 0
      const ref = scene.reference?.pose
      poses.forEach((p, i) => {
        const chars = charsOf(i)
        if (ref && L.recording) {
          const speaking = scene.lines.find((l) => st >= l.start && st <= l.end && chars.includes(l.character))
          const c = speaking?.character || chars[0]
          drawGhost(ctx, ref[c]?.[Math.floor(st * (scene.reference.fps || FEATURE_FPS))], p, w, h)
        }
        drawSkeleton(ctx, p, PLAYER_COLORS[i], `${team.players[i].name} · ${chars.map(charName).join('/')}`, w, h)
      })
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
      if (L.snapIdx < SNAPSHOT_AT.length && st >= SNAPSHOT_AT[L.snapIdx] * scene.duration) {
        L.snapIdx++
        snapshot()
      }
      setT(st)
      if (st >= scene.duration) finish()
    }

    function snapshot() {
      const v = videoRef.current
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
      L.recording = false
      try { L.recorder?.state === 'recording' && L.recorder.stop() } catch { /* already stopped */ }
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
    L.snapIdx = 0
    L.transcript = []
    L.chunks = []

    const audioStream = new MediaStream(L.stream.getAudioTracks())
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    L.recorder = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined)
    L.recorder.ondataavailable = (e) => e.data.size && L.chunks.push(e.data)
    L.recorder.start(500)

    // Browser speech recognition: free backup ears if ElevenLabs is unavailable
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

    L.start = performance.now()
    L.recording = true
    setPhase('live')
  }

  async function finish() {
    const L = live.current
    if (!L.recording) return
    L.recording = false
    setPhase('sending')
    try { L.speech?.stop() } catch { /* already stopped */ }
    const audio = await new Promise((resolve) => {
      if (L.recorder.state === 'inactive') return resolve(new Blob(L.chunks, { type: 'audio/webm' }))
      L.recorder.onstop = () => resolve(new Blob(L.chunks, { type: L.recorder.mimeType || 'audio/webm' }))
      L.recorder.stop()
    })
    if (L.snaps.length === 0) L.snapshot()
    const frames = (await Promise.all(L.snaps)).filter(Boolean)
    // Give the speech recognizer a moment to flush its last result
    await new Promise((r) => setTimeout(r, 600))
    onFinish({
      meta: {
        scene_id: scene.id,
        team_name: team.name,
        players: team.players,
        assignments: team.assignments,
        duration: (performance.now() - L.start) / 1000,
        features: { fps: FEATURE_FPS, players: L.features },
        browser_transcript: L.transcript,
      },
      audio,
      frames,
    })
  }

  // ---------------------------------------------------------------- teleprompter
  const current = scene.lines.find((l) => t >= l.start - 0.3 && t <= l.end + 0.5)
  const next = scene.lines.find((l) => l.start > t + 0.3 && l !== current)
  const progress = Math.min(1, t / scene.duration)

  return (
    <div className="stage">
      <div className="stage-frame">
        <video ref={videoRef} className="hidden-video" playsInline muted />
        <canvas ref={canvasRef} className="stage-canvas" />

        {phase === 'loading' && !error && <div className="overlay">Summoning the all-seeing eye…</div>}
        {error && (
          <div className="overlay">
            <p className="bad">{error}</p>
            <button className="btn" onClick={onCancel}>Back</button>
          </div>
        )}

        {phase === 'ready' && (
          <div className="overlay soft">
            <h2>Take your places</h2>
            <p>Stand left to right. Get your whole upper body in frame.</p>
            <div className="players">
              {team.players.map((p, i) => (
                <span key={i} className={`presence ${present[i] ? 'here' : ''}`} style={{ borderColor: PLAYER_COLORS[i] }}>
                  {present[i] ? '✓' : '…'} {p.name} ({charsOf(i).map(charName).join('/')})
                </span>
              ))}
            </div>
            <div className="row center-row">
              <button className="btn ghost" onClick={onCancel}>Back</button>
              <button className="btn big" onClick={begin}>Action!</button>
            </div>
          </div>
        )}

        {phase === 'countdown' && <div className="overlay countdown">{count || 'Action!'}</div>}
        {phase === 'sending' && <div className="overlay">Cut! Sending your performance to Olympus…</div>}

        {phase === 'live' && (
          <>
            <div className="rec"><span className="rec-dot" /> {t.toFixed(1)}s / {scene.duration}s</div>
            <div className="prompter">
              {current ? <Line line={current} t={t} team={team} name={charName(current.character)} big /> :
                next ? <div className="cue">Next: <Line line={next} t={t} team={team} name={charName(next.character)} /></div> :
                  <div className="cue">Hold the final moment…</div>}
              {current && next && next.start - t < 2.5 && (
                <div className="cue small">Next: {charName(next.character)}</div>
              )}
            </div>
            <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
            <button className="btn ghost end-btn" onClick={finish}>End scene</button>
          </>
        )}
      </div>
    </div>
  )
}

function Line({ line, t, team, name, big }) {
  const p = team.assignments[line.character]
  const words = line.text.split(' ')
  const frac = Math.max(0, Math.min(1, (t - line.start) / (line.end - line.start)))
  const lit = Math.round(frac * words.length)
  return (
    <div className={big ? 'line big' : 'line'}>
      <div className="speaker" style={{ color: PLAYER_COLORS[p] }}>
        {name} · {team.players[p].name}
        {line.direction && <span className="dir"> ({line.direction})</span>}
      </div>
      <div className="words">
        {words.map((w, i) => <span key={i} className={big && i < lit ? 'lit' : ''}>{w} </span>)}
      </div>
    </div>
  )
}
