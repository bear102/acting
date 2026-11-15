// Detection scheduler for the live stage.
//
// Default: two Web Workers (pose, face) running MediaPipe in parallel off the main thread, fed
// downscaled ImageBitmaps of the camera. The main thread only captures frames, tracks players and
// draws, so the UI, the film and the teleprompter stay smooth even when detection is slow.
// Fallback (no Worker/OffscreenCanvas/createImageBitmap, worker init failure, or ?detect=main):
// the original main-thread landmarkers, fed a downscaled canvas and rate-limited.
//
// Hybrid tracking: when the browser can record the webcam (MediaRecorder video), the server runs
// the full pose + face analysis on the recorded take, so live tracking is LIGHT: pose_landmarker_lite
// only, ~15 Hz, no face landmarker (enough for name tags, the faint skeleton and the favor meter).
// Without video recording the old full live path (pose + face) is kept so faces are still scored.
//
// URL knobs (for venue tuning): ?lite=1 (or ?pose=lite) forces the lite pose model,
// ?detect=main forces main-thread detection, ?light=0 forces the full live path,
// ?delegate=gpu, ?poseWorkers=N, ?input=bitmap (see stageOptions).
import { loadLandmarkers } from '../vision.js'

const DETECT_WIDTH = 640 // landmarks are normalized, so a smaller input only changes cost
const INIT_TIMEOUT_MS = 30000

export function stageOptions() {
  let q
  try { q = new URLSearchParams(window.location.search) } catch { q = new URLSearchParams() }
  return {
    lite: q.get('lite') === '1' || q.get('pose') === 'lite',
    mode: q.get('detect') === 'main' ? 'main' : 'worker',
    // Measured on an Intel UHD laptop: the GPU delegate inside workers fights the film's video
    // decode and the compositor for the iGPU (dropped film frames, stalls), so workers default to
    // the CPU (XNNPACK) delegate. ?delegate=gpu tries the GPU first.
    delegate: q.get('delegate') === 'gpu' ? 'GPU' : 'CPU',
    bitmapInput: q.get('input') === 'bitmap', // A/B knob for the ImageData path in the worker
    light: q.get('light') === '0' ? false : videoRecordingMime() != null,
    // MediaPipe's CPU WASM is single-threaded: in the full path, round-robin pose frames over 2
    // workers when the machine has the cores (roughly doubles pose detections/s).
    poseWorkers: q.get('poseWorkers') ? Math.max(1, Math.min(3, +q.get('poseWorkers'))) : null,
  }
}

/** Best supported MediaRecorder type for the take's webcam video, or null if video can't be recorded. */
export function videoRecordingMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return null
  return ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) || null
}

// Several identical pose workers used round-robin. Results can come back out of order, so each
// result carries the capture time and the caller drops stale ones.
class PoolLane {
  constructor(lanes) { this.lanes = lanes }
  get busy() { return this.lanes.every((l) => l.busy) }
  get avgMs() { return this.lanes.reduce((a, l) => a + l.avgMs, 0) / this.lanes.length }
  get count() { return this.lanes.reduce((a, l) => a + l.count, 0) }
  get msTotal() { return this.lanes.reduce((a, l) => a + l.msTotal, 0) }
  submit(video, ts) { return this.lanes.find((l) => !l.busy)?.submit(video, ts) ?? Promise.resolve(null) }
  setNum(num) { this.lanes.forEach((l) => l.setNum(num)) }
  destroy() { this.lanes.forEach((l) => l.destroy()) }
}

function detectSize(video) {
  const w = Math.min(DETECT_WIDTH, video.videoWidth || DETECT_WIDTH)
  const h = Math.round((w * (video.videoHeight || 360)) / (video.videoWidth || 640))
  return { w, h }
}

class WorkerLane {
  constructor(kind) {
    this.kind = kind
    this.busy = false
    this.avgMs = 0
    this.count = 0
    this.msTotal = 0
    this.worker = new Worker(new URL('./vision.worker.js', import.meta.url), { type: 'module' })
    this.pending = null
  }

