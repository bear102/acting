// Page-wide ornamental frame: a gold running-wave ("Vitruvian scroll") band that travels
// clockwise around the viewport, a Greek-key strip on its inner edge, and Ionic-volute
// corner pieces. Purely decorative: fixed, pointer-events:none, aria-hidden.
import './frame.css'

const GOLD = '#e8b84a'
const GOLD_SOFT = '#f3d58c'
const INK = '#070b17'

const svgUri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`

// One 24x16 tile of the running wave: two gold rules with a curling wave between them.
const WAVE_BODY = `
  <path d="M0 1.2H24M0 14.8H24" stroke="${GOLD}" stroke-width="1.1"/>
  <path d="M0 12.2 C5 12.2 7.2 4.6 12.4 4 C16.6 3.6 18.4 7.6 16.2 9.4 C14.6 10.6 12.6 9.4 13.2 7.8 C13.6 6.9 14.8 6.8 15.2 7.6"
        fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M12.4 4 C17.5 3.8 21 8.5 24 12.2" fill="none" stroke="${GOLD}" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`

const WAVE_H = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16">${WAVE_BODY}</svg>`)
// Same tile turned 90deg for the side bands (wave flows downward).
const WAVE_V = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="24" viewBox="0 0 16 24"><g transform="translate(16 0) rotate(90)">${WAVE_BODY}</g></svg>`)

// Greek key (meander) strip tile, 16x8.
const KEY_BODY = `<path d="M0 7.2H4V1H12V5H8V3.4" fill="none" stroke="${GOLD}" stroke-width="1" opacity=".8"/><path d="M8 7.2H16" stroke="${GOLD}" stroke-width="1" opacity=".8"/>`
const KEY_H = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8">${KEY_BODY}</svg>`)
const KEY_V = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="16" viewBox="0 0 8 16"><g transform="translate(8 0) rotate(90)">${KEY_BODY}</g></svg>`)

// Archimedean spiral for the Ionic volute.
function spiral(cx, cy, r0, r1, turns, dir = 1) {
  const pts = []
  const steps = 60 * turns
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const a = dir * f * turns * Math.PI * 2
    const r = r1 + (r0 - r1) * f
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`)
  }
  return `M${pts.join(' L')}`
}

function Volute() {
  return (
    <svg viewBox="0 0 64 64" className="of-volute">
      <rect x="1.5" y="1.5" width="61" height="61" rx="3" fill={INK} stroke={GOLD} strokeWidth="1.5" />
      <rect x="5" y="5" width="54" height="54" rx="2" fill="none" stroke={GOLD} strokeWidth=".7" opacity=".6" />
      {/* two volute scrolls joined by a curved echinus, like an Ionic capital seen corner-on */}
      <path d={spiral(22, 30, 2, 13, 2.2, 1)} fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      <path d={spiral(42, 30, 2, 13, 2.2, -1)} fill="none" stroke={GOLD} strokeWidth="2" strokeLinecap="round" />
      <path d="M10 18 Q32 8 54 18" fill="none" stroke={GOLD_SOFT} strokeWidth="2" strokeLinecap="round" />
      <circle cx="22" cy="30" r="2.2" fill={GOLD_SOFT} />
      <circle cx="42" cy="30" r="2.2" fill={GOLD_SOFT} />
      {/* small palmette below */}
      <g fill={GOLD} opacity=".9">
        <path d="M32 56 Q27 48 32 41 Q37 48 32 56 Z" />
        <path d="M32 56 Q22 52 24 44 Q30 48 32 56 Z" opacity=".75" />
        <path d="M32 56 Q42 52 40 44 Q34 48 32 56 Z" opacity=".75" />
      </g>
    </svg>
  )
}

export default function OdysseyFrame({ variant = 'full', children }) {
  return (
    <div className={`of-root of-${variant}`}>
      <div className="of-frame" aria-hidden="true">
        <div className="of-band of-top" style={{ '--wave': WAVE_H, '--key': KEY_H }} />
        <div className="of-band of-bottom" style={{ '--wave': WAVE_H, '--key': KEY_H }} />
        <div className="of-band of-left" style={{ '--wave': WAVE_V, '--key': KEY_V }} />
        <div className="of-band of-right" style={{ '--wave': WAVE_V, '--key': KEY_V }} />
        {['tl', 'tr', 'br', 'bl'].map((c) => (
          <div key={c} className={`of-corner of-${c}`}><Volute /></div>
        ))}
      </div>
      <div className="of-shell">{children}</div>
    </div>
  )
}
