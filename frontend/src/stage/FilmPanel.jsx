import { memo, useEffect, useRef, useState } from 'react'

// The film is heard by default at full (default) loudness, before and during the take. The browser's
// echo cancellation runs against this tab's playback; the button mutes it (e.g. if the speakers bleed
// into the microphone and the film's own dialogue gets transcribed as the players' lines).
const AUDIO_KEY = 'trials.filmMuted' // new key: an old "muted" choice from the previous default doesn't carry over
const PREVIEW_VOLUME = 1
const TAKE_VOLUME = 1

const GUIDE_KEY = 'trials.poseGuide'
function readGuide() {
  try { return localStorage.getItem(GUIDE_KEY) !== '0' } catch { return true }
}

// The actor's tracked pose (what Ares compares the player against), drawn on the film as a stick
// figure in the colour of the player who plays that character. Reference frames are 7 landmarks
// [nose, L/R shoulder, L/R elbow, L/R wrist] x [x, y, visibility] in film-normalised coordinates.
function drawGuide(canvas, video, reference, colors) {
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (!w || !h) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const t = video.currentTime
  const shot = reference.shots?.find((sh) => t >= sh.start && t < sh.end)
  const who = shot?.character
  const frame = who && reference.pose?.[who]?.[Math.round(t * (reference.fps || 10))]
  if (!frame) return
  const P = (i) => ({ x: frame[i * 3] * w, y: frame[i * 3 + 1] * h, v: frame[i * 3 + 2] })
  const [nose, ls, rs, le, re, lw, rw] = [0, 1, 2, 3, 4, 5, 6].map(P)
  const ok = (...pts) => pts.every((q) => q.v > 0.5)
  // A tiny figure means the tracker latched onto someone in the background: don't present that as the pose to copy
  if (ok(ls, rs) && Math.hypot(ls.x - rs.x, ls.y - rs.y) < w * 0.06) return
  const color = colors?.[who] || '#f3d58c'
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const stroke = (width, style) => {
    ctx.lineWidth = width; ctx.strokeStyle = style
    ctx.beginPath()
    if (ok(ls, rs)) {
      ctx.moveTo(ls.x, ls.y); ctx.lineTo(rs.x, rs.y)
      const mx = (ls.x + rs.x) / 2, my = (ls.y + rs.y) / 2
      if (ok(nose)) { ctx.moveTo(mx, my); ctx.lineTo(nose.x, nose.y + Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.28) }
      ctx.moveTo(mx, my); ctx.lineTo(mx, my + Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.9) // spine
    }
    for (const [a, b, c] of [[ls, le, lw], [rs, re, rw]]) {
      if (ok(a, b)) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); if (ok(c)) ctx.lineTo(c.x, c.y) }
    }
    ctx.stroke()
    if (ok(nose, ls, rs)) {
      ctx.beginPath(); ctx.arc(nose.x, nose.y, Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.28, 0, Math.PI * 2); ctx.stroke()
    }
  }
  stroke(7, 'rgba(8, 6, 14, .55)') // dark underlay keeps it readable on bright frames
  stroke(3.5, color)
  ctx.fillStyle = color
  for (const q of [ls, rs, le, re, lw, rw]) if (q.v > 0.5) { ctx.beginPath(); ctx.arc(q.x, q.y, 4.5, 0, Math.PI * 2); ctx.fill() }
}

function readPref() {
  try { return localStorage.getItem(AUDIO_KEY) !== '1' } catch { return true }
}
function writePref(on) {
  try { localStorage.setItem(AUDIO_KEY, on ? '0' : '1') } catch { /* storage blocked */ }
}

