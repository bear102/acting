// Hand-drawn black-figure style SVG art. All shapes use currentColor so CSS sets the tint.

export function Ship({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 240 140" fill="currentColor" aria-hidden="true" {...p}>
      {/* mast + sail */}
      <rect x="117" y="8" width="5" height="92" />
      <path d="M70 22 Q120 14 170 22 L164 80 Q120 72 76 80 Z" opacity=".95" />
      <path d="M84 34 Q120 28 156 34 M82 50 Q120 44 158 50 M80 66 Q120 60 160 66" stroke="var(--sea-deep)" strokeWidth="2" fill="none" opacity=".5" />
      <circle cx="120" cy="47" r="9" fill="var(--sea-deep)" opacity=".55" />
      {/* hull with curled stern and ram prow */}
      <path d="M18 96 Q30 92 40 100 L196 100 Q212 98 226 88 L232 92 Q222 108 204 116 L52 116 Q30 114 18 96 Z" />
      <path d="M18 96 Q8 80 22 70 Q30 66 32 74 Q24 78 28 88 Z" />
      <path d="M226 88 L238 104 L222 106 Z" />
      {/* oars */}
      {[60, 80, 100, 120, 140, 160, 180].map((x) => (
        <rect key={x} x={x} y="112" width="3" height="20" transform={`rotate(18 ${x} 112)`} />
      ))}
      {/* painted eye on the prow */}
      <circle cx="205" cy="106" r="3.5" fill="var(--gold)" />
    </svg>
  )
}

export function Owl({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" {...p}>
      <path d="M14 14 L22 20 Q32 16 42 20 L50 14 L50 38 Q50 56 32 58 Q14 56 14 38 Z" />
      <circle cx="24" cy="30" r="7" fill="var(--sea-deep)" />
      <circle cx="40" cy="30" r="7" fill="var(--sea-deep)" />
      <circle cx="24" cy="30" r="3" />
      <circle cx="40" cy="30" r="3" />
      <path d="M32 34 L29 40 L35 40 Z" fill="var(--sea-deep)" />
      <path d="M20 46 Q32 52 44 46" stroke="var(--sea-deep)" strokeWidth="2" fill="none" />
    </svg>
  )
}

export function Lyre({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true" {...p}>
      <path d="M18 8 Q8 20 16 34 Q20 44 22 52 L42 52 Q44 44 48 34 Q56 20 46 8" />
      <path d="M17 16 L47 16" />
      <path d="M26 16 L26 52 M32 16 L32 52 M38 16 L38 52" strokeWidth="2" />
      <path d="M20 56 L44 56" />
    </svg>
  )
}

export function Helmet({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" {...p}>
      <path d="M10 18 Q32 -4 54 18 Q50 10 32 8 Q14 10 10 18 Z" />
      <path d="M14 22 Q32 6 50 22 L50 46 L42 56 L38 56 L38 36 Q32 32 26 36 L26 56 L22 56 L14 46 Z" />
      <path d="M26 30 L38 30 L36 34 L28 34 Z" fill="var(--sea-deep)" />
    </svg>
  )
}

export function Rose({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" {...p}>
      <path d="M32 34 Q16 32 18 18 Q26 22 32 14 Q38 22 46 18 Q48 32 32 34 Z" />
      <path d="M32 24 Q26 26 28 30 Q32 32 36 29 Q38 25 32 24 Z" fill="var(--sea-deep)" opacity=".5" />
      <rect x="30.5" y="33" width="3" height="26" />
      <path d="M33 44 Q44 38 48 44 Q42 50 33 46 Z" />
      <path d="M31 50 Q20 44 16 50 Q22 56 31 52 Z" />
    </svg>
  )
}

export function Bolt({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" {...p}>
      <path d="M36 2 L14 36 L28 36 L22 62 L50 24 L34 24 Z" />
    </svg>
  )
}

export function Trident({ className = '', ...p }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true" {...p}>
      <path d="M32 6 L32 60" />
      <path d="M14 8 L14 22 Q14 30 32 30 Q50 30 50 22 L50 8" />
      <path d="M10 12 L14 6 L18 12 M28 10 L32 4 L36 10 M46 12 L50 6 L54 12" strokeWidth="3" />
    </svg>
  )
}

export function Laurel({ className = '', ...p }) {
  const leaves = Array.from({ length: 9 }, (_, i) => i)
  const branch = (flip) => (
    <g transform={flip ? 'translate(200 0) scale(-1 1)' : undefined}>
      <path d="M100 186 Q30 170 22 96 Q24 50 56 22" stroke="currentColor" strokeWidth="3" fill="none" />
      {leaves.map((i) => {
        const t = i / 8
        const a = Math.PI * (0.55 + 0.75 * t)
        const r = 82
        const x = 100 + Math.cos(a) * r * 0.95
        const y = 104 + Math.sin(a) * r
        const rot = (a * 180) / Math.PI + 90
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${rot})`}>
            <path d="M0 0 Q-9 -10 0 -24 Q9 -10 0 0 Z" fill="currentColor" />
            <path d="M0 0 Q12 -4 20 -16 Q8 -16 0 0 Z" fill="currentColor" opacity=".8" />
          </g>
        )
      })}
    </g>
  )
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" {...p}>
      {branch(false)}
      {branch(true)}
    </svg>
  )
}

export function Meander({ className = '' }) {
  return <div className={`meander ${className}`} aria-hidden="true" />
}

export const GOD_ART = { athena: Owl, apollo: Lyre, ares: Helmet, aphrodite: Rose, zeus: Bolt }
