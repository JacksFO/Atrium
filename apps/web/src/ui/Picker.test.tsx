import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Picker } from './Picker'

/**
 * The app's own dropdown.
 *
 * A bare `<select>` is the operating system's control - it ignores every
 * colour in here and opens a list drawn in Windows' shape, which in the
 * middle of a settings pane looks like a piece of another program that has
 * fallen into this one.
 */

const OPTIONS = [
  { value: 0, label: 'Don’t clear' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
]

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(value: number, onPick = () => {}): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <Picker value={value} options={OPTIONS} onPick={onPick} label="Clear after" />,
    )
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.querySelectorAll('.ctx,.ctxscrim').forEach((n) => n.remove())
  root = null
  host = null
})

const button = (el: HTMLElement) => el.querySelector('.chooser') as HTMLButtonElement
/* Portalled to the body, so not under the host. */
const rows = () => [...document.querySelectorAll('.ctx .mitem')]

describe('the picker', () => {
  it('shows what is chosen, not the list', () => {
    expect(button(draw(0)).textContent).toContain('Don’t clear')
    expect(rows()).toHaveLength(0)
  })

  it('and is named for anybody who cannot see the label beside it', () => {
    expect(button(draw(0)).getAttribute('aria-label')).toBe('Clear after')
  })

  it('opens every choice on a press', () => {
    const el = draw(0)
    act(() => { button(el).click() })
    expect(rows().map((r) => r.textContent))
      .toEqual(['Don’t clear', '30 minutes', '1 hour'])
  })

  it('ticks the one in force, so the menu says which it is', () => {
    const el = draw(60)
    act(() => { button(el).click() })
    const ticked = rows().filter((r) => r.querySelector('svg'))
    expect(ticked).toHaveLength(1)
    expect(ticked[0]?.textContent).toBe('1 hour')
  })

  it('hands back what was picked, and shuts', () => {
    const onPick = vi.fn()
    const el = draw(0, onPick)
    act(() => { button(el).click() })
    act(() => { (rows()[1] as HTMLButtonElement).click() })
    expect(onPick).toHaveBeenCalledWith(30)
    expect(rows()).toHaveLength(0)
  })

  it('and falls back to the value itself where no option owns it', () => {
    /* A stored choice from a version that offered something this one does
       not. Better a number than an empty button. */
    expect(button(draw(999)).textContent).toContain('999')
  })
})
