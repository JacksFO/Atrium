import { useEffect, useRef, type ReactNode } from 'react'
import { Over } from './Over'

/**
 * A box in the middle, over a sheet that dims what is behind it.
 *
 * The scrim is a sibling rather than a wrapper, and the box sits above it —
 * a modal drawn *inside* whatever opened it inherits that thing's stacking
 * context, and then a dialog opened from a panel appears underneath the panel
 * it came from.
 *
 * Escape closes it and the first field takes focus, because a box that
 * appears where the keyboard is not is one somebody has to reach for a mouse
 * to answer.
 */
export function Modal({ title, children, actions, onClose }: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, textarea, select')?.focus()
  }, [])

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [onClose])

  return (
    <Over>
      <div className="scrim" onClick={onClose} />
      <div className="modal" ref={box} role="dialog" aria-label={title}>
        <div className="mhd"><span className="t">{title}</span></div>
        <div className="mbd">{children}</div>
        <div className="mft">{actions}</div>
      </div>
    </Over>
  )
}
