import { useEffect, useRef } from 'react'
import { columnOf, columnsFor, PANELS, type Panel } from '../lib/panelOrder'

/**
 * Put the columns where somebody arranged them.
 *
 * Written to the document as custom properties, for the same reason the
 * widths are: the panels are drawn by four different components, in three
 * different files, and two of them can be the member column depending on
 * whether you are in a server or a conversation. Passing an order down to all
 * of that is four props threaded through everything in between, and one of
 * them would be forgotten.
 *
 * The stylesheet reads them. Nothing else has to know.
 *
 * On the document rather than on the shell because the shell is not the only
 * thing that has to agree about which side the member list is on - the phone
 * layout's drawers and the resize grips read the same values.
 */
export function usePanelOrder(
  order: readonly Panel[], hidden: readonly Panel[] = [],
): void {
  /* What was last written, so nothing is written twice: setting a property to
     the value it already has still invalidates style for the whole subtree. */
  const at = useRef<Record<string, string>>({})

  useEffect(() => {
    const put = (prop: string, value: string) => {
      if (at.current[prop] === value) return
      at.current[prop] = value
      document.documentElement.style.setProperty(prop, value)
    }

    put('--panelcols', columnsFor(order, hidden))
    for (const panel of PANELS) put(`--col-${panel}`, String(columnOf(order, panel, hidden)))
    /* So a stylesheet - and a test - can ask what the arrangement is without
       reassembling it from four numbers. */
    document.documentElement.dataset.panels = order.join(' ')
  /* The list of folded panels is rebuilt each render, so it is compared by
     what is in it rather than by being the same array. The rule cannot check
     an expression like that and warns about both halves of it; said here so
     the warning does not sit in every run for ever, which is how a real one
     goes unnoticed. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, hidden.join(' ')])
}
