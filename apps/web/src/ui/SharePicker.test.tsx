import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharePicker } from './SharePicker'
import type { ShareSource } from '../lib/shell'

/**
 * The answer the desktop is waiting for.
 *
 * Electron holds getDisplayMedia open until the page says which source to
 * use. Nothing said anything, so screen sharing did nothing at all in the
 * desktop app while working perfectly in a browser, which draws its own.
 *
 * The thing that must never happen is this box closing without an answer:
 * that leaves the request pending for the life of the app, and every later
 * press of share is then a button that does nothing.
 */

const sources: ShareSource[] = [
  { id: 'screen:0', name: 'Screen 1', isScreen: true, thumbnail: 'data:,x', icon: null },
  { id: 'window:42', name: 'Notepad', isScreen: false, thumbnail: null, icon: null },
]

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
  delete (globalThis as { atrium?: unknown }).atrium
})

/** A desktop shell that asks, and remembers what it was told. */
function withShell(canChooseShareAudio = true) {
  let ask: ((list: ShareSource[]) => void) | null = null
  const choose = vi.fn()
  ;(globalThis as { atrium?: unknown }).atrium = {
    setBadge: () => {},
    share: {
      onChoose: (cb: (l: ShareSource[]) => void) => { ask = cb },
      choose,
      ...(canChooseShareAudio ? { canChooseShareAudio: true } : {}),
    },
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root?.render(<SharePicker />) })
  return { ask: (l: ShareSource[]) => act(() => ask?.(l)), choose }
}

const find = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))

describe('choosing what to share', () => {
  it('draws nothing until the desktop asks', () => {
    withShell()
    expect(document.querySelector('.modal')).toBe(null)
  })

  it('and nothing at all in a browser', () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    /* No window.atrium, which is every web visitor. */
    act(() => { root?.render(<SharePicker />) })
    expect(document.querySelector('.modal')).toBe(null)
  })

  it('offers every source once asked', () => {
    const { ask } = withShell()
    ask(sources)
    expect(document.querySelector('.modal')).toBeTruthy()
    expect(document.body.textContent).toContain('Screen 1')
    expect(document.body.textContent).toContain('Notepad')
  })

  it('answers with what was picked', () => {
    const { ask, choose } = withShell()
    ask(sources)
    act(() => { find('Notepad')?.click() })
    act(() => { find('Share')?.click() })
    expect(choose).toHaveBeenCalledWith('window:42', true)
  })

  /* The one that matters. Cancelling must still answer, or the request is
     never resolved and share is dead for the rest of the session. */
  it('and answers on cancel too, rather than leaving it waiting', () => {
    const { ask, choose } = withShell()
    ask(sources)
    act(() => { find('Cancel')?.click() })
    expect(choose).toHaveBeenCalledWith(null, true)
  })

  it('and closes itself once answered', () => {
    const { ask } = withShell()
    ask(sources)
    act(() => { find('Cancel')?.click() })
    expect(document.querySelector('.modal')).toBe(null)
  })
})

/**
 * Whether the sound goes with it.
 *
 * On by default, because sharing something that makes a noise almost always
 * means sharing the noise. Offered only where the shell can act on it: an
 * older desktop build always sends the sound and cannot be told otherwise, so
 * a switch there would be a preference that is silently ignored.
 */
describe('sharing the sound', () => {
  const sound = () =>
    document.querySelector('[aria-label="Share the sound too"]') as HTMLElement | null

  it('is offered, and on', () => {
    const { ask } = withShell()
    ask(sources)
    expect(sound()?.getAttribute('aria-checked')).toBe('true')
  })

  it('and turning it off is what gets sent', () => {
    const { ask, choose } = withShell()
    ask(sources)
    act(() => { sound()?.click() })
    act(() => { find('Share')?.click() })
    expect(choose).toHaveBeenCalledWith('screen:0', false)
  })

  /* An older desktop cannot be told, so it is not asked. */
  it('but is not offered by a shell that cannot act on it', () => {
    const { ask } = withShell(false)
    ask(sources)
    expect(document.querySelector('.modal')).toBeTruthy()
    expect(sound()).toBe(null)
  })
})
