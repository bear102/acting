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
export const PLAYER_COLORS = ['#e8b84a', '#5ec8d8', '#e0644a', '#9be07a']

let loading = null

async function create(Task, fileset, options) {
  try {
    return await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e)
    return Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
  }
}

export function loadLandmarkers() {
  if (!loading) {
    loading = (async () => {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const pose = await create(PoseLandmarker, fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task' },
        runningMode: 'VIDEO', numPoses: 4,
      })
      const face = await create(FaceLandmarker, fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task' },
        runningMode: 'VIDEO', numFaces: 4, outputFaceBlendshapes: true,
      })
      return { pose, face }
    })()
    loading.catch(() => { loading = null })
  }
  return loading
}

const mirrorX = (x) => 1 - x
const centerX = (lm) => mirrorX((lm[11].x + lm[12].x) / 2)
const shoulderWidth = (lm) => Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y)

// Keeps "Player 1 is the leftmost person on screen" stable while people move around.
export class PlayerTracker {
  constructor(n) {
    this.n = n
    this.lastX = Array.from({ length: n }, (_, i) => (i + 0.5) / n)
  }

  assignPoses(poses) {
    let people = poses
    if (people.length > this.n) {
      // Bystanders in the background: keep the n biggest (closest) bodies
      people = [...people].sort((a, b) => shoulderWidth(b) - shoulderWidth(a)).slice(0, this.n)
    }
    const out = Array(this.n).fill(null)
    if (people.length === this.n) {
      [...people].sort((a, b) => centerX(a) - centerX(b)).forEach((p, i) => { out[i] = p })
    } else {
      const taken = new Set()
      for (const p of people) {
        let best = -1, bestD = Infinity
        this.lastX.forEach((x, i) => {
          const d = Math.abs(x - centerX(p))
          if (!taken.has(i) && d < bestD) { best = i; bestD = d }
        })
        if (best >= 0) { taken.add(best); out[best] = p }
      }
    }
    out.forEach((p, i) => { if (p) this.lastX[i] = this.lastX[i] * 0.3 + centerX(p) * 0.7 })
    return out
  }

  assignFaces(faces, blendshapes, playerPoses) {
    const out = Array(this.n).fill(null)
    const taken = new Set()
    faces.forEach((f, fi) => {
      const fx = mirrorX(f[1].x)
      let best = -1, bestD = Infinity
      for (let i = 0; i < this.n; i++) {
        const px = playerPoses[i] ? mirrorX(playerPoses[i][0].x) : this.lastX[i]
        const d = Math.abs(px - fx)
        if (!taken.has(i) && d < bestD) { best = i; bestD = d }
      }
      if (best >= 0 && bestD < 0.25) { taken.add(best); out[best] = blendshapes[fi] }
    })
    return out
  }
}

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

export function drawSkeleton(ctx, lm, color, label, w, h) {
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
    const [x, y] = P(0)
    ctx.font = '700 22px Cinzel, serif'
    ctx.textAlign = 'center'
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(10,16,30,.75)'
    ctx.fillRect(x - tw / 2 - 10, y - 92, tw + 20, 34)
    ctx.fillStyle = color
    ctx.fillText(label, x, y - 67)
  }
  ctx.restore()
}
