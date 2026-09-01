import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSwipe } from './useSwipe'
import type { SwipeOutcome } from '../lib/swipe'

/**
 * The gesture, made rather than described.
 *
 * swipe.ts already decides what a swipe means and is tested on its own. What
 * this asks is the part that can only go wrong in a browser: that the
 * listener sees the gesture at all, that it ignores a mouse, and that it
 * keeps its hands off anything that scrolls sideways of its own accord.
 */

let root: Root | null = null

function Harness({ on, act: onAct }: { on: boolean; act: (w: SwipeOutcome) => void }) {
  useSwipe(on, { navOpen: false, membersOpen: false }, onAct)
  return <div id="page"><pre id="code">code</pre><div id="plain">plain</div></div>
}

const mount = (on: boolean, onAct: (w: SwipeOutcome) => void) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Harness on={on} act={onAct} />))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  document.body.innerHTML = ''
  root = null
})

/*
 * jsdom has no PointerEvent, and the listener reads three fields off one.
 * clientX and clientY are getters on MouseEvent and cannot be assigned, so
 * they are passed to the constructor and only pointerType is added.
 */
const pointer = (
  type: string,
  { clientX = 0, clientY = 0, pointerType = 'touch' }: {
    clientX?: number; clientY?: number; pointerType?: string
  },
) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  return e
}

const swipe = (target: Element, from: number, to: number, y = 0) => {
  act(() => {
    target.dispatchEvent(pointer('pointerdown', { clientX: from, clientY: 0 }))
    window.dispatchEvent(pointer('pointerup', { clientX: to, clientY: y }))
  })
}

describe('a swipe on a phone', () => {
  it('opens the channels when it goes right', () => {
    const seen = vi.fn()
    mount(true, seen)
    swipe(document.getElementById('plain')!, 20, 200)
    expect(seen).toHaveBeenCalledWith('open-nav')
  })

  it('and the members when it goes left', () => {
    const seen = vi.fn()
    mount(true, seen)
    swipe(document.getElementById('plain')!, 200, 20)
    expect(seen).toHaveBeenCalledWith('open-members')
  })

  /* Getting this wrong makes a conversation unreadable: every drag down would
     open a drawer. */
  it('but not when it was mostly downwards', () => {
    const seen = vi.fn()
    mount(true, seen)
    swipe(document.getElementById('plain')!, 20, 200, 400)
    expect(seen).not.toHaveBeenCalled()
  })

  /*
   * Not from inside something that scrolls sideways of its own accord. A
   * swipe across the emoji rows or a code block is that thing being scrolled,
   * and hijacking it makes it unusable.
   */
  it('and never from inside something that scrolls sideways', () => {
    const seen = vi.fn()
    mount(true, seen)
    swipe(document.getElementById('code')!, 20, 200)
    expect(seen).not.toHaveBeenCalled()
  })

  it('and never from a mouse, which has a scrollbar and a window edge', () => {
    const seen = vi.fn()
    mount(true, seen)
    act(() => {
      document.getElementById('plain')!
        .dispatchEvent(pointer('pointerdown', { clientX: 20, clientY: 0, pointerType: 'mouse' }))
      window.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 0 }))
    })
    expect(seen).not.toHaveBeenCalled()
  })

  /* Off on anything wider, where both panels are simply there. */
  it('and not at all on a window wide enough to show both panels', () => {
    const seen = vi.fn()
    mount(false, seen)
    swipe(document.getElementById('plain')!, 20, 200)
    expect(seen).not.toHaveBeenCalled()
  })
})
