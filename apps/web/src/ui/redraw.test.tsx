import { describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Asking React to draw again after changing something it does not own.
 *
 * The world is held in a ref and mutated in place, so dragging a channel
 * writes the new order straight into it and asks the server afterwards - the
 * list moves under the hand instead of two round trips later. The way it said
 * "draw again" was to set an unrelated piece of state to the value it already
 * had.
 *
 * React drops that. Setting state to what it already is is not a change, so
 * nothing re-rendered, and the reorder was correct and invisible until
 * something else happened to cause a render. Reported as channels not moving
 * when you drag them.
 *
 * Nine places did it. This is the reason they were all wrong, kept as a test
 * so the next one is not written the same way.
 */
describe('asking for another render', () => {
  it('does nothing when the state is set to what it already was', async () => {
    let draws = 0
    let bumpSame: () => void = () => {}

    function Probe() {
      const [, setSame] = useState<'a' | null>(null)
      bumpSame = () => setSame((x) => x)
      draws += 1
      return null
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<Probe />) })

    const before = draws
    await act(async () => { bumpSame() })
    expect(draws, 'React re-rendered for a state change that was not one')
      .toBe(before)

    await act(async () => { root.unmount() })
  })

  it('and happens when the value actually moves', async () => {
    /* Which is what a counter does, and why the world publishes one. */
    let draws = 0
    let bump: () => void = () => {}

    function Probe() {
      const [, setN] = useState(0)
      bump = () => setN((n) => n + 1)
      draws += 1
      return null
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<Probe />) })

    const before = draws
    await act(async () => { bump() })
    expect(draws).toBeGreaterThan(before)

    await act(async () => { root.unmount() })
  })
})
