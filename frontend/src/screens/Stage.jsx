import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FEATURE_FPS, PLAYER_COLORS, PlayerTracker, drawSkeleton, faceFeature, poseFeature,
} from '../vision.js'
import { createDetector, videoRecordingMime } from '../stage/detector.js'
import { guideCharacterFor, refFrameAt, similarity } from '../stage/pose.js'
import FilmPanel from '../stage/FilmPanel.jsx'
import Prompter from '../stage/Prompter.jsx'
import Roster from '../stage/Roster.jsx'
import { HOLD_MS, readHoldsPref, sceneHolds, writeHoldsPref } from '../stage/holds.js'
import { snapshotPlan } from '../stage/snapshots.js'
import useFullscreen from '../stage/useFullscreen.js'
import { play, setRecording } from '../audio/sfx.js'
import '../stage/stage.css'
import '../stage/stage-perf.css'

// Restart = remount: a fresh StageInner re-initialises the camera and detector, and the discarded
// take is never finished, so nothing is uploaded.
export default function Stage(props) {
  const [k, setK] = useState(0)
  return <StageInner key={k} {...props} onRestart={() => setK((x) => x + 1)} />
}

// Raw getUserMedia / detector errors -> a short headline (the raw text goes under "Details")
function cameraErrorTitle(e) {
  switch (e?.name) {
    case 'NotAllowedError': return 'Camera blocked'
    case 'NotReadableError':
    case 'TrackStartError': return 'Camera busy'
    case 'NotFoundError':
    case 'OverconstrainedError': return 'No camera found'
    default: return 'The stage could not start'
  }
}

