import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/**
 * Something drawn over the whole window rather than inside a panel.
 *
 * Menus, pickers and dialogs are placed from `clientX`/`clientY`, which are
 * measured from the corner of the *window*. Rendered where they were opened
 * from, `position:absolute` resolves against the nearest positioned ancestor
 * instead — the conversation pane — so everything landed shifted by however
 * far that pane is from the corner. A right-click in a channel opened its
 * menu a panel's width away from the pointer, and the emoji picker appeared
 * somewhere out in the middle of the window.
 *
 * A portal to the body puts them back against the window, where the numbers
 * they were given come from. It also fixes the other half of the same
 * problem: a menu inside a panel is clipped by that panel's overflow, and
 * inherits its stacking context — so a dialog opened from a side panel could
 * be drawn underneath the panel it came from.
 */
export function Over({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return <>{children}</>
  return createPortal(children, document.body)
}
