import { useEffect, useState } from 'react'

const MESSAGES = [
  'Athena is checking your words against the sacred scroll…',
  'Apollo is tuning his lyre to your voice…',
  'Ares is replaying your every move…',
  'Aphrodite is reading your faces…',
  'Zeus is gathering the clouds…',
]

export default function Judging() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, MESSAGES.length - 1)), 1600)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel center judging">
      <div className="bolt">⚡</div>
      <h2>The gods deliberate</h2>
      <p className="muted">{MESSAGES[i]}</p>
    </div>
  )
}
