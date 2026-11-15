import { useCallback, useEffect, useState } from 'react'

// Fullscreen for laptop demos: the whole page (frame, backdrop, stage) goes fullscreen; Esc exits.
export default function useFullscreen() {
  const [on, setOn] = useState(() => !!document.fullscreenElement)
  const supported = !!document.documentElement.requestFullscreen

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }, [])

  return { on, toggle, supported }
}
