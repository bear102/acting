import { Ship } from './Art.jsx'
import { ActIcon, JudgedIcon, WatchIcon } from '../landing/StepIcons.jsx'
import { HelmetIcon } from '../screens/setup/icons.jsx'
import '../theme/journey.css'

// The whole game in one strip: pick a trial, name the crew, watch, act, be judged. It says where
// you are and what comes next, so no screen has to explain the flow in words. The last three
// steps reuse the home page's Watch / Act / Be judged icons.
const STEPS = [
  { id: 'scenes', label: 'Trial', Icon: Ship },
  { id: 'team', label: 'Crew', Icon: HelmetIcon },
  { id: 'rehearse', label: 'Watch', Icon: WatchIcon },
  { id: 'stage', label: 'Act', Icon: ActIcon },
  { id: 'verdict', label: 'Be judged', Icon: JudgedIcon },
]

/** at: id of the current step. onGo(id): jump back to a finished step (omit to make it read-only). */
export default function Journey({ at, onGo }) {
  const now = STEPS.findIndex((s) => s.id === at)
  if (now < 0) return null
  return (
    <nav className="jy" aria-label="Your voyage">
      <ol>
        {STEPS.map(({ id, label, Icon }, i) => {
          const state = i < now ? 'done' : i === now ? 'now' : 'next'
          const inner = <><Icon className="jy-ico" /><span className="jy-label">{label}</span></>
          return (
            <li key={id} className={state} aria-current={state === 'now' ? 'step' : undefined}>
              {state === 'done' && onGo
                ? <button className="jy-step" onClick={() => onGo(id)}>{inner}</button>
                : <span className="jy-step">{inner}</span>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
