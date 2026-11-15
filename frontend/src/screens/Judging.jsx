import { useEffect, useState } from 'react'
import { Bolt, Helmet, Lyre, Owl, Rose } from '../ui/Art.jsx'
import '../theme/judging.css'

const COUNCIL = [
  { Art: Owl, name: 'Athena', msg: 'Athena is checking your words against the sacred scroll…' },
  { Art: Lyre, name: 'Apollo', msg: 'Apollo is tuning his lyre to your voice…' },
  { Art: Helmet, name: 'Ares', msg: 'Ares is replaying your every move…' },
  { Art: Rose, name: 'Aphrodite', msg: 'Aphrodite is reading your faces…' },
]
const ZEUS_MSG = 'Zeus gathers the clouds and weighs your glory…'

function Cloud({ className }) {
  return (
    <svg className={className} viewBox="0 0 300 120" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="60" cy="78" r="36" /><circle cx="110" cy="56" r="46" /><circle cx="170" cy="62" r="42" />
        <circle cx="222" cy="80" r="32" /><circle cx="262" cy="92" r="22" /><rect x="40" y="80" width="240" height="40" rx="20" />
      </g>
    </svg>
  )
}

export default function Judging() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, COUNCIL.length)), 1600)
    return () => clearInterval(t)
  }, [])
  const zeus = i >= COUNCIL.length
  // clouds part a little more as each god finishes
  const part = zeus ? 'oj-part-3' : i >= 3 ? 'oj-part-2' : i >= 1 ? 'oj-part-1' : ''

  return (
    <div className={`panel center oj ${part} ${zeus ? 'oj-zeus' : ''}`} role="status" aria-live="polite">
      <div className="oj-sky" aria-hidden="true">
        <div className="oj-radiance" />
        <Cloud className="oj-cloud oj-cloud-l" />
        <Cloud className="oj-cloud oj-cloud-r" />
        <Bolt className="oj-bolt" />
        <div className="oj-flash" />
      </div>

      <p className="eyebrow">Mount Olympus</p>
      <h2 className="oj-title">The gods deliberate</h2>

      <ol className="oj-council">
        {COUNCIL.map(({ Art, name }, k) => (
          <li key={name} className={`oj-god ${k < i ? 'done' : ''} ${k === i ? 'now' : ''}`}>
            <div className="oj-disc"><Art className="oj-art" /></div>
            <span className="oj-name">{name}</span>
            <span className="oj-state">{k < i ? 'has judged' : k === i ? 'judging…' : 'awaits'}</span>
          </li>
        ))}
      </ol>

      <p className="oj-msg" key={i}>{zeus ? ZEUS_MSG : COUNCIL[i].msg}</p>
    </div>
  )
}