  init(num, model, delegate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.kind} worker init timed out`)), INIT_TIMEOUT_MS)
      this.worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'ready') { clearTimeout(timer); this.info = m; this.worker.onmessage = (ev) => this.onResult(ev.data); resolve(m) }
        else if (m.type === 'error') { clearTimeout(timer); reject(new Error(m.error)) }
      }
      this.worker.onerror = (e) => { clearTimeout(timer); reject(e.error || new Error(e.message || 'worker error')) }
      this.worker.postMessage({ type: 'init', kind: this.kind, num, model, delegate, bitmapInput: stageOptions().bitmapInput })
    })
  }

  onResult(m) {
    const p = this.pending
    this.pending = null
    this.busy = false
    if (!p) return
    if (m.error) { p.resolve(null); return }
    this.count++
    this.msTotal += m.ms
    this.avgMs += (m.ms - this.avgMs) * 0.2
    p.resolve(m)
  }

  /** Capture a downscaled frame and detect. Resolves with the result, or null on failure. */
  async submit(video, ts) {
    if (this.busy) return null
    this.busy = true
    let bitmap
    try {
      const { w, h } = detectSize(video)
      bitmap = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: 'low' })
    } catch {
      this.busy = false
      return null
    }
    return new Promise((resolve) => {
      this.pending = { resolve }
      this.worker.postMessage({ type: 'detect', bitmap, ts }, [bitmap])
    })
  }

  setNum(num) { this.worker.postMessage({ type: 'options', num }) }
  destroy() { this.worker.terminate(); this.pending?.resolve(null); this.pending = null }
}

class MainLane {
  constructor(kind, task, canvas) {
    this.kind = kind
    this.task = task
    this.canvas = canvas
    this.busy = false
    this.avgMs = 0
    this.count = 0
    this.msTotal = 0
    this.lastTs = 0
  }

  submit(video, ts) {
    const { w, h } = detectSize(video)
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }
    this.canvas.getContext('2d').drawImage(video, 0, 0, w, h)
    const t = Math.max(Math.round(ts), this.lastTs + 1)
    this.lastTs = t
    const t0 = performance.now()
    const r = this.task.detectForVideo(this.canvas, t)
    const ms = performance.now() - t0
    this.count++
    this.msTotal += ms
    this.avgMs += (ms - this.avgMs) * 0.2
    const out = this.kind === 'pose'
      ? { landmarks: r.landmarks || [], ms }
      : { faces: r.faceLandmarks || [], blendshapes: r.faceBlendshapes || [], ms }
    return Promise.resolve(out)
  }

  setNum() {}
  destroy() {}
}

/**
 * Returns { mode, model, delegate, pose, face, destroy } where pose/face are lanes with
 * submit(video, ts) -> Promise<result|null>, busy, avgMs, count, msTotal.
 */
let warm = null // { players, promise } started by preloadDetector()

/**
 * Start the detector (workers + WASM + models, ~1-3 s) ahead of the stage, e.g. during Team setup
 * or Rehearsal. Idempotent; the next createDetector(players) with the same team size adopts it.
 */
export function preloadDetector(players) {
  if (!warm || warm.players !== players) {
    warm?.promise.then((d) => d.destroy()).catch(() => {})
    const promise = buildDetector(players)
    promise.catch(() => { if (warm?.promise === promise) warm = null })
    warm = { players, promise }
  }
  return warm.promise
}

export function createDetector(players) {
  if (warm && warm.players === players) {
    const { promise } = warm
    warm = null // a detector belongs to one stage; the stage destroys it on unmount
    return promise.catch(() => buildDetector(players))
  }
  return buildDetector(players)
}

async function buildDetector(players) {
  const opts = stageOptions()
  const num = Math.min(players + 1, 5)
  const light = opts.light
  const lite = light || opts.lite
  const nPose = opts.poseWorkers ?? (light ? 1 : (navigator.hardwareConcurrency || 4) >= 8 ? 2 : 1)
  const canWorker = opts.mode === 'worker' && typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined'
  if (canWorker) {
    const poseLanes = Array.from({ length: nPose }, () => new WorkerLane('pose'))
    const pose = new PoolLane(poseLanes)
    const face = light ? null : new WorkerLane('face')
    try {
      const infos = await Promise.all([
        ...poseLanes.map((l) => l.init(num, lite ? 'lite' : 'full', opts.delegate)),
        ...(face ? [face.init(num, undefined, opts.delegate)] : []),
      ])
      const pi = infos[0]
      const fi = face ? infos[infos.length - 1] : null
      return {
        mode: 'worker', light, model: pi.model, pose, face,
        delegate: `${pi.delegate}x${poseLanes.length}${fi ? `/${fi.delegate}` : ' (no face)'}`,
        destroy() { pose.destroy(); face?.destroy() },
      }
    } catch (e) {
      console.warn('Worker detection unavailable, falling back to main thread', e)
      pose.destroy()
      face?.destroy()
    }
  }
  const m = await loadLandmarkers(players, { lite })
  const canvas = document.createElement('canvas')
  return {
    mode: 'main', light, model: m.model, delegate: 'main', pose: new MainLane('pose', m.pose, canvas),
    face: light ? null : new MainLane('face', m.face, canvas), destroy() {},
  }
}
