import { memo, useEffect, useRef, useState } from 'react'

const AUDIO_KEY = 'trials.hearFilm'
const FILM_VOLUME = 0.25

function readPref() {
  try { return localStorage.getItem(AUDIO_KEY) === '1' } catch { return false }
}
function writePref(on) {
  try { localStorage.setItem(AUDIO_KEY, on ? '1' : '0') } catch { /* storage blocked */ }
}

// The film clip the players imitate, slaved to the stage clock:
//   ready     -> loops silently for study (getTime returns a looping preview clock)
//   countdown -> parked on frame 0
//   live      -> plays from t=0; small drift is absorbed by nudging playbackRate, big jumps seek
//   sending   -> paused
// Muted by default so the film's dialogue doesn't leak into the microphone recording.
// Memoized: its props are stable, so the stage's ~10 Hz re-renders never touch the film.
export default memo(function FilmPanel({ src, getTime, getPhase }) {
  const ref = useRef(null)
  const lastSeek = useRef(-Infinity)
  const [hear, setHear] = useState(readPref)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = !hear
    v.volume = FILM_VOLUME
  }, [hear])

  useEffect(() => {
    const iv = setInterval(() => {
      const v = ref.current
      if (!v || !v.duration) return
      const phase = getPhase()
      const t = getTime()
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
      if (Math.abs(drift) > 0.5 && (now - lastSeek.current > 1000 || phase !== 'live')) {
        v.currentTime = target
        lastSeek.current = now
        v.playbackRate = 1
      } else if (phase === 'live' && Math.abs(drift) > 0.08) {
        v.playbackRate = drift > 0 ? 0.93 : 1.07
      } else if (v.playbackRate !== 1) {
        v.playbackRate = 1
      }
      if (phase === 'countdown') {
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
    if (v) { v.muted = !on; v.volume = FILM_VOLUME }
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
            aria-label={hear ? 'Mute the film' : 'Hear the film (use headphones)'}
            title="The film's audio is muted so it doesn't leak into your microphone. Use headphones if you turn it on.">
            {hear ? '🔊' : '🔈'}<span className="sg-hear-text">{hear ? ' Film audio on' : ' Hear the film'}</span>
          </button>
        </figcaption>
      </div>
    </figure>
  )
})
