// Small Greek-style glyphs for the setup screens. All use currentColor so CSS sets the tint.

export function HelmetIcon({ className = '' }) {
  // Corinthian helmet in profile: "players"
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 13 Q5 4 13 4 Q20 4 20 12 L20 19 L15 19 L15 14 L12 14 L12 19 L7 19 Q5 17 5 13 Z" />
      <path d="M8 3 Q13 0 19 3 L18 5 Q13 2.5 9 5 Z" opacity=".75" />
    </svg>
  )
}

export function HourglassIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" aria-hidden="true">
      <path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9" />
    </svg>
  )
}

export function LeafIcon({ className = '', filled = true }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 Q20 9 12 22 Q4 9 12 2 Z" fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6 L12 19" stroke={filled ? 'var(--sea-deep, #070b17)' : 'currentColor'} strokeWidth="1" opacity=".6" />
    </svg>
  )
}

const LEVELS = { easy: 1, medium: 2, hard: 3 }

/** Difficulty as 1-3 laurel leaves. */
export function Difficulty({ level = 'Medium', className = '' }) {
  const n = LEVELS[String(level).toLowerCase()] || 2
  return (
    <span className={`ss-diff ss-diff-${String(level).toLowerCase()} ${className}`} title={`${level} trial`}>
      {[1, 2, 3].map((i) => <LeafIcon key={i} className="ss-leaf" filled={i <= n} />)}
      <span className="ss-diff-label">{level}</span>
    </span>
  )
}

/** Round hoplite shield with a lambda-ish emblem; colour via `color` prop. */
export function ShieldArt({ color, className = '', children }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id={`ss-bowl-${color?.slice(1)}`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#fff" stopOpacity=".28" />
          <stop offset=".45" stopColor={color} stopOpacity=".95" />
          <stop offset="1" stopColor="#000" stopOpacity=".55" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="57" fill="var(--bronze, #b5793b)" />
      <circle cx="60" cy="60" r="57" fill="none" stroke="var(--gold-soft, #f3d58c)" strokeWidth="2" opacity=".7" />
      <circle cx="60" cy="60" r="48" fill={`url(#ss-bowl-${color?.slice(1)})`} />
      {/* rim studs */}
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2
        return <circle key={i} cx={60 + Math.cos(a) * 52.5} cy={60 + Math.sin(a) * 52.5} r="1.8" fill="var(--gold-soft, #f3d58c)" opacity=".85" />
      })}
      {children}
    </svg>
  )
}

/** Theatre mask: comedy (smile) or tragedy (frown) depending on index. */
export function MaskArt({ tragic = false, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 10 Q32 2 54 10 Q58 36 44 52 Q32 62 20 52 Q6 36 10 10 Z" fill="currentColor" />
      <path d={tragic ? 'M18 27 Q23 22 28 27' : 'M18 25 Q23 30 28 25'} stroke="var(--sea-deep, #070b17)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d={tragic ? 'M36 27 Q41 22 46 27' : 'M36 25 Q41 30 46 25'} stroke="var(--sea-deep, #070b17)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d={tragic ? 'M22 46 Q32 36 42 46' : 'M22 40 Q32 50 42 40'} stroke="var(--sea-deep, #070b17)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M14 14 Q32 8 50 14" stroke="#fff" strokeOpacity=".25" strokeWidth="2" fill="none" />
    </svg>
  )
}

/** Small brazier flame used for the "hearth" heading. */
export function Flame({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 32 40" aria-hidden="true">
      <path d="M16 2 Q24 14 20 20 Q26 18 25 10 Q32 22 26 30 Q22 36 16 36 Q8 36 6 28 Q4 20 12 14 Q11 20 14 22 Q10 12 16 2 Z" fill="var(--terracotta, #d0613a)" />
      <path d="M16 14 Q21 22 18 27 Q22 26 22 22 Q25 30 20 33 Q16 35 12 32 Q9 28 13 22 Q13 26 15 27 Q13 20 16 14 Z" fill="var(--gold, #e8b84a)" />
      <rect x="6" y="36" width="20" height="3" rx="1" fill="var(--bronze, #b5793b)" />
    </svg>
  )
}
