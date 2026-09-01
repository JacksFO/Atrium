import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Shell } from './Shell'
import { DEFAULTS } from '../lib/settings'
import { applyReady, emptyWorld, type World } from '../lib/world'
import type { Api } from '../lib/api'
import type { ReadyFrame, User } from '../lib/wire'

/**
 * The app on a phone.
 *
 * Two columns slide over the conversation instead of sitting beside it, and
 * which of those is happening is decided from the width in one place. The old
 * client wrote the columns as an inline style, and an inline style beats every
 * media query there is — so the phone layout it shipped was overruled the
 * moment the app drew itself, and the conversation ended up in the third
 * column of four, past the right edge of the screen.
 *
 * That is the failure this file is about: not whether the rules exist, but
 * whether anything overrules them.
 */

const user = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})

function world(): World {
  const w = emptyWorld(user('me'))
  applyReady(w, {
    t: 'ready', user: user('me'), members: [user('pat')],
    channels: [{
      id: 'c1', space_id: 's1', name: 'general', kind: 'text', topic: '',
      position: 0, category_id: null,
    }],
    categories: [], roles: [], assignments: [], online: ['me'], voice: [],
    unread: [], channelPrefs: [],
    permissionsBySpace: { s1: ['view_channels', 'send_messages', 'read_history'] },
    channelPermissions: {}, looseOrder: {}, activities: {},
  } as ReadyFrame)
  w.spaces = [{
    id: 's1', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
    owner_id: 'me', position: 0, created_at: 0,
  } as World['spaces'][number]]
  w.membersBySpace.set('s1', new Set(['me', 'pat']))
  return w
}

const server = {
  get: async () => ({}), post: async () => ({}),
  patch: async () => ({}), delete: async () => ({}),
} as unknown as Api
const noop = () => {}

let root: Root | null = null
let host: HTMLDivElement | null = null
const realWidth = window.innerWidth

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
  Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true })
})

function at(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <Shell world={world()} server={server} onOut={noop} send={noop} gateway={null}
        settings={DEFAULTS} set={noop} reset={noop} version={0} changed={() => {}}
        stale={false} error="" clearError={noop} />,
    )
  })
  return host
}

const PHONE = 390
const DESKTOP = 1440

describe('the app on a phone', () => {
  it('draws the button that is the only way to the channel list', () => {
    const el = at(PHONE)
    expect(el.querySelector('.navtog')).toBeTruthy()
  })

  it('and does not draw it on a desktop, where the list is simply there', () => {
    const el = at(DESKTOP)
    expect(el.querySelector('.navtog')).toBe(null)
  })

  /* The drawers are driven by one attribute, which the stylesheet reads. */
  it('opens the channels drawer and closes it again', () => {
    const el = at(PHONE)
    const shell = el.querySelector('.shell') as HTMLElement
    expect(shell.getAttribute('data-slid')).toBe('')
    act(() => { (el.querySelector('.navtog') as HTMLElement).click() })
    expect(shell.getAttribute('data-slid')).toBe('nav')
    act(() => { (el.querySelector('.navtog') as HTMLElement).click() })
    expect(shell.getAttribute('data-slid')).toBe('')
  })

  /*
   * And nothing writes the columns as an inline style.
   *
   * That is the exact bug the old client shipped: the grid was written onto
   * the element, so every phone rule below it was dead and the conversation
   * was drawn off the side of the screen.
   */
  it('and never writes the columns onto the element', () => {
    const el = at(PHONE)
    const shell = el.querySelector('.shell') as HTMLElement
    expect(shell.style.gridTemplateColumns).toBe('')
    expect(shell.getAttribute('style') ?? '').not.toContain('grid-template')
  })
})

