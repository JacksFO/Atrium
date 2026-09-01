import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WindowButtons } from './WindowButtons'

/**
 * The buttons the app draws instead of Windows'.
 *
 * The case worth guarding is not what they look like: it is who draws them.
 * A shell that still hands them to Windows must get none from us, or
 * somebody has two sets of buttons on their window until they update.
 */

type Bridge = Record<string, unknown>
const w = globalThis as unknown as { atrium?: Bridge }

/** Enough of the bridge for shell() to believe it, plus whatever is asked. */
function bridge(over: Bridge = {}): Bridge {
  return {
    setBadge: () => {},
    minimise: vi.fn(),
    toggleMaximise: vi.fn(),
    close: vi.fn(),
    ...over,
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(it: Bridge | undefined): HTMLDivElement {
  if (it) w.atrium = it
  else delete w.atrium
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(<WindowButtons />) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete w.atrium
})

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')]

describe('who draws the window buttons', () => {
  it('draws none in a browser, where there is no window to button', () => {
    expect(buttons(draw(undefined))).toHaveLength(0)
  })

  it('draws none in a shell that still has the Windows ones', () => {
    /* An older shell: it has the bridge, and no windowButtons at all. */
    expect(buttons(draw(bridge()))).toHaveLength(0)
  })

  it('draws three where the shell has handed them over', () => {
    const el = draw(bridge({ windowButtons: true }))
    expect(buttons(el).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Minimise', 'Maximise', 'Close'])
  })
})

describe('pressing them', () => {
  it('asks the shell, each for its own thing', () => {
    const it = bridge({ windowButtons: true })
    const el = draw(it)
    for (const b of buttons(el)) act(() => { b.click() })
    expect(it.minimise).toHaveBeenCalledOnce()
    expect(it.toggleMaximise).toHaveBeenCalledOnce()
    expect(it.close).toHaveBeenCalledOnce()
  })
})

describe('the middle one', () => {
  it('offers to restore a window that is already maximised', async () => {
    const el = draw(bridge({
      windowButtons: true,
      isMaximised: () => Promise.resolve(true),
    }))
    await act(async () => { await Promise.resolve() })
    expect(buttons(el)[1]!.getAttribute('aria-label')).toBe('Restore')
  })

  it('follows the window, which is maximised by more than this button', async () => {
    /* Win+Up, a double-click on the bar, a drag to the top edge. */
    let tell: ((max: boolean) => void) | null = null
    const el = draw(bridge({
      windowButtons: true,
      isMaximised: () => Promise.resolve(false),
      onMaximised: (cb: (max: boolean) => void) => { tell = cb },
    }))
    await act(async () => { await Promise.resolve() })
    expect(buttons(el)[1]!.getAttribute('aria-label')).toBe('Maximise')

    act(() => { tell!(true) })
    expect(buttons(el)[1]!.getAttribute('aria-label')).toBe('Restore')
  })

  it('and copes with a shell too old to say', async () => {
    /* No isMaximised, no onMaximised: it still has to draw something. */
    const el = draw(bridge({ windowButtons: true }))
    await act(async () => { await Promise.resolve() })
    expect(buttons(el)[1]!.getAttribute('aria-label')).toBe('Maximise')
  })
})
