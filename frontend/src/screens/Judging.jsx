import { useEffect, useState } from 'react'
import { Bolt, Helmet, Lyre, Owl, Rose } from '../ui/Art.jsx'

const MESSAGES = [
  'Athena is checking your words against the sacred scroll…',
  'Apollo is tuning his lyre to your voice…',
  'Ares is replaying your every move…',
  'Aphrodite is reading your faces…',
  'Zeus is gathering the clouds…',
]
const ORBIT = [Owl, Lyre, Helmet, Rose]

export default function Judging() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, MESSAGES.length - 1)), 1600)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel center judging">
      <div className="flash" aria-hidden="true" />
      <div className="olympus" aria-hidden="true">
        <div className="orbit">
          {ORBIT.map((Art, k) => (
            <div key={k} className={`orbiter ${k <= i ? 'lit' : ''}`} style={{ '--k': k }}>
              <Art className="orbiter-art" />
            </div>
          ))}
        </div>
        <Bolt className="zeus-bolt" />
      </div>
      <p className="eyebrow">Mount Olympus</p>
      <h2>The gods deliberate</h2>
      <p className="muted deliberation" key={i}>{MESSAGES[i]}</p>
    </div>
  )
}
