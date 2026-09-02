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

/**
 * Turning one person down.
 *
 * A person's microphone has always arrived as its own sound under its own key
 * and played at its own volume - what was missing was the way to set it. This
 * asked whether the tile was a screen before offering a slider, so the only
 * sound anybody could set was a share's, and one friend twice as loud as
 * everybody else was something to put up with.
 */
describe('somebody else’s voice', () => {
  const withVoice = () => {
    const c = call()
    /* jsdom has no MediaStream, and nothing here looks inside one - what the
       menu asks is whether there is a sound under that key at all. */
    c.sounds.set(keyOf('voice', 'pat'), {} as MediaStream)
    return c
  }
  const open = () => mount(
    <TileMenu streamKey={keyOf('voice', 'pat')} call={withVoice()} me="me" label="Pat"
      master={100} onClose={noop} onVolume={noop} onWatch={noop}
      onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />,
  )

  it('can be turned down', () => {
    expect(open().querySelector('input[type="range"]'), 'no slider for a voice')
      .not.toBeNull()
  })

  it('and named as a person rather than as a picture', () => {
    const text = open().textContent ?? ''
    expect(text).toContain('Pat')
    expect(text, 'a voice tile called itself a camera').not.toContain('camera')
  })

  /*
   * And the things that are about a picture are absent rather than disabled.
   * There is no picture behind a voice, so filling the screen with it, popping
   * it out and watching it are all buttons that could not do what they say.
   */
  it('and is not offered anything that needs a picture', () => {
    const text = open().textContent ?? ''
    expect(text).not.toContain('Full screen')
    expect(text).not.toContain('Pop out')
    expect(text).not.toContain('Watch')
  })

  /* Your own voice is not something to turn down - that is what the
     microphone button is for, and a slider here would be feedback. */
  it('but your own is not', () => {
    const c = call()
    c.sounds.set(keyOf('voice', 'me'), {} as MediaStream)
    const el = mount(
      <TileMenu streamKey={keyOf('voice', 'me')} call={c} me="me" label="Me"
        master={100} onClose={noop} onVolume={noop} onWatch={noop}
        onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />,
    )
    expect(el.querySelector('input[type="range"]')).toBeNull()
  })
})
