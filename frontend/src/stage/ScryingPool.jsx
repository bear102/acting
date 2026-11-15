import { useEffect, useRef } from 'react'

// The film clip, muted and slaved to the stage clock so players can copy the actors.
export default function ScryingPool({ src, getTime, getPhase }) {
  const ref = useRef(null)

  useEffect(() => {
    const iv = setInterval(() => {
      const v = ref.current
      if (!v || !v.duration) return
      const phase = getPhase()
      const t = getTime()
      if (phase === 'sending' || t == null) {
        if (!v.paused) v.pause()
        return
      }
      const target = Math.min(Math.max(0, t), v.duration - 0.05)
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target
      if (phase === 'countdown') {
        if (!v.paused) v.pause()
      } else if (v.paused) {
        v.play().catch(() => {})
      }
    }, 120)
    return () => clearInterval(iv)
  }, [getTime, getPhase])

  return (
    <figure className="sg-pool">
      <div className="sg-pool-frame">
        <video ref={ref} src={src} muted playsInline preload="auto" />
        <div className="sg-pool-sheen" />
      </div>
      <figcaption>The Scrying Pool</figcaption>
    </figure>
  )
}
