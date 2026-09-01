import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

/**
 * Draw something into a real document and hand back what appeared.
 *
 * Most of these tests render to a string, which is enough for markup that
 * lands where it was written. It is not enough for anything drawn *over* the
 * window: menus, pickers and dialogs go through a portal to the body, and the
 * string renderer cannot follow one — it throws rather than returning
 * nothing, so a test that met one failed outright.
 *
 * Reading the whole body rather than the container, because the portal is the
 * point: what is being asked is what somebody would see, wherever React
 * decided to put it.
 */
export function drawn(el: ReactElement): string {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  const html = document.body.innerHTML
  act(() => root.unmount())
  host.remove()
  return html
}
