import useFullscreen from '../stage/useFullscreen.js'
import '../theme/fullscreen.css'

// Fullscreen toggle pinned to the top-right corner of every screen (the stage has its own in its header).
export default function FullscreenButton() {
  const fs = useFullscreen()
  if (!fs.supported) return null
  const label = fs.on ? 'Exit fullscreen (Esc)' : 'Fullscreen'
  return (
    <button type="button" className="fsb" onClick={fs.toggle} title={label} aria-label={label} aria-pressed={fs.on}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {fs.on
          ? <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
          : <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />}
      </svg>
    </button>
  )
}