describe('the panels that open beside a button', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

  /*
   * On a phone these are pinned across the screen above the message box,
   * because there is no room beside anything for them. A measured `top`
   * written straight onto the element overrules that, so the coordinates go
   * through custom properties, which a later rule can still beat.
   */
  it('are placed from properties, not from an inline top', () => {
    expect(css).toMatch(/\.emoji\{position:absolute;left:var\(--px\);top:var\(--py\)/)
    expect(css).toMatch(/\.gifs\{position:absolute;left:var\(--px\);top:var\(--py\)/)
  })

  it('and the phone layout still overrides them', () => {
    /* Pinned across the screen above the message box, which only works if it
       comes after the base rule and nothing inline is fighting it. */
    const pinned = css.search(/\.emoji,\.gifs\{position:fixed/)
    const base = css.search(/\.emoji\{position:absolute/)
    expect(pinned).toBeGreaterThan(-1)
    expect(pinned).toBeGreaterThan(base)
  })

  it('and the source really sets the properties', () => {
    for (const f of ['src/ui/EmojiPicker.tsx', 'src/ui/GifPicker.tsx']) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8')
      expect(src, f).toContain("'--px'")
      expect(src, f).not.toContain('left: at.left')
    }
  })
})

/**
 * Reaching a person's menu without a right-click.
 *
 * A phone has no right-click, and these rows were bound to `contextmenu`
 * alone — so the only way to anybody's menu was absent there, in the same way
 * and for the same reason a message's actions once were.
 */
describe('a person in a list, on a phone', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  it('answers a long press as well as a right-click', () => {
    const at = src.indexOf('function PersonRow')
    expect(at, 'the rows go through one component').toBeGreaterThan(0)
    const body = src.slice(at, at + 900)
    expect(body).toContain('useLongPress')
    expect(body).toContain('onContextMenu')
  })

  /* And no row is left bound to the right-click alone. */
  it('and no row is left with only the right-click', () => {
    const rows = src.split('className="mrow"')
    expect(rows.length).toBeGreaterThan(2)
    for (const after of rows.slice(1)) {
      expect(after.slice(0, 200)).not.toContain('onContextMenu')
    }
  })
})

/**
 * The phone layout, checked against the stylesheet rather than assumed.
 *
 * jsdom lays nothing out, so what can be checked here is that the rules exist,
 * that they come after the ones they must beat, and that nothing is written
 * onto an element where a rule is supposed to decide. That last one is the
 * failure this app keeps having, and the only one that is invisible.
 */
describe('the rules the phone layout depends on', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
  /*
   * The phone block, which is the second of the two at this width - the
   * first is the sign-in box. Found by what only the layout one contains,
   * and then read from the top of the block it is in.
   *
   * It used to be "two thousand characters before that rule", which is a
   * guess about how much comment sits above it. Three paragraphs were
   * written into the block and the window slid off the front of it, so a
   * rule that had not moved reported itself missing.
   */
  const anchor = css.indexOf('.shell>.rail,.shell>.sidepane')
  const phone = css.slice(css.lastIndexOf('@media (max-width:820px)', anchor))

  it('reads the phone block at all', () => {
    expect(phone.length).toBeGreaterThan(500)
  })

  /* One column, and both side panels over the top of it rather than beside. */
  it('puts the app in one column', () => {
    expect(phone).toMatch(/\.shell\{grid-template-columns:minmax\(0,1fr\)/)
  })

  it('and slides the rail and the channel list over it', () => {
    expect(phone).toMatch(/\.shell>\.rail,\.shell>\.sidepane\{[^}]*position:fixed/)
    expect(phone).toMatch(/\.shell\[data-slid="nav"\]>\.rail/)
  })

  /* The app is position:fixed, and on iOS that is the layout viewport — the
     one including the strip Safari draws its toolbar over. */
  it('and measures its height in the units a phone can honour', () => {
    expect(phone).toMatch(/#app\{height:100dvh/)
    expect(phone).toMatch(/@media \(display-mode:standalone\)\{#app\{height:100vh\}\}/)
  })

  /* Touch targets, which are the difference between usable and not. */
  it('and makes the things a thumb has to hit big enough', () => {
    expect(phone).toMatch(/\.icb\{width:38px;height:38px\}/)
    expect(phone).toMatch(/\.mrow,\.chrow\{min-height:44px\}/)
  })

  /* And keeps clear of the notch and the home bar. */
  it('and keeps out of the parts of the screen it does not own', () => {
    expect(phone).toContain('var(--safe-t)')
    expect(phone).toContain('var(--safe-b)')
  })

  /*
   * The gesture only ever completes if the browser does not take the pointer
   * for itself first. Left at `auto` it is free to claim a horizontal drag —
   * overscroll, or iOS's edge swipe back — and it claims it by cancelling the
   * pointer partway through, so the swipe never finishes and nothing says why.
   */
  it('and lets the page have sideways gestures', () => {
    expect(phone).toMatch(/touch-action:pan-y/)
  })

  it('and the page is told it may reach the edges', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain('viewport-fit=cover')
    expect(html).toContain('width=device-width')
  })
})

/**
 * Opening the drawers with a thumb.
 *
 * The whole point of a drawer is that it comes from the edge you are already
 * holding, so this drives the gesture through the DOM rather than calling the
 * function that decides about it — that decision has its own tests, and what
 * this asks is whether anything is listening.
 */
describe('sliding the panels open', () => {
  const swipe = (dx: number, dy = 0, pointerType = 'touch') => {
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', {
        pointerType, clientX: 200, clientY: 400, bubbles: true,
      }))
      window.dispatchEvent(new PointerEvent('pointerup', {
        pointerType, clientX: 200 + dx, clientY: 400 + dy, bubbles: true,
      }))
    })
  }
  const slid = (el: HTMLElement) =>
    (el.querySelector('.shell') as HTMLElement).getAttribute('data-slid')

  it('opens the channels with a swipe right', () => {
    const el = at(PHONE)
    expect(slid(el)).toBe('')
    swipe(120)
    expect(slid(el)).toBe('nav')
  })

  it('and puts it back with a swipe the other way', () => {
    const el = at(PHONE)
    swipe(120)
    swipe(-120)
    expect(slid(el)).toBe('')
  })

  it('and opens the members with a swipe left', () => {
    const el = at(PHONE)
    swipe(-120)
    expect(slid(el)).toBe('members')
  })

  /* The hard part. A conversation is unreadable on a phone if every drag
     down opens a drawer, so vertical intent always wins. */
  it('but never mistakes a scroll for one', () => {
    const el = at(PHONE)
    swipe(120, 300)
    expect(slid(el)).toBe('')
  })

  /* A mouse has a scrollbar and a window edge; this is for thumbs. */
  it('and leaves a mouse alone', () => {
    const el = at(PHONE)
    swipe(120, 0, 'mouse')
    expect(slid(el)).toBe('')
  })

  /* On a desktop both panels are simply there, so the gesture is off. */
  it('and does nothing on a desktop', () => {
    const el = at(DESKTOP)
    swipe(120)
    expect(slid(el)).toBe('')
  })
})
