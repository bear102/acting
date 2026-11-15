import { useEffect, useRef, useState } from 'react'

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
//   live      -> plays from t=0, re-seeks if it drifts > 0.25s
//   sending   -> paused
// Muted by default so the film's dialogue doesn't leak into the microphone recording.
export default function FilmPanel({ src, getTime, getPhase }) {
  const ref = useRef(null)
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
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target
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
}
