// MediaPipe in the browser: multi-person pose + face blendshapes, player tracking,
// and the per-frame feature vectors the backend scores. Shapes MUST match backend/features.py.
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

export const FEATURE_FPS = 10
export const POSE_INDICES = [0, 11, 12, 13, 14, 15, 16]
export const BLENDSHAPES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawOpen',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthPucker',
  'mouthPressLeft', 'mouthPressRight', 'noseSneerLeft', 'noseSneerRight', 'cheekSquintLeft',
  'cheekSquintRight',
]
export { PLAYER_COLORS } from './playerColors.js'

export { PlayerTracker } from './stage/tracker.js'

const POSE_MODELS = ['pose_landmarker_full', 'pose_landmarker_lite'] // full is far better with 3+ people
const CONFIDENCE = { detection: 0.4, presence: 0.4, tracking: 0.5 }

let loading = null

async function create(Task, fileset, options) {
  try {
    return await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e)
    return Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
  }
}

async function createPose(fileset, numPoses, lite) {
  let lastError
  for (const model of lite ? ['pose_landmarker_lite'] : POSE_MODELS) {
    try {
      const task = await create(PoseLandmarker, fileset, {
        baseOptions: { modelAssetPath: `/mediapipe/models/${model}.task` },
        runningMode: 'VIDEO', numPoses,
        minPoseDetectionConfidence: CONFIDENCE.detection,
        minPosePresenceConfidence: CONFIDENCE.presence,
        minTrackingConfidence: CONFIDENCE.tracking,
      })
      return { task, model }
    } catch (e) {
      console.warn(`Pose model ${model} failed to load`, e)
      lastError = e
    }
  }
  throw lastError
}

/**
 * Pose + face landmarkers sized for `players` people (+1 headroom so a bystander or a
 * duplicate detection can't push a real player out). Models load once; a different team
 * size only changes numPoses/numFaces.
 */
export function loadLandmarkers(players = 4, { lite = false } = {}) {
  const want = Math.min(players + 1, 5)
  if (!loading) {
    loading = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const { task: pose, model } = await createPose(fileset, want, lite)
      const face = await create(FaceLandmarker, fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task' },
        runningMode: 'VIDEO', numFaces: want, outputFaceBlendshapes: true,
        minFaceDetectionConfidence: CONFIDENCE.detection,
        minFacePresenceConfidence: CONFIDENCE.presence,
        minTrackingConfidence: CONFIDENCE.tracking,
      })
      return { pose, face, model, size: want }
    })()
    loading.catch(() => { loading = null })
  }
  return loading.then(async (m) => {
    if (m.size !== want) {
      await m.pose.setOptions({ numPoses: want })
      await m.face.setOptions({ numFaces: want })
      m.size = want
    }
    return m
  })
}

const mirrorX = (x) => 1 - x

// 21 floats: 7 landmarks x [x (mirrored), y, visibility]. Must match backend/features.py.
export function poseFeature(lm) {
  if (!lm) return null
  const vis = (lm[11].visibility ?? 1) > 0.4 && (lm[12].visibility ?? 1) > 0.4
  if (!vis) return null
  return POSE_INDICES.flatMap((i) => [
    +mirrorX(lm[i].x).toFixed(3), +lm[i].y.toFixed(3), +(lm[i].visibility ?? 1).toFixed(2),
  ])
}

export function faceFeature(bs) {
  if (!bs) return null
  const byName = Object.fromEntries(bs.categories.map((c) => [c.categoryName, c.score]))
  return BLENDSHAPES.map((n) => +(byName[n] ?? 0).toFixed(3))
}

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]]

/** active: this player is speaking, so their name tag is filled in their colour and glows. */
export function drawSkeleton(ctx, lm, color, label, w, h, active = false) {
  if (!lm) return
  const P = (i) => [mirrorX(lm[i].x) * w, lm[i].y * h]
  ctx.save()
  // Faint on purpose: it only tells players they're tracked; the film is what they copy.
  ctx.globalAlpha = 0.35
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue
    ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke()
  }
  ctx.fillStyle = color
  for (const i of [15, 16]) {
    if ((lm[i].visibility ?? 1) < 0.4) continue
    ctx.beginPath(); ctx.arc(...P(i), 5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  if (label) {
    // Sized to the canvas so it reads from 2-3 m; clamped so it never leaves the frame.
    const [x, y] = P(0)
    let fontPx = Math.round(h * (active ? 0.065 : 0.05))
    const setFont = () => { ctx.font = `${active ? 900 : 700} ${fontPx}px Cinzel, serif` }
    setFont()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let bw = ctx.measureText(label).width + fontPx
    if (bw > w - 8) { // too wide for the frame: shrink the text to fit
      fontPx = Math.max(10, Math.floor(fontPx * (w - 8) / bw))
      setFont()
      bw = Math.min(w - 8, ctx.measureText(label).width + fontPx)
    }
    const bh = fontPx * 1.45
    const bx = Math.round(Math.max(4, Math.min(x - bw / 2, w - 4 - bw)))
    // Above the head; if the head is too close to the top for that, below the chin instead,
    // so the tag never sits on the speaker's face.
    const above = y - h * 0.1 - bh
    const by = Math.round(above >= 4 ? above : Math.min(h - 4 - bh, y + h * 0.12))
    if (active) {
      ctx.shadowColor = color
      ctx.shadowBlur = fontPx * 0.6
    }
    ctx.fillStyle = active ? color : 'rgba(10,16,30,.75)'
    ctx.fillRect(bx, by, bw, bh)
    ctx.shadowBlur = 0
    ctx.fillStyle = active ? '#0a101e' : color
    ctx.fillText(label, bx + bw / 2, by + bh / 2)
  }
  ctx.restore()
}
