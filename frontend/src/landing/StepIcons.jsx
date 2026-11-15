// Three tiny line icons for "Watch -> Act -> Judged" (currentColor).

export function WatchIcon(p) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M4 24 Q24 6 44 24 Q24 42 4 24 Z" />
      <circle cx="24" cy="24" r="7" />
      <circle cx="24" cy="24" r="2.5" fill="currentColor" />
    </svg>
  )
}

export function ActIcon(p) {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M8 8 Q24 3 40 8 Q42 30 24 42 Q6 30 8 8 Z" />
      <path d="M14 18 Q17 15 20 18 M28 18 Q31 15 34 18" />
      <path d="M16 28 Q24 35 32 28" />
    </svg>
  )
}

export function JudgedIcon(p) {
  return (
    <svg viewBox="0 0 48 48" fill="currentColor" aria-hidden="true" {...p}>
      <path d="M27 3 L10 27 H22 L18 45 L38 19 H26 Z" />
    </svg>
  )
}
