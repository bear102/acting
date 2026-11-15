import { toggleMute, useMuted } from './sfx.js'
import './mute.css'

// Small sound toggle, top-right inside the Odyssey frame (hidden on the stage by App).
export default function MuteToggle() {
  const muted = useMuted()
  return (
    <button type="button" className="mute-toggle" onClick={toggleMute}
      aria-pressed={!muted} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}>
      <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
    </button>
  )
}
