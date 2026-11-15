// MediaPipe detection off the main thread. One worker runs ONE task (pose or face): two workers
// run in parallel, and each gets its own WASM instance (the module loader only registers its
// factory once per realm, so two tasks can't share a worker reliably).
//
// Protocol
//   -> {type:'init', kind:'pose'|'face', num, model?}   <- {type:'ready', model, delegate} | {type:'error'}
//   -> {type:'detect', bitmap, ts}  (bitmap transferred) <- {type:'result', ts, ms, ...}
//   -> {type:'options', num}
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const CONFIDENCE = { detection: 0.4, presence: 0.4, tracking: 0.5 }
// Only these blendshapes are scored (must match vision.js BLENDSHAPES); skip the other 31.
const KEEP = new Set([
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawOpen',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthPucker',
  'mouthPressLeft', 'mouthPressRight', 'noseSneerLeft', 'noseSneerRight', 'cheekSquintLeft',
  'cheekSquintRight',
])

let task = null
let kind = null
let lastTs = 0

async function create(Task, fileset, options, prefer) {
  // OffscreenCanvas lets the GPU delegate work inside a worker
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined
  if (prefer === 'CPU') {
    const t = await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
    return { t, delegate: 'CPU' }
  }
  try {
    const t = await Task.createFromOptions(fileset, { ...options, canvas, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
    return { t, delegate: 'GPU' }
  } catch (e) {
    console.warn('[vision.worker] GPU delegate failed, using CPU', e)
    const t = await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
    return { t, delegate: 'CPU' }
  }
}

let prefer = null
async function init({ kind: k, num, model, delegate: wanted }) {
  prefer = wanted || null
  kind = k
  const fileset = await FilesetResolver.forVisionTasks(new URL('/mediapipe/wasm', self.location.origin).href, true)
  if (kind === 'pose') {
    const models = model === 'lite' ? ['pose_landmarker_lite'] : ['pose_landmarker_full', 'pose_landmarker_lite']
    let lastErr
    for (const m of models) {
      try {
        const { t, delegate } = await create(PoseLandmarker, fileset, {
          baseOptions: { modelAssetPath: `/mediapipe/models/${m}.task` },
          runningMode: 'VIDEO', numPoses: num,
          minPoseDetectionConfidence: CONFIDENCE.detection,
          minPosePresenceConfidence: CONFIDENCE.presence,
          minTrackingConfidence: CONFIDENCE.tracking,
        }, prefer)
        task = t
        return { model: m, delegate }
      } catch (e) { lastErr = e }
    }
    throw lastErr
  }
  const { t, delegate } = await create(FaceLandmarker, fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task' },
    runningMode: 'VIDEO', numFaces: num, outputFaceBlendshapes: true,
    minFaceDetectionConfidence: CONFIDENCE.detection,
    minFacePresenceConfidence: CONFIDENCE.presence,
    minTrackingConfidence: CONFIDENCE.tracking,
  }, prefer)
  task = t
  return { model: 'face_landmarker', delegate }
}

let cpuInput = false
let scratch = null
function toImageData(bitmap) {
  const { width: w, height: h } = bitmap
  if (!scratch || scratch.canvas.width !== w || scratch.canvas.height !== h) {
    scratch = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  }
  scratch.drawImage(bitmap, 0, 0)
  return scratch.getImageData(0, 0, w, h)
}

function detect(bitmap, ts) {
  // VIDEO mode needs strictly increasing timestamps
  const t = Math.max(Math.round(ts), lastTs + 1)
  lastTs = t
  const t0 = performance.now()
  try {
    // CPU delegate: hand MediaPipe raw pixels. Given an ImageBitmap it converts through WebGL and
    // reads back, which on an integrated GPU busy with the film costs far more than the model.
    const input = cpuInput ? toImageData(bitmap) : bitmap
    if (kind === 'pose') {
      const r = task.detectForVideo(input, t)
      const landmarks = (r.landmarks || []).map((lm) => lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })))
      return { landmarks, ms: performance.now() - t0 }
    }
    const r = task.detectForVideo(input, t)
    // The tracker only needs the nose tip (index 1) to match faces to bodies
    const faces = (r.faceLandmarks || []).map((f) => [null, { x: f[1].x, y: f[1].y }])
    const blendshapes = (r.faceBlendshapes || []).map((b) => ({
      categories: b.categories.filter((c) => KEEP.has(c.categoryName)).map((c) => ({ categoryName: c.categoryName, score: c.score })),
    }))
    return { faces, blendshapes, ms: performance.now() - t0 }
  } finally {
    bitmap.close()
  }
}

self.onmessage = async (e) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      const info = await init(msg)
      cpuInput = info.delegate === 'CPU' && !msg.bitmapInput
      self.postMessage({ type: 'ready', ...info })
    } else if (msg.type === 'detect') {
      const out = detect(msg.bitmap, msg.ts)
      self.postMessage({ type: 'result', ts: msg.ts, ...out })
    } else if (msg.type === 'options' && task) {
      await task.setOptions(kind === 'pose' ? { numPoses: msg.num } : { numFaces: msg.num })
    }
  } catch (err) {
    msg.bitmap?.close?.()
    self.postMessage({ type: msg.type === 'init' ? 'error' : 'result', ts: msg.ts, error: String(err?.message || err) })
  }
}
