import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TileMenu } from './TileMenu'
import { emptyCall, keyOf, type Call } from '../lib/call'
import { SHARE_PRESETS } from '../lib/sharequality'

/**
 * What a right-click on a screen offers.
 *
 * All three of these were in the original and none of them here: the quality
 * of your own share while it is running, a volume for somebody else's, and a
 * mute that is not the same thing as sliding to nought.
 */

const call = (over: Partial<Call> = {}): Call => ({
  ...emptyCall(),
  channel: 'c1',
  members: [
    { id: 'me', identity: 'me', name: 'Me', muted: false, sharing: true, cam: false },
    { id: 'pat', identity: 'pat', name: 'Pat', muted: false, sharing: true, cam: false },
  ],
  ...over,
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
})
function mount(ui: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root?.render(ui) })
  return document.body
}

const noop = () => {}

describe('your own screen', () => {
  it('can be re-encoded while it is being sent', () => {
    const onQuality = vi.fn()
    const el = mount(
      <TileMenu streamKey={keyOf('share', 'me')} call={call()} me="me" label="Me"
        master={100} onClose={noop} onVolume={noop} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} onQuality={onQuality} />,
    )
    const pick = el.querySelector('select') as HTMLSelectElement
    expect(pick).toBeTruthy()
    /* Named in the two numbers people think in — "Balanced" alone tells
       nobody whether their text will be readable. */
    expect(el.textContent).toMatch(/\d+p \d+/)

    act(() => {
      pick.value = 'high'
      pick.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onQuality).toHaveBeenCalledWith(expect.objectContaining({ id: 'high' }))
  })

  /* Nobody else's share is yours to re-encode. */
  it('but somebody else’s is not', () => {
    const el = mount(
      <TileMenu streamKey={keyOf('share', 'pat')} call={call()} me="me" label="Pat"
        master={100} onClose={noop} onVolume={noop} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} onQuality={vi.fn()} />,
    )
    expect(el.querySelector('select')).toBe(null)
  })
})

describe('somebody else’s screen, with sound in it', () => {
  const withSound = () => {
    const c = call()
    c.sounds.set(keyOf('share', 'pat'), {} as MediaStream)
    return c
  }

  it('has a volume of its own', () => {
    const onVolume = vi.fn()
    const el = mount(
      <TileMenu streamKey={keyOf('share', 'pat')} call={withSound()} me="me" label="Pat"
        master={100} onClose={noop} onVolume={onVolume} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />,
    )
    const slider = el.querySelector('input[type=range]') as HTMLInputElement
    expect(slider).toBeTruthy()
    /* Through the native setter and an `input` event: React's onChange on a
       range is the input event, and its value tracking ignores a plain
       assignment. */
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value',
    )?.set as (v: string) => void
    act(() => {
      setValue.call(slider, '40')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onVolume).toHaveBeenCalledWith(40)
  })

  /*
   * Muting is not sliding to nought. Nought is a level somebody chose and
   * has to un-choose by finding the same slider and guessing where it was.
   */
  it('and a mute that remembers where the slider was', () => {
    const onVolume = vi.fn()
    const c = withSound()
    c.levels.set(keyOf('share', 'pat'), 70)
    const el = mount(
      <TileMenu streamKey={keyOf('share', 'pat')} call={c} me="me" label="Pat"
        master={100} onClose={noop} onVolume={onVolume} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />,
    )
    const mute = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Mute')
    expect(mute).toBeTruthy()
    act(() => { (mute as HTMLElement).click() })
    expect(onVolume).toHaveBeenCalledWith(0)
  })

  it('and says it is muted rather than showing 0%', () => {
    const c = withSound()
    c.levels.set(keyOf('share', 'pat'), 0)
    const el = mount(
      <TileMenu streamKey={keyOf('share', 'pat')} call={c} me="me" label="Pat"
        master={100} onClose={noop} onVolume={vi.fn()} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />,
    )
    expect(el.textContent).toContain('Muted')
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Unmute')).toBe(true)
  })
})
