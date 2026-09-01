import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Arrange } from './Arrange'
import { usePanelOrder } from './usePanelOrder'
import { PANELS, type Panel } from '../lib/panelOrder'

/**
 * Arranging the columns, as somebody does it.
 *
 * The ordering itself is covered in panelOrder.test.ts. This is about the
 * parts that only exist on a page: that the arrangement reaches the
 * stylesheet, that the buttons move the right panel, and that the stylesheet
 * is actually written to read what is written for it - which is the join
 * where this would silently do nothing.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

const draw = (node: React.ReactElement) => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

beforeEach(() => {
  document.documentElement.removeAttribute('style')
  delete document.documentElement.dataset.panels
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

/** A component that does nothing but apply an order, the way the shell does. */
function Applied({ order }: { order: readonly Panel[] }) {
  usePanelOrder(order)
  return null
}

describe('applying an arrangement', () => {
  it('writes the columns in the arranged order', () => {
    draw(<Applied order={['members', 'conversation', 'channels', 'servers']} />)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--panelcols').trim())
      .toBe('var(--rightw) minmax(0,1fr) var(--sidew) var(--railw)')
  })

  it('and where each panel goes', () => {
    draw(<Applied order={['members', 'conversation', 'channels', 'servers']} />)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--col-members').trim()).toBe('1')
    expect(style.getPropertyValue('--col-servers').trim()).toBe('4')
  })

  it('and says what the arrangement is, for anything that wants to ask', () => {
    draw(<Applied order={['channels', 'servers', 'conversation', 'members']} />)
    expect(document.documentElement.dataset.panels)
      .toBe('channels servers conversation members')
  })

  /*
   * The join that would fail silently.
   *
   * Everything above could pass while the app looked exactly as it always
   * did, because writing a custom property nothing reads changes nothing. The
   * stylesheet has to be the thing that reads them.
   */
  it('and the stylesheet reads every one of them', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
    expect(css, 'the grid does not use the arranged columns')
      .toContain('grid-template-columns:var(--panelcols')
    for (const panel of PANELS) {
      expect(css, `nothing places the ${panel} column`).toContain(`var(--col-${panel}`)
    }
  })

  /* And each of those has a fallback, or the app is unlaid-out for the moment
     before the script runs - and permanently if it never does. */
  it('and each has a default, so the layout holds before any script runs', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
    expect(css).toContain('var(--col-servers,1)')
    expect(css).toContain('var(--col-channels,2)')
    expect(css).toContain('var(--col-conversation,3)')
    expect(css).toContain('var(--col-members,4)')
  })
})

describe('the arranging overlay', () => {
  const shown = (over: Partial<Parameters<typeof Arrange>[0]> = {}) => draw(
    <Arrange
      order={[...PANELS]}
      onChange={() => {}}
      onDone={() => {}}
      onReset={() => {}}
      {...over}
    />,
  )

  it('names every column', () => {
    const el = shown()
    for (const name of ['Servers', 'Channels', 'Conversation', 'Members']) {
      expect(el.textContent, name).toContain(name)
    }
  })

  it('and says whose arrangement it is', () => {
    expect(shown().textContent).toContain('Only you see this')
  })

  it('moves the panel whose arrow was pressed', () => {
    const onChange = vi.fn()
    const el = shown({ onChange })
    const right = el.querySelector('[aria-label="Move Channels right"]') as HTMLButtonElement
    act(() => { right.click() })
    expect(onChange).toHaveBeenCalledWith(['servers', 'conversation', 'channels', 'members'])
  })

  /* An arrow that would do nothing is not offered, rather than offered and
     quietly ignored. */
  it('and the ends have nowhere further to go', () => {
    const el = shown()
    expect((el.querySelector('[aria-label="Move Servers left"]') as HTMLButtonElement).disabled)
      .toBe(true)
    expect((el.querySelector('[aria-label="Move Members right"]') as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('and Reset is offered only when there is something to undo', () => {
    const asIs = shown()
    const reset = () => Array.from(asIs.querySelectorAll('button'))
      .find((b) => b.textContent === 'Reset') as HTMLButtonElement
    expect(reset().disabled, 'nothing has been changed yet').toBe(true)

    act(() => root?.unmount())
    host?.remove()
    const moved = shown({ order: ['members', 'servers', 'channels', 'conversation'] })
    const after = Array.from(moved.querySelectorAll('button'))
      .find((b) => b.textContent === 'Reset') as HTMLButtonElement
    expect(after.disabled).toBe(false)
  })

  it('and Done leaves', () => {
    const onDone = vi.fn()
    const el = shown({ onDone })
    const done = Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent === 'Done') as HTMLButtonElement
    act(() => { done.click() })
    expect(onDone).toHaveBeenCalled()
  })

  it('and so does Escape', () => {
    const onDone = vi.fn()
    shown({ onDone })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onDone).toHaveBeenCalled()
  })

  it('and the arrow keys move the picked one', () => {
    const onChange = vi.fn()
    shown({ onChange })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    /* The first column is picked to begin with. */
    expect(onChange).toHaveBeenCalledWith(['channels', 'servers', 'conversation', 'members'])
  })
})

describe('where it is offered', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

  /* Below 1250px the member list is not a column, so an order left to right
     does not describe the layout. */
  it('is not offered once the layout stops being four columns', () => {
    /* Found from the rule rather than from the media query: there is more
       than one query at this width, and taking the first one checked the
       wrong block - which passed for the wrong reason until it did not. */
    const at = css.indexOf('.arrange{display:none}')
    expect(at, 'nothing hides the overlay at all').toBeGreaterThan(-1)
    const before = css.slice(0, at)
    expect(before.slice(before.lastIndexOf('@media')))
      .toContain('max-width:1250px')
  })

  /* And the panels go back to their own order there, or a panel told to sit
     in the fourth column of a three-column grid makes a fourth. */
  it('and the panels are pinned back at that width', () => {
    const at = css.indexOf('@media (max-width:1250px){:root{--sidew:262px}')
    expect(at).toBeGreaterThan(-1)
    const block = css.slice(at, at + 900)
    expect(block).toContain('.pane.rail{grid-column:1;grid-row:3}')
    expect(block).toContain('.pane.chatpane{grid-column:3;grid-row:3}')
  })
})
