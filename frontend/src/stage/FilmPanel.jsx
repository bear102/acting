import { memo, useEffect, useRef, useState } from 'react'

// The film is heard by default at full (default) loudness, before and during the take. The browser's
// echo cancellation runs against this tab's playback; the button mutes it (e.g. if the speakers bleed
// into the microphone and the film's own dialogue gets transcribed as the players' lines).
const AUDIO_KEY = 'trials.filmMuted' // new key: an old "muted" choice from the previous default doesn't carry over
const PREVIEW_VOLUME = 1
const TAKE_VOLUME = 1

function readPref() {
  try { return localStorage.getItem(AUDIO_KEY) !== '1' } catch { return true }
}
function writePref(on) {
  try { localStorage.setItem(AUDIO_KEY, on ? '0' : '1') } catch { /* storage blocked */ }
}

// The film clip the players imitate, slaved to the stage clock:
//   ready     -> loops for study (getTime returns a looping preview clock)
//   countdown -> parked on frame 0
//   hold      -> parked on the first frame of the new shot (stage/holds.js)
//   live      -> plays from t=0; small drift is absorbed by nudging playbackRate, big jumps seek
//   sending   -> paused
// Audible at full volume (see PREVIEW_VOLUME / TAKE_VOLUME above).
// Memoized: its props are stable, so the stage's ~10 Hz re-renders never touch the film.
export default memo(function FilmPanel({ src, getTime, getPhase }) {
  const ref = useRef(null)
  const lastSeek = useRef(-Infinity)
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
      const phase = getPhase()
      const t = getTime()
      const vol = phase === 'live' || phase === 'hold' ? TAKE_VOLUME : PREVIEW_VOLUME
      if (Math.abs(v.volume - vol) > 0.001) v.volume = vol
      if (phase === 'sending' || phase === 'loading' || t == null) {
        if (!v.paused) v.pause()
        return
      }
      const target = Math.min(Math.max(0, t), v.duration - 0.05)
      const drift = v.currentTime - target
      const now = performance.now()
      // Seeking stalls decoding (and on a busy laptop can snowball into a seek storm), so only
      // seek for big jumps (start, preview loop wrap, long stalls) and at most once a second;
      // absorb small drift by nudging the playback rate instead.
      if (phase === 'hold') {
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
  }, [getTime, getPhase])

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
        {/* Caption sits inside the frame so the film and the camera line up and keep full height */}
        <figcaption className="sg-film-cap">
          <span className="sg-film-label"><span>✦</span> The Shades of the Past <span>✦</span></span>
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
