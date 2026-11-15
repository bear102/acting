// Fixed, non-interactive scenery behind every screen: starfield, torch glow,
// drifting embers and three layers of wine-dark sea. Pure CSS animation.
const EMBERS = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 53) % 100,
  delay: (i * 1.7) % 11,
  dur: 9 + ((i * 7) % 8),
  size: 2 + (i % 3),
}))

function Wave({ className, d }) {
  return (
    <svg className={`wave ${className}`} viewBox="0 0 1440 120" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const W1 = 'M0 60 Q90 30 180 60 T360 60 T540 60 T720 60 T900 60 T1080 60 T1260 60 T1440 60 V120 H0 Z'
const W2 = 'M0 70 Q120 40 240 70 T480 70 T720 70 T960 70 T1200 70 T1440 70 V120 H0 Z'
const W3 = 'M0 80 Q60 64 120 80 T240 80 T360 80 T480 80 T600 80 T720 80 T840 80 T960 80 T1080 80 T1200 80 T1320 80 T1440 80 V120 H0 Z'

export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="stars" />
      <div className="torch torch-l" />
      <div className="torch torch-r" />
      <div className="embers">
        {EMBERS.map((e, i) => (
          <span key={i} style={{
            left: `${e.left}%`, animationDelay: `${e.delay}s`, animationDuration: `${e.dur}s`,
            width: e.size, height: e.size,
          }} />
        ))}
      </div>
      <div className="sea">
        <Wave className="w1" d={W1} />
        <Wave className="w2" d={W2} />
        <Wave className="w3" d={W3} />
      </div>
    </div>
  )
}
