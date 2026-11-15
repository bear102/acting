// Architectural ornaments in gold line art: pediment, Ionic column, wave-sea.
// Colors come from CSS (currentColor = gold line, --sea-deep fills).

export function Pediment({ className = '' }) {
  const dentils = Array.from({ length: 30 }, (_, i) => i)
  return (
    <svg className={className} viewBox="0 0 600 120" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      {/* acroteria */}
      <path d="M300 4 Q292 14 300 24 Q308 14 300 4 Z" fill="currentColor" />
      <path d="M16 88 Q10 76 20 70 Q22 80 30 84 Z" fill="currentColor" opacity=".8" />
      <path d="M584 88 Q590 76 580 70 Q578 80 570 84 Z" fill="currentColor" opacity=".8" />
      {/* raking cornice + tympanum */}
      <path d="M14 92 L300 22 L586 92 Z" fill="rgba(7,11,23,.55)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M44 88 L300 34 L556 88" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      {/* tympanum relief: a ship's prow eye and waves */}
      <g fill="none" stroke="currentColor" strokeWidth="1.6" opacity=".75" strokeLinecap="round">
        <path d="M200 78 Q215 70 230 78 T260 78 T290 78 T320 78 T350 78 T380 78 T410 78" />
        <circle cx="300" cy="58" r="9" />
        <circle cx="300" cy="58" r="3" fill="currentColor" />
        <path d="M282 58 Q300 44 318 58 Q300 72 282 58" />
      </g>
      {/* horizontal cornice + dentils */}
      <rect x="8" y="92" width="584" height="7" fill="currentColor" />
      {dentils.map((i) => (
        <rect key={i} x={14 + i * 19.4} y="103" width="11" height="9" fill="currentColor" opacity=".85" />
      ))}
      <rect x="8" y="114" width="584" height="3" fill="currentColor" opacity=".7" />
    </svg>
  )
}

export function IonicColumn({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 60 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* capital with two volutes */}
      <path d="M4 12 H56" stroke="currentColor" strokeWidth="4" />
      <path d="M8 18 Q30 26 52 18" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="10" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="10" cy="24" r="2.5" fill="currentColor" />
      <circle cx="50" cy="24" r="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="24" r="2.5" fill="currentColor" />
      {/* fluted shaft, slight entasis */}
      <path d="M14 34 Q12 160 16 280 H44 Q48 160 46 34 Z" fill="rgba(244,236,220,.05)" stroke="currentColor" strokeWidth="2" />
      {[21, 27, 33, 39].map((x) => (
        <path key={x} d={`M${x} 40 Q${x - 1} 160 ${x} 274`} stroke="currentColor" strokeWidth="1" opacity=".5" fill="none" />
      ))}
      {/* base */}
      <rect x="10" y="280" width="40" height="6" rx="2" fill="currentColor" />
      <rect x="6" y="288" width="48" height="8" rx="2" fill="currentColor" opacity=".85" />
    </svg>
  )
}

export function Rosette({ className = '' }) {
  const petals = Array.from({ length: 8 }, (_, i) => i * 45)
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      {petals.map((a) => (
        <path key={a} d="M20 20 Q16 10 20 4 Q24 10 20 20 Z" fill="currentColor" transform={`rotate(${a} 20 20)`} opacity=".9" />
      ))}
      <circle cx="20" cy="20" r="4" fill="var(--sea-deep)" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

// Layered wine-dark waves with a sailing ship (pass the ship as children).
export function SeaVoyage({ children }) {
  // 28 alternating half-waves across 1400 units; the strip is 2x wide and slides by half for a seamless loop
  const wave = (y, amp) =>
    `M0 ${y} ` + Array.from({ length: 28 }, (_, i) => `Q${i * 50 + 25} ${y + (i % 2 ? amp : -amp)} ${i * 50 + 50} ${y}`).join(' ') + ' V140 H0 Z'
  return (
    <div className="oh-sea" aria-hidden="true">
      <svg className="oh-wave oh-wave-back" viewBox="0 0 1400 140" preserveAspectRatio="none"><path d={wave(70, 14)} /></svg>
      <div className="oh-sail">{children}</div>
      <svg className="oh-wave oh-wave-mid" viewBox="0 0 1400 140" preserveAspectRatio="none"><path d={wave(92, 12)} /></svg>
      <svg className="oh-wave oh-wave-front" viewBox="0 0 1400 140" preserveAspectRatio="none"><path d={wave(112, 10)} /></svg>
    </div>
  )
}