// The film clip the players imitate, slaved to the stage clock:
//   ready     -> loops for study (getTime returns a looping preview clock)
//   countdown -> parked on frame 0
//   hold      -> parked on the first frame of the new shot, even when the hold comes just before
//                the cut (stage/holds.js `park`); then straight back to the take time
//   live      -> plays from t=0; small drift is absorbed by nudging playbackRate, big jumps seek
//   sending   -> paused
// Audible at full volume (see PREVIEW_VOLUME / TAKE_VOLUME above).
// Memoized: its props are stable, so the stage's ~10 Hz re-renders never touch the film.
export default memo(function FilmPanel({ src, getTime, getPhase, getPark, reference, guideColors }) {
  const ref = useRef(null)
  const guideRef = useRef(null)
  const hasGuide = !!reference?.pose
  const [guide, setGuide] = useState(readGuide)
  const guideOn = useRef(guide)
  guideOn.current = guide
  const lastSeek = useRef(-Infinity)
  const wasHold = useRef(false)
  const [hear, setHear] = useState(readPref)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = !hear
  }, [hear])

  useEffect(() => {
    const iv = setInterval(() => {
      const v = ref.current
      if (!v || !v.duration) return
      const g = guideRef.current
      if (g) {
        if (guideOn.current && reference?.pose) drawGuide(g, v, reference, guideColors)
        else g.getContext('2d').clearRect(0, 0, g.width, g.height)
      }
      const phase = getPhase()
      const t = getTime()
      const vol = phase === 'live' || phase === 'hold' ? TAKE_VOLUME : PREVIEW_VOLUME
      if (Math.abs(v.volume - vol) > 0.001) v.volume = vol
      const heldBefore = wasHold.current
      wasHold.current = phase === 'hold'
      if (phase === 'sending' || phase === 'loading' || t == null) {
        if (!v.paused) v.pause()
        return
      }
      const park = phase === 'hold' ? getPark?.() : null
      const target = Math.min(Math.max(0, park ?? t), v.duration - 0.05)
      const drift = v.currentTime - target
      const now = performance.now()
      // Seeking stalls decoding (and on a busy laptop can snowball into a seek storm), so only
      // seek for big jumps (start, preview loop wrap, long stalls) and at most once a second;
      // absorb small drift by nudging the playback rate instead.
      if (heldBefore && phase !== 'hold') {
        // Hold over: if the parked frame was ahead of the take, jump straight back in sync
        if (Math.abs(drift) > 0.03) { v.currentTime = target; lastSeek.current = now }
        v.playbackRate = 1
      } else if (phase === 'hold') {
        // Parked at a shot change: show exactly the frame the players should match. The target
        // doesn't move during a hold, so this seeks once.
        if (Math.abs(drift) > 0.03 && !v.seeking) { v.currentTime = target; lastSeek.current = now }
        v.playbackRate = 1
      } else if (Math.abs(drift) > 0.5 && (now - lastSeek.current > 1000 || phase !== 'live')) {
        v.currentTime = target
        lastSeek.current = now
        v.playbackRate = 1
      } else if (phase === 'live' && Math.abs(drift) > 0.08) {
        v.playbackRate = drift > 0 ? 0.93 : 1.07
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1
      }
      if (phase === 'countdown' || phase === 'hold') {
        if (!v.paused) v.pause()
      } else if (v.paused) {
        v.play().catch(() => {
          // Autoplay with sound can be blocked before a click: fall back to muted playback.
          v.muted = true
          v.play().catch(() => {})
        })
      }
    }, 100)
    return () => clearInterval(iv)
  }, [getTime, getPhase, getPark, reference, guideColors])

  const toggle = () => {
    const on = !hear
    setHear(on)
    writePref(on)
    const v = ref.current
    if (v) v.muted = !on
  }

  return (
    <figure className="sg-film">
      <div className="sg-film-frame">
        <video ref={ref} src={src} muted playsInline preload="auto" />
        <div className="sg-film-vignette" />
        {hasGuide && <canvas ref={guideRef} className="sg-film-guide" aria-hidden="true" />}
        {/* Caption sits inside the frame so the film and the camera line up and keep full height */}
        <figcaption className="sg-film-cap">
          <span className="sg-film-label"><span>✦</span> The Shades of the Past <span>✦</span></span>
          {hasGuide && (
            <button type="button" className={`sg-hear sg-guide-btn ${guide ? 'on' : ''}`}
              onClick={() => { const on = !guide; setGuide(on); try { localStorage.setItem(GUIDE_KEY, on ? '1' : '0') } catch { /* storage blocked */ } }}
              aria-pressed={guide} title={guide ? 'Hide the pose guide' : 'Show the pose the gods compare you to'}>
              <span className="sg-guide-ico" aria-hidden="true">웃</span><span className="sg-hear-text">{guide ? ' Pose guide on' : ' Pose guide'}</span>
            </button>
          )}
          <button type="button" className={`sg-hear ${hear ? 'on' : ''}`} onClick={toggle}
            aria-label={hear ? 'Mute the film' : 'Hear the film'}
            title={hear ? 'Mute the film (it plays quietly during your take)' : 'Hear the film'}>
            {hear ? '🔊' : '🔈'}<span className="sg-hear-text">{hear ? ' Film audio on' : ' Hear the film'}</span>
          </button>
        </figcaption>
      </div>
    </figure>
  )
})
