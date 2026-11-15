import { useEffect, useState } from 'react'
import { godArt } from '../ui/rankArt.js'
import '../theme/judging.css'

const COUNCIL = [
  { key: 'athena', name: 'Athena', msg: 'Athena is checking your words against the sacred scroll…' },
  { key: 'apollo', name: 'Apollo', msg: 'Apollo is tuning his lyre to your voice…' },
  { key: 'ares', name: 'Ares', msg: 'Ares is replaying your every move…' },
  { key: 'aphrodite', name: 'Aphrodite', msg: 'Aphrodite is reading your faces…' },
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

export default function Judging({ snaps = [] }) {
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
        <img className="oj-bolt oj-zeus-medal" src={godArt('zeus')} alt="" width="384" height="384" decoding="async" />
        <div className="oj-flash" />
      </div>

      <p className="eyebrow">Mount Olympus</p>
      <h2 className="oj-title">The gods deliberate</h2>

      <ol className="oj-council">
        {COUNCIL.map(({ key, name }, k) => (
          <li key={name} className={`oj-god ${k < i ? 'done' : ''} ${k === i ? 'now' : ''}`}>
            <div className="oj-disc">
              <img className="oj-medal" src={godArt(key)} alt="" width="384" height="384" decoding="async" />
            </div>
            <span className="oj-name">{name}</span>
          </li>
        ))}
      </ol>

      {snaps.length > 0 && (
        <div className="oj-stills" aria-hidden="true">
          {snaps.slice(0, 6).map((s, k) => (
            <img key={s.url} src={s.url} alt="" style={{ '--k': k, '--n': Math.min(snaps.length, 6) }} />
          ))}
        </div>
      )}

      <p className="oj-msg" key={i}>{zeus ? ZEUS_MSG : COUNCIL[i].msg}</p>
    </div>
  )
}
