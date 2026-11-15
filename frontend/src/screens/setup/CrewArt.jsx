// Art for the crew screen. Black-figure style: the shape is painted in currentColor and the
// features are "scratched through" to the clay behind it (the --cs-cut colour).

const CUT = 'var(--cs-cut, #c8693c)'

/** Theatre mask, comedy or tragedy, painted on a clay medallion. */
export function StageMask({ tragic = false, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      {/* curls + face */}
      {[14, 21, 28.5, 36, 43.5, 50].map((x, i) => (
        <circle key={x} cx={x} cy={i === 0 || i === 5 ? 11.5 : 8.5} r="4.6" fill="currentColor" />
      ))}
      <path d="M11 12 Q32 5 53 12 Q57 35 45.5 50 Q32 62 18.5 50 Q7 35 11 12 Z" fill="currentColor" />
      <path d="M14 16.5 Q32 11 50 16.5" stroke={CUT} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {tragic ? (
        <g fill={CUT}>
          <path d="M17 30 Q21 23 29 25.5 Q25 31 17 30 Z" />
          <path d="M47 30 Q43 23 35 25.5 Q39 31 47 30 Z" />
          <path d="M21 51 Q24 38 32 38 Q40 38 43 51 Q32 45 21 51 Z" />
        </g>
      ) : (
        <g fill={CUT}>
          <path d="M16.5 28.5 Q23 19 29.5 28.5 Q23 24.5 16.5 28.5 Z" />
          <path d="M34.5 28.5 Q41 19 47.5 28.5 Q41 24.5 34.5 28.5 Z" />
          <path d="M19.5 37 Q32 42.5 44.5 37 Q41 52 32 52 Q23 52 19.5 37 Z" />
        </g>
      )}
      <path d="M32 27 L29.5 34.5 H34.5" stroke={CUT} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The laptop's camera, seen from the stage. */
export function CameraGlyph({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 48 30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <rect x="9" y="2" width="30" height="20" rx="3" />
      <circle cx="24" cy="12" r="4.6" />
      <circle cx="24" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3 27 H45" />
    </svg>
  )
}

export function DiceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
      {[[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />)}
    </svg>
  )
}

export function Chevron({ dir = 1 }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir < 0 ? 'M10 3 L5 8 L10 13' : 'M6 3 L11 8 L6 13'} />
    </svg>
  )
}