function StageInner({ scene, team, onCancel, onFinish, onRestart }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const live = useRef({ phase: 'loading' }) // mutable per-take state read by render loops
  const [phase, setPhaseState] = useState('loading') // loading | ready | countdown | live | sending
  const [error, setError] = useState(null) // { title, raw }
  const [count, setCount] = useState(3)
  const [go, setGo] = useState(false) // the brief "Action!" flash once recording has started
  const [t, setT] = useState(0)
  const [present, setPresent] = useState([])
  const [meters, setMeters] = useState([])
  const [hold, setHold] = useState(null) // { player, character, at } while the take is held at a cut
  const [pauses, setPauses] = useState(readHoldsPref) // hold before each new speaker (setting, remembered)
  live.current.pauses = pauses // read by startRecording, which may run from an older render's closure
  const canPause = sceneHolds(scene, team.assignments).length > 0
  const togglePauses = () => setPauses((on) => { writeHoldsPref(!on); return !on })
  const fullscreen = useFullscreen()

  const nPlayers = team.players.length
  const hasRef = !!scene.reference?.pose
  const hasFilm = !!scene.video
  const charName = (id) => scene.characters.find((c) => c.id === id)?.name
  // Whose line it is at take time st (same window as the prompter), as a player index, else -1
  const speakerAt = (st) => {
    const line = scene.lines.find((l) => st >= l.start - 0.3 && st <= l.end + 0.5)
    return line ? team.assignments[line.character] : -1
  }
  // character id -> colour of the player who plays it (stable identity so the memoized film never re-renders)
  const guideColors = useMemo(() => Object.fromEntries(Object.entries(team.assignments).map(([c, pi]) => [c, PLAYER_COLORS[pi]])), [team.assignments])
  const charsOf = (pi) => Object.entries(team.assignments).filter(([, p]) => p === pi).map(([c]) => c)

  const setPhase = (p) => { live.current.phase = p; setPhaseState(p) }

  // Take time in scene seconds: wall time since "Action!" minus every hold, so it stands still
  // while the take is held at a shot change.
  const sceneTime = (now) => {
    const L = live.current
    const held = L.pausedMs + (L.hold ? now - L.hold.since : 0)
    return (now - L.start - held) / 1000
  }

  // Stage clock shared with the film panel and the favor meters.
  // Before "Action!" it loops the scene as a silent preview so players can study the film.
  const getTime = useCallback(() => {
    const L = live.current
    const now = performance.now()
    if (L.recording) return sceneTime(now)
    if (L.phase === 'countdown') return 0
    if (L.phase === 'sending') return L.lastT ?? 0
    if (L.previewStart == null) L.previewStart = now
    return ((now - L.previewStart) / 1000) % Math.max(1, scene.duration)
  }, [scene.duration])
  const getPhase = useCallback(() => live.current.phase, [])
  // During a hold the film parks on the first frame of the new shot (may be just after the hold time)
  const getPark = useCallback(() => live.current.hold?.park ?? null, [])

  // ---------------------------------------------------------------- camera + detection + render loop
  //
  // Performance design (see frontend/scripts/bench-stage.mjs):
  //  * MediaPipe runs in two Web Workers (pose, face) fed downscaled ImageBitmaps, so detection
  //    never blocks rendering, the film or the teleprompter (stage/detector.js; main-thread fallback).
  //  * Detection rate is decoupled from the render rate: a lane only gets a new frame when it's idle.
  //  * The camera is shown as a CSS-mirrored <video>; the canvas only draws skeletons + name tags.
  //  * React state updates are throttled to ~10 Hz and skipped when nothing changed.
  useEffect(() => {
    let raf = 0
    let stream = null
    let cancelled = false
    const L = live.current
    L.tracker = new PlayerTracker(nPlayers)
    L.meter = Array(nPlayers).fill(null)
    L.poses = Array(nPlayers).fill(null)
    const labels = team.players.map((pl, i) => `${i + 1} ${pl.name}`) // the role is on the plaque
    // Pause decorative page animations (frame border, embers, torches) while on stage: stage.css
    document.body.classList.add('stage-live')

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Landmarks are resolution-independent: 960x540 is plenty and far cheaper than 720p+
          video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return }
        L.stream = stream
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        const det = await createDetector(nPlayers)
        if (cancelled) { det.destroy(); return }
        L.det = det
        L.tracker.setAspect(v.videoWidth / v.videoHeight)
        stats.model = det.model
        stats.mode = det.mode
        stats.delegate = det.delegate
        stats.light = det.light
        // Hybrid tracking: the take's webcam video is recorded for full server-side analysis.
        // A clone of the camera track downscaled by the browser (no main-thread drawing), raw
        // orientation (not mirrored), prepared now so the recording starts at the final size.
        L.videoMime = videoRecordingMime()
        const cam = stream.getVideoTracks()[0]
        if (L.videoMime && cam) {
          const vt = cam.clone()
          // max (not ideal) makes the browser's track adapter actually scale the clone down
          await vt.applyConstraints({ width: { max: 640 }, height: { max: 360 }, frameRate: { max: 24 } })
            .catch(() => { /* keep the clone at camera size */ })
          if (cancelled) { vt.stop(); return }
          L.videoTrack = vt
        }
        setPhase('ready')
        raf = requestAnimationFrame(loop)
      } catch (e) {
        console.error(e)
        if (!cancelled) setError({ title: cameraErrorTitle(e), raw: String(e) })
      }
    })()

    // Keys: Space/Enter = Action! (ready), R = restart the take (countdown/live),
    // D = debug overlay (track ages, detection rates/cost, model, mode; for venue testing).
    // Registered once, so it calls through refs to this render's begin/phase/onRestart.
    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const tg = e.target
      if (tg?.isContentEditable || tg?.closest?.('input, textarea, select, [contenteditable]')) return
      const key = e.key
      const ph = L.phase // set synchronously by setPhase, unlike React state
      if (key === 'd' || key === 'D') {
        L.debug = !L.debug
        L.dirty = true
      } else if ((key === ' ' || key === 'Enter') && ph === 'ready') {
        // let a control reached by keyboard act natively; after a mouse click (Fullscreen, Pauses) focus
        // lingers on it but Space should still mean Action!
        if (tg?.closest?.('button, a, [role="button"], [role="switch"]')?.matches(':focus-visible')) return
        e.preventDefault()
        beginRef.current()
      } else if ((key === 'r' || key === 'R') && (ph === 'countdown' || ph === 'live')) {
        restartTake()
      }
    }
    window.addEventListener('keydown', onKey)

    let lastVideoTime = -1
    let lastUi = 0
    let lastRafAt = performance.now()
    let lastPoseAt = -Infinity
    let lastFaceAt = -Infinity
    let lastPoseResultAt = performance.now()
    let lastPoseCaptured = -Infinity
    let shownPresent = ''
    let shownMeters = ''
    let shownHold = ''
    const stats = {
      fps: 0, poseMs: 0, faceMs: 0, poseHz: 0, frames: 0, detects: 0, faceDetects: 0,
      detectMsTotal: 0, mode: '', model: '', delegate: '',
    }
    window.__stagePerf = stats // read by frontend/scripts/bench-stage.mjs (and handy in devtools)

    // Target detection rates. Worker lanes run as fast as they can up to these; on the main
    // thread (fallback) every detection blocks rendering, so stay well below the frame rate.
    // Light (hybrid) mode: the server analyses the recorded video, live only needs ~15 Hz pose.
    const rates = () => (L.det.light
      ? { pose: L.det.mode === 'worker' ? 15 : 10, face: 0 }
      : L.det.mode === 'worker'
        ? { pose: 30, face: nPlayers >= 3 ? 8 : 12 }
        : { pose: 12, face: nPlayers >= 3 ? 4 : 6 })

    function loop() {
      const v = videoRef.current
      const canvas = canvasRef.current
      if (!v || !canvas || cancelled) return
      const now = performance.now()
      stats.fps += (1000 / Math.max(1, now - lastRafAt) - stats.fps) * 0.05
      lastRafAt = now
      if (v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime
        stats.frames++
        schedule(v, now)
      }
      if (L.dirty) {
        L.dirty = false
        draw(canvas, v, L.poses, L.recording ? speakerAt(getTime()) : -1)
        if (L.debug) drawDebug(canvas, now)
      }
      if (now - lastUi > 100) {
        lastUi = now
        pushUi()
      }
      if (L.recording) tick(now)
      raf = requestAnimationFrame(loop)
    }

    // Hand the newest camera frame to whichever detector lane is idle.
    function schedule(v, now) {
      const { pose, face } = L.det
      const r = rates()
      if (!pose.busy && now - lastPoseAt >= 1000 / r.pose) {
        lastPoseAt = now
        pose.submit(v, now).then((res) => { if (res && !cancelled) onPose(res, now) })
        if (L.det.mode === 'main') return // at most one blocking detection per frame
      }
      if (face && !face.busy && now - lastFaceAt >= 1000 / r.face) {
        lastFaceAt = now
        face.submit(v, now).then((res) => {
          if (!res || cancelled) return
          L.faces = L.tracker.assignFaces(res.faces || [], res.blendshapes || [], now)
          stats.faceMs += (res.ms - stats.faceMs) * 0.2
          stats.faceDetects++
          stats.detectMsTotal += res.ms
        })
      }
    }

    function onPose(res, capturedAt) {
      // Pose frames are spread over several workers; never let an older frame overwrite a newer one
      if (capturedAt <= lastPoseCaptured) return
      lastPoseCaptured = capturedAt
      const now = performance.now()
      L.poses = L.tracker.update(res.landmarks || [], capturedAt)
      stats.poseMs += (res.ms - stats.poseMs) * 0.2
      stats.poseHz += (1000 / Math.max(1, now - lastPoseResultAt) - stats.poseHz) * 0.2
      stats.detects++
      stats.detectMsTotal += res.ms
      const dt = Math.min(0.25, (now - lastPoseResultAt) / 1000)
      lastPoseResultAt = now
      if (hasRef) updateMeters(L.poses, getTime(), dt)
      L.dirty = true
    }

    // ~10 Hz React updates, skipped when the values didn't change.
    function pushUi() {
      const pres = L.poses.map(Boolean)
      const pk = pres.join()
      if (pk !== shownPresent) { shownPresent = pk; setPresent(pres) }
      const ms = L.meter.map((m) => (m == null ? null : Math.round(m)))
      const mk = ms.join()
      if (mk !== shownMeters) { shownMeters = mk; setMeters(ms) }
      if (L.recording) setT(getTime())
      const hk = L.hold ? `${L.hold.player}:${L.hold.at}` : ''
      if (hk !== shownHold) {
        shownHold = hk
        setHold(L.hold ? { player: L.hold.player, character: L.hold.character, at: L.hold.at } : null)
      }
      if (L.debug) L.dirty = true
    }

    // Rolling (~1s) similarity between each player and their film actor at this instant.
    // Purely numeric: nothing is drawn on the webcam, players copy the film itself.
    function updateMeters(poses, st, dt) {
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
      })
    }

    // Overlay only: the camera itself is the <video> underneath (mirrored in CSS). The canvas
    // keeps the camera's aspect ratio and the same object-fit as the video, so they line up.
    function draw(canvas, v, poses, speaker) {
      const w = Math.min(960, v.videoWidth || 960)
      const h = Math.round((w * (v.videoHeight || 540)) / (v.videoWidth || 960))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      // A faint skeleton + name tag so players know they're tracked; during a take, whoever's line
      // it is gets their name tag filled in their colour.
      poses.forEach((p, i) => { if (i !== speaker) drawSkeleton(ctx, p, PLAYER_COLORS[i], labels[i], w, h, false) })
      // the speaker last, so a neighbour's tag never covers theirs
      if (speaker >= 0) drawSkeleton(ctx, poses[speaker], PLAYER_COLORS[speaker], labels[speaker], w, h, true)
    }

    function drawDebug(canvas, now) {
      const ctx = canvas.getContext('2d')
      const rows = [
        `${stats.mode}${stats.light ? ' · light (server analyses video)' : ''} · ${stats.model} · ${stats.delegate} · ui ${stats.fps.toFixed(0)} fps`,
        `pose ${stats.poseHz.toFixed(0)}/s ${stats.poseMs.toFixed(0)}ms · face ${stats.faceMs.toFixed(0)}ms · detections ${L.tracker.lastDetections}`,
        `players ${nPlayers} · ${L.tracker.locked ? 'LOCKED' : 'settling order'}`,
        ...L.tracker.debug(now).map((d) => `P${d.slot + 1} ${team.players[d.slot].name}: ${d.age == null ? 'never seen'
          : d.age < 120 ? 'tracked' : d.held ? `held ${d.age}ms` : `lost ${d.age}ms`}${d.face ? ' · face' : ''}`),
      ]
      ctx.save()
      ctx.font = '600 15px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(0,0,0,.65)'
      ctx.fillRect(6, 6, 560, rows.length * 20 + 10)
      rows.forEach((r, k) => {
        ctx.fillStyle = k < 3 ? '#f3d58c' : PLAYER_COLORS[k - 3]
        ctx.fillText(r, 14, 26 + k * 20)
      })
      ctx.restore()
    }

    function tick(now) {
      if (L.hold) {
        if (now < L.hold.until) return // held: nothing is sampled, the clock stands still
        endHold(now)
      }
      const st = sceneTime(now)
      if (L.holdIdx < L.holds.length && st >= L.holds[L.holdIdx].at) {
        startHold(L.holds[L.holdIdx++], now)
        return
      }
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

    // Hold: freeze the take (film, clock, recordings) so the next speaker can get in place.
    function startHold(h, now) {
      // Pause both recordings first: if either can't pause, skip this hold rather than let the
      // recording and the clock drift apart.
      const paused = []
      try {
        for (const r of [L.recorder, L.videoRecorder]) {
          if (r?.state === 'recording') { r.pause(); paused.push(r) }
        }
      } catch (e) {
        console.warn('Recorder could not pause; skipping this hold', e)
        paused.forEach((r) => { try { r.resume() } catch { /* already running */ } })
        return
      }
      L.hold = { ...h, since: now, until: now + HOLD_MS }
      L.phase = 'hold' // the film panel parks on the new shot; React's phase stays 'live'
      L.dirty = true
    }

    function endHold(now) {
      if (!L.hold) return
      L.pausedMs += now - L.hold.since
      L.hold = null
      if (L.phase === 'hold') L.phase = 'live'
      for (const r of [L.recorder, L.videoRecorder]) {
        try { if (r?.state === 'paused') r.resume() } catch { /* already running */ }
      }
    }
    L.endHold = endHold

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
      document.body.classList.remove('stage-live')
      L.unmounted = true
      clearInterval(L.countdownIv) // leaving during the countdown must not start a take afterwards
      clearTimeout(L.goTimer)
      // leaving or restarting mid-take must not leave the app's sound muted (a restart remounts
      // straight back onto the stage, so the sfx module's own leave-the-stage reset never fires)
      setRecording(false) // harmless when not recording; also covers a take that failed to start
      L.recording = false
      // 'paused' too: the stage can be left in the middle of a shot-change hold
      try { if (L.recorder && L.recorder.state !== 'inactive') L.recorder.stop() } catch { /* already stopped */ }
      try { if (L.videoRecorder && L.videoRecorder.state !== 'inactive') L.videoRecorder.stop() } catch { /* already stopped */ }
      L.videoTrack?.stop()
      try { L.speech?.abort() } catch { /* not running */ }
      L.det?.destroy()
      stream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- take control
  const begin = () => {
    const L = live.current
    if (L.countdownIv || L.recording) return // double-click on "Action!" must not start two takes
    play('gong', { allowOnStage: true })
    setPhase('countdown')
    let n = 3
    setCount(n)
    L.countdownIv = setInterval(() => {
      n--
      setCount(n)
      if (n === 0) {
        clearInterval(L.countdownIv)
        L.countdownIv = null
        if (L.unmounted) return
        startRecording() // never delayed: the "Action!" flash plays over the first moments of the take
        setGo(true)
        clearTimeout(L.goTimer)
        L.goTimer = setTimeout(() => setGo(false), 700)
      }
    }, 900)
  }
  // The keydown listener (registered once) calls through these
  const beginRef = useRef(begin)
  beginRef.current = begin
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const restartRef = useRef(onRestart)
  restartRef.current = onRestart
  // Discard the take and start over; never once the take is being sent (that upload must finish)
  function restartTake() {
    if (live.current.phase === 'sending') return
    restartRef.current?.()
  }

  function startRecording() {
    setRecording(true) // silence everything before the mic starts (no sound may bleed into the take)
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
    L.pausedMs = 0
    L.hold = null
    L.holdIdx = 0
    L.holds = L.pauses ? sceneHolds(scene, team.assignments) : []

    const audioStream = new MediaStream(L.stream.getAudioTracks())
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m))
    L.recorder = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined)
    L.recorder.ondataavailable = (e) => e.data.size && L.chunks.push(e.data)
    L.recorder.start(500)

    // Webcam video (no audio) for the server's pose + face analysis; started with the audio.
    L.videoChunks = []
    L.videoRecorder = null
    L.videoStartAt = null
    if (L.videoTrack) {
      try {
        const vr = new MediaRecorder(new MediaStream([L.videoTrack]), { mimeType: L.videoMime, videoBitsPerSecond: 1_200_000 })
        vr.ondataavailable = (e) => e.data.size && L.videoChunks.push(e.data)
        vr.onstart = () => { L.videoStartAt = performance.now() }
        vr.start(1000)
        L.videoRecorder = vr
      } catch (e) {
        console.warn('Video recording unavailable; scoring falls back to live features', e)
      }
    }

    // Browser speech recognition: free backup ears if the server-side STT is unavailable
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) {
      const rec = new SR()
      rec.continuous = true
      rec.interimResults = false
      rec.lang = 'en-US'
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          // side talk during a shot-change hold ("step out!") is not part of the scene
          if (e.results[i].isFinal && !L.hold) {
            L.transcript.push({ text: e.results[i][0].transcript.trim(), t: sceneTime(performance.now()) })
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
    const now = performance.now()
    L.endHold?.(now) // ended during a hold: resume so the recorders stop cleanly and the clock is settled
    L.lastT = sceneTime(now)
    L.recording = false
    setHold(null)
    setPhase('sending')
    try { L.speech?.stop() } catch { /* already stopped */ }
    const stopRec = (rec, chunks, type) => new Promise((resolve) => {
      if (!rec) return resolve(null)
      if (rec.state === 'inactive') return resolve(new Blob(chunks, { type }))
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type }))
      rec.stop()
    })
    const [audio, recorded] = await Promise.all([
      stopRec(L.recorder, L.chunks, 'audio/webm'),
      stopRec(L.videoRecorder, L.videoChunks, 'video/webm'),
    ])
    const video = recorded && recorded.size > 1000 ? recorded : null
    setRecording(false)
    if (L.unmounted) return // restarted or left mid-finish: discard
    play('cut', { allowOnStage: true })
    if (L.snaps.length === 0) L.snapshot(L.lastT)
    // Keep frames and their times paired even if a toBlob() failed
    const blobs = await Promise.all(L.snaps)
    const frames = []
    const snapshotTimes = []
    blobs.forEach((b, k) => { if (b) { frames.push(b); snapshotTimes.push(L.snapTimes[k]) } })
    // Give the speech recognizer a moment to flush its last result
    await new Promise((r) => setTimeout(r, 600))
    if (L.unmounted) return
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
        ...(video && {
          video_offset_s: L.videoStartAt != null ? +((L.videoStartAt - L.start) / 1000).toFixed(3) : 0,
          video_mirrored: false,
        }),
      },
      audio,
      video,
      frames,
    })
  }

  // ---------------------------------------------------------------- render
  const progress = Math.min(1, t / scene.duration)
  const isLive = phase === 'live'

  const camera = (
    <div className="sg-frame">
      <video ref={videoRef} className="sg-canvas sg-cam-video" playsInline muted />
      <div className="sg-cam-vignette" />
      <canvas ref={canvasRef} className="sg-canvas sg-cam-overlay" />
      {hasFilm && <div className="sg-frame-label">You</div>}

      {phase === 'loading' && !error && <div className="sg-overlay"><div className="sg-spinner" />Summoning the all-seeing eye…</div>}
      {error && (
        <div className="sg-overlay sg-error">
          <p className="bad sg-error-title">{error.title}</p>
          <details className="muted small"><summary>Details</summary>{error.raw}</details>
          <div className="row center-row">
            <button className="btn" onClick={onRestart}>Try again</button>
            <button className="btn ghost" onClick={onCancel}>Back</button>
          </div>
        </div>
      )}

      {phase === 'ready' && (
        // Kept to a top strip and the button at the bottom: the middle is where the players stand
        <div className="sg-overlay sg-ready">
          <div className="sg-ready-top">
            <h2 className="sg-overlay-title">Take your places</h2>
            <div className="sg-places" role="status" aria-label={`${present.filter(Boolean).length} of ${nPlayers} in frame`}>
              {team.players.map((p, i) => (
                <div key={i} className={`sg-place ${present[i] ? 'here' : ''}`} style={{ '--pc': PLAYER_COLORS[i] }}>
                  <span className="sg-place-disc">{i + 1}</span>
                  <span className="sg-place-name">{p.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="row center-row">
            <button className={`btn big ${team.players.every((_, i) => present[i]) ? 'sg-go' : ''}`} onClick={begin}
              title="Action! (Space)">Action!</button>
          </div>
        </div>
      )}

      {phase === 'countdown' && count > 0 && <div className="sg-overlay sg-countdown" key={count}>{count}</div>}
      {isLive && go && <div className="sg-overlay sg-countdown sg-go-flash">Action!</div>}
      {isLive && hold && (
        // Hold: one big disc for the player about to speak; its ring drains over the hold
        <div className="sg-overlay soft sg-hold" style={{ '--pc': PLAYER_COLORS[hold.player], '--hold-ms': `${HOLD_MS}ms` }}>
          <p className="sg-sr" role="status">{`${team.players[hold.player].name} as ${charName(hold.character)}.${nPlayers > 1 ? ' Everyone else, step out of frame.' : ' Get ready.'}`}</p>
          <div className="sg-hold-disc" aria-hidden="true">
            <svg className="sg-hold-ring" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="47" className="sg-hold-ring-bg" />
              <circle key={`${hold.player}:${hold.at}`} cx="50" cy="50" r="47" pathLength="100" className="sg-hold-ring-fg" />
            </svg>
            <span>{hold.player + 1}</span>
          </div>
          <div className="sg-hold-who" aria-hidden="true">
            <strong>{team.players[hold.player].name}</strong>
            <span>as {charName(hold.character)}</span>
          </div>
          {nPlayers > 1 && <div className="sg-hold-out" aria-hidden="true">Others, step out</div>}
        </div>
      )}
      {phase === 'sending' && <div className="sg-overlay"><div className="sg-spinner" />Cut! Sending your performance to Olympus…</div>}

      {isLive && <div className="sg-progress"><div style={{ width: `${progress * 100}%` }} /></div>}
    </div>
  )

  // Subtitle band (same under the film pair and under a camera on its own): live words, or before
  // the take the opening line, dimmed, instead of describing itself
  const band = (
    <div className="sg-band">
      {isLive ? <Prompter scene={scene} team={team} t={t} /> : (
        <div className="sg-band-idle"><Prompter scene={scene} team={team} t={-5} /></div>
      )}
    </div>
  )

  const plaques = (
    <div className="sg-plaques">
      {team.players.map((p, i) => (
        <Plaque key={i} i={i} name={p.name} roles={charsOf(i).map(charName).join(' / ')}
          present={present[i]} meter={meters[i]} hasRef={hasRef} speaking={isLive && speakerAt(t) === i} />
      ))}
    </div>
  )

  return (
    <div className={`sg-wrap ${isLive ? 'is-live' : ''} ${hasFilm ? 'has-film' : 'no-film'}`}>
      <header className="sg-head">
        <div className="sg-head-titles">
          <p className="sg-eyebrow">{scene.book} · The Trial</p>
          <h2 className="sg-title">{scene.title}</h2>
        </div>
        <div className="sg-head-right">
          {isLive && <div className="sg-rec"><span className="sg-rec-dot" /> {t.toFixed(1)}s / {scene.duration}s</div>}
          {canPause && !isLive && phase !== 'sending' && (
            // Setting: pause the take before each new speaker so they can get ready (stage/holds.js)
            <button type="button" className={`btn ghost sg-small-btn sg-pause-btn ${pauses ? 'on' : ''}`} role="switch"
              aria-checked={pauses} onClick={togglePauses}
              title={pauses ? 'The scene pauses before each new speaker so they can get ready. Click to turn off.' : 'Turn on pauses before each new speaker'}>
              <span className="sg-switch" aria-hidden="true"><i /></span> Pauses
            </button>
          )}
          {fullscreen.supported && (
            <button type="button" className="btn ghost sg-small-btn sg-fs-btn" onClick={fullscreen.toggle}
              title={fullscreen.on ? 'Exit fullscreen (Esc)' : 'Fill the screen: best for laptops'}>
              {fullscreen.on ? '⤡ Exit fullscreen' : '⛶ Fullscreen'}
            </button>
          )}
          {(phase === 'countdown' || isLive) && (
            <button type="button" className="btn ghost sg-small-btn" onClick={restartTake}
              title="Discard this take and start over (R)">Restart</button>
          )}
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
            <div className="sg-cell sg-cell-film">
              <FilmPanel src={`/${scene.video}`} getTime={getTime} getPhase={getPhase} getPark={getPark}
                reference={scene.reference} guideColors={guideColors} />
            </div>
            <div className="sg-cell sg-cell-cam">{camera}</div>
          </div>
          {band}
          {plaques}
        </>
      ) : (
        <>
          <div className="sg-solo">
            <div className="sg-cell sg-cell-solo">{camera}</div>
            <Roster scene={scene} team={team} t={isLive ? t : null} />
          </div>
          {band}
          {plaques}
        </>
      )}
    </div>
  )
}

const Plaque = memo(function Plaque({ i, name, roles, present, meter, hasRef, speaking }) {
  const pct = meter ?? 0
  const label = !present ? 'Step into the light' : !hasRef ? 'In frame' : meter == null ? 'Watching the film…' : favorWord(pct)
  const hot = hasRef && present && meter != null && meter >= 72
  return (
    <div className={`sg-plaque ${present ? 'here' : ''} ${hot ? 'hot' : ''} ${speaking ? 'speaking' : ''}`} style={{ '--pc': PLAYER_COLORS[i] }}>
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
})

function favorWord(p) {
  if (p >= 80) return 'Godlike'
  if (p >= 65) return 'Heroic'
  if (p >= 45) return 'Worthy'
  if (p >= 25) return 'Mortal'
  return 'Lost at sea'
}
