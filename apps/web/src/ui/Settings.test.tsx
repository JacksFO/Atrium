import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsWindow } from './SettingsWindow'
import { DEFAULTS, type Settings } from '../lib/settings'
import { emptyWorld } from '../lib/world'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'

/**
 * Where the settings screen is looking, after changing something.
 *
 * Picking a microphone sent it back to the top. Scrolling lives on a DOM
 * node, so it survives exactly as long as that node does — if React replaces
 * `.sbody` rather than updating it, the scroll goes with it and there is
 * nothing in the code that looks wrong.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0,
  display_name: 'Me', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null,
  banner_path: null, status_text: '', presence: 'online',
  created_at: 0,
}

const server = {
  get: async () => ({}), post: async () => ({}),
  patch: async () => ({}), delete: async () => ({}),
} as unknown as Api
const noop = () => {}

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null; host = null
})

/** Mounts the screen and hands back a way to change a setting, as the app does. */
function open() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  let settings: Settings = { ...DEFAULTS }
  const draw = () => {
    act(() => {
      root?.render(
        <SettingsWindow world={emptyWorld(me)} settings={settings} set={set}
          reset={noop} onOut={noop} onClose={noop} server={server} onMe={noop}
          onArrange={noop} />,
      )
    })
  }
  /* Exactly what App does: a new settings object, then a redraw. */
  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    settings = { ...settings, [k]: v }
    draw()
  }
  draw()
  return { host: host as HTMLDivElement, set }
}

const body = (el: HTMLElement) => {
  const n = el.querySelector('.smain')
  if (!n) throw new Error('no .smain to scroll')
  return n as HTMLElement
}

describe('the settings screen', () => {
  it('has the pane it scrolls, to begin with', () => {
    const { host: el } = open()
    expect(body(el)).toBeTruthy()
    expect(el.querySelector('.snav')).toBeTruthy()
  })

  /* The node is what holds the scroll. Replacing it is the bug, whatever it
     looks like on screen. */
  it('keeps the same scrolling pane when a setting changes', () => {
    const { host: el, set } = open()
    const before = body(el)
    set('density', 'compact')
    expect(body(el)).toBe(before)
  })

  it('and keeps it across several changes in a row', () => {
    const { host: el, set } = open()
    const before = body(el)
    set('density', 'cosy')
    set('wallpaper', false)
    set('density', 'tight')
    expect(body(el)).toBe(before)
  })

  /* And really does scroll: jsdom will not move a node with no layout, so
     this is asserted on the property the browser would keep. */
  it('holds the position it was scrolled to', () => {
    const { host: el, set } = open()
    const pane = body(el)
    pane.scrollTop = 240
    expect(pane.scrollTop).toBe(240)
    set('density', 'compact')
    expect(body(el).scrollTop).toBe(240)
  })
})

/**
 * Every field the app draws is drawn by the app.
 *
 * The rule was `.fld input[type=text]`, which matches the attribute — and an
 * `<input value={...}>` written the ordinary way has no type attribute at
 * all, whatever the browser treats it as. Eighteen fields across the app were
 * therefore drawn by the browser: grey boxes with square corners, in a screen
 * where everything else is ours. Nothing failed; the selector simply matched
 * nothing, which is the quietest way for a stylesheet to be wrong.
 */
describe('the fields in settings', () => {
  /* Without the comments, or the rule this is about is found in the note
     explaining why it was removed. */
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  /* An input the way the app writes them, which is the case that was missed. */
  const untyped = '<input value={x} onChange={...} />'

  it('are not selected by an attribute the markup does not carry', () => {
    /* The old rule, which must not come back. */
    expect(css, `${untyped} has no type attribute to match`)
      .not.toMatch(/\.fld input\[type=text\]/)
  })

  it('and the rule that styles them names what they are not', () => {
    expect(css).toMatch(/\.fld input:not\(\[type=range\]\)/)
    expect(css).toMatch(/\.row select/)
  })

  /* The markup really is untyped, or the test above guards nothing. */
  it('and the markup really is written without a type', () => {
    const me = readFileSync(resolve(process.cwd(), 'src/ui/MePane.tsx'), 'utf8')
    expect(me).toMatch(/<input value=\{name\}/)
  })

  /* A name and the sentence under it are two spans; without a display they
     are inline and run together on one line. */
  it('and a row lays its label out above its description', () => {
    expect(css).toMatch(/\.row \.txt\{[^}]*display:grid/)
  })
})
