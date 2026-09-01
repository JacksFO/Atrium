import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import {
  isDefaultOrder, move, PANEL_NAMES, PANELS, place, type Panel,
} from '../lib/panelOrder'

/**
 * Arranging the columns, over the app rather than in a dialog.
 *
 * A picture of four rectangles in a settings pane is a diagram of the app,
 * and somebody moving boxes around in a diagram has to work out which box is
 * which. Doing it on the app itself removes the translation: the thing you
 * drag is the panel, in its place, at its size, with what is in it still
 * showing.
 *
 * So this draws nothing of its own except an outline round each column, a
 * name under it, and a bar saying what is going on. Everything visible
 * underneath is the app, still there.
 */
export function Arrange({ order, onChange, onDone, onReset }: {
  order: readonly Panel[]
  onChange: (next: Panel[]) => void
  onDone: () => void
  onReset: () => void
}) {
  /* Which one is being dragged, and which one the pointer is over. */
  const [held, setHeld] = useState<Panel | null>(null)
  const [over, setOver] = useState<Panel | null>(null)
  /* Which one the arrows and Escape act on. */
  const [picked, setPicked] = useState<Panel>(order[0] ?? 'servers')
  const bar = useRef<HTMLDivElement>(null)

  /*
   * Escape leaves, arrows move the one that is picked.
   *
   * On the window rather than on a focused element: the panels underneath are
   * the app, and every one of them has things in it that take a key. Somebody
   * pressing an arrow while arranging means the arrangement.
   */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDone(); return }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        onChange(move(order, picked, e.key === 'ArrowLeft' ? -1 : 1))
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const at = order.indexOf(picked)
        const next = order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length]
        if (next) setPicked(next)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [order, picked, onChange, onDone])

  /* The bar takes focus when it opens, so the keys work without a click. */
  useEffect(() => { bar.current?.focus() }, [])

  const drop = () => {
    if (held && over && held !== over) onChange(place(order, held, over))
    setHeld(null)
    setOver(null)
  }

  return (
    <div className="arrange" onPointerUp={drop} onPointerCancel={drop}>
      {/*
        * One outline per column, positioned by the same custom properties the
        * panels themselves are - so an outline cannot end up round the wrong
        * one, whatever the arrangement is.
        */}
      {PANELS.map((panel) => (
        <div
          key={panel}
          className="arrpane"
          data-panel={panel}
          data-held={held === panel ? '' : undefined}
          data-over={over === panel && held && held !== panel ? '' : undefined}
          data-picked={picked === panel ? '' : undefined}
          style={{ gridColumn: `var(--col-${panel})` }}
          onPointerEnter={() => { if (held) setOver(panel) }}
          /*
           * The whole column is the handle.
           *
           * It was a 26x18 grip at the bottom of each one, which is a small
           * target for the one gesture this screen exists for - and the
           * panel is right there, outlined, obviously the thing being moved.
           * Anywhere on it starts the drag.
           */
          onPointerDown={(e) => {
            /* Except the arrows, which are a different way to do the same
               thing and would otherwise begin a drag on the way to a click. */
            if ((e.target as HTMLElement).closest('.arrmove')) return
            e.preventDefault()
            setPicked(panel)
            setHeld(panel)
          }}
        >
          <div className="arrname">
            {/* The grip says the column can be dragged. It is no longer the
                only place you may take hold of it, so it is a mark rather
                than a control - the arrows below are the button version, and
                two controls doing one thing is one too many. */}
            <span className="arrgrip" aria-hidden="true">
              <Icon name="grip" size={14} />
            </span>
            <span className="arrlabel">{PANEL_NAMES[panel]}</span>
            {/* The same move, for anybody not dragging anything. */}
            <span className="arrmove">
              <button
                aria-label={`Move ${PANEL_NAMES[panel]} left`}
                data-way="left"
                disabled={order.indexOf(panel) === 0}
                onClick={() => { setPicked(panel); onChange(move(order, panel, -1)) }}
              >
                <Icon name="chev" size={13} />
              </button>
              <button
                aria-label={`Move ${PANEL_NAMES[panel]} right`}
                data-way="right"
                disabled={order.indexOf(panel) === order.length - 1}
                onClick={() => { setPicked(panel); onChange(move(order, panel, 1)) }}
              >
                <Icon name="chev" size={13} />
              </button>
            </span>
          </div>
        </div>
      ))}

      <div className="arrbar" ref={bar} tabIndex={-1}>
        <Icon name="boxes" size={15} />
        <b>Arranging your layout</b>
        <span className="arrhint">Drag a panel from anywhere on it, or use the arrows. Only you see this.</span>
        <button
          className="btn"
          disabled={isDefaultOrder(order)}
          onClick={onReset}
        >
          Reset
        </button>
        <button className="btn p" onClick={onDone}>Done</button>
      </div>
    </div>
  )
}
