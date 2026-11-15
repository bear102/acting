import { createPortal } from 'react-dom'

// Full-screen painted backdrop rendered into <body> (not inside the animated panel, whose
// transform would break position: fixed). Static image + gradient veil; no animation.
export default function PageBackdrop({ variant }) {
  return createPortal(<div className={`page-bd page-bd-${variant}`} aria-hidden="true" />, document.body)
}
