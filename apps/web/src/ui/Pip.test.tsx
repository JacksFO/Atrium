import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Pip } from './Pip'
import { emptyCall, keyOf, type Call, type StreamKey } from '../lib/call'
import { emptyWorld, type World } from '../lib/world'

/**
 * The corner window, which had one test: that it draws nothing when there is
 * nothing to put in it. Nothing said it draws something when there is - so
 * "the floating window is missing" was a report about behaviour no test had
 * an opinion on.
 *
 * Mounted rather than rendered to a string, because what it shows now depends
 * on effects: which one you picked, and who is talking.
 */

const noop = () => {}
const me = { id: 'me', username: 'me', display_name: 'Me' } as World['me']
const world = (): World => {
  const w = emptyWorld(me)
  /* So a label for your own reads as your name rather than the fallback. */
  w.people.set('me', me)
  return w
}

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id, identity: id, name: id.toUpperCase(),
  muted: false, sharing: false, cam: false, ...over,
})

/** A call watching each of `keys`, with a stream arrived for every one. */
function watching(keys: StreamKey[], over: Partial<Call> = {}): Call {
  return {
    ...emptyCall(),
    channel: 'c1',
    members: [person('u1'), person('u2')],
    watching: new Set(keys),
    video: new Map(keys.map((k) => [k, {} as MediaStream])),
    ...over,
  }
}

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(call: Call): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<Pip call={call} world={world()} onOpen={noop} onStop={noop} />)
  })
  return host
}

/** Re-render with a changed call, as the app does when anything moves. */
function again(call: Call): void {
  act(() => {
    root!.render(<Pip call={call} world={world()} onOpen={noop} onStop={noop} />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  /* Where it was left is remembered, and one test's drag is not the next
     test's starting point. */
  localStorage.clear()
  root = null
  host = null
})

/** A pointer press, drag and release, in the window's own coordinates. */
function dragFrom(el: Element, dx: number, dy: number, at = { x: 700, y: 500 }) {
  const send = (type: string, x: number, y: number, target: Element = el) => {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, clientX: x, clientY: y,
    }))
  }
  act(() => { send('pointerdown', at.x, at.y) })
  act(() => { send('pointermove', at.x + dx, at.y + dy) })
  act(() => { send('pointerup', at.x + dx, at.y + dy) })
}

const window_ = (el: HTMLElement) => el.querySelector('.pip2') as HTMLElement
const at = (el: HTMLElement) => {
  const box = window_(el)
  return { left: box.style.left, top: box.style.top }
}

/* By its own name rather than "the first span in the bar", which was the
   avatar's initial the moment your own picture had one. */
const shown = (el: HTMLElement) => el.querySelector('.pipwho')?.textContent
const arrows = (el: HTMLElement) => [...el.querySelectorAll('.pipnav')]

describe('the corner window', () => {
  it('draws what you are watching, which is the whole point of it', () => {
    const el = draw(watching([keyOf('share', 'u1')]))
    expect(el.querySelector('.pip2')).not.toBe(null)
    expect(el.querySelector('video')).not.toBe(null)
    expect(shown(el)).toBe('U1')
  })

  it('and nothing when there is nothing to keep', () => {
    expect(draw(emptyCall()).querySelector('.pip2')).toBe(null)
  })
})

describe('choosing between several', () => {
  it('offers no arrows for a single one', () => {
    expect(arrows(draw(watching([keyOf('share', 'u1')])))).toHaveLength(0)
  })

  it('and a way either side when there is more than one', () => {
    const el = draw(watching([keyOf('share', 'u1'), keyOf('share', 'u2')]))
    expect(arrows(el).map((a) => a.getAttribute('aria-label')))
      .toEqual(['Watch the previous one', 'Watch the next one'])
    expect(el.querySelector('.pipof')?.textContent).toBe('1/2')
  })

  it('moves to the next one, and says which', () => {
    const el = draw(watching([keyOf('share', 'u1'), keyOf('share', 'u2')]))
    expect(shown(el)).toBe('U1')
    act(() => { (arrows(el)[1] as HTMLButtonElement).click() })
    expect(shown(el)).toBe('U2')
    expect(el.querySelector('.pipof')?.textContent).toBe('2/2')
  })

  it('and wraps round rather than stopping', () => {
    const el = draw(watching([keyOf('share', 'u1'), keyOf('share', 'u2')]))
    act(() => { (arrows(el)[0] as HTMLButtonElement).click() })
    expect(shown(el), 'back from the first is the last').toBe('U2')
  })

  it('forgets a choice once that one has gone', () => {
    const both = [keyOf('share', 'u1'), keyOf('share', 'u2')]
    const el = draw(watching(both))
    act(() => { (arrows(el)[1] as HTMLButtonElement).click() })
    expect(shown(el)).toBe('U2')

    /* u2 stops sharing: what was chosen is not on offer any more. */
    again(watching([keyOf('share', 'u1')]))
    expect(shown(el)).toBe('U1')
    expect(arrows(el)).toHaveLength(0)
  })
})

describe('following whoever is talking', () => {
  const cams = (speaking: string[]) => watching(
    [keyOf('cam', 'u1'), keyOf('cam', 'u2')],
    {
      members: [person('u1', { cam: true }), person('u2', { cam: true })],
      speaking: new Set(speaking),
    },
  )

  it('switches to the face of whoever speaks', () => {
    const el = draw(cams([]))
    expect(shown(el)).toBe('U1')
    again(cams(['u2']))
    expect(shown(el)).toBe('U2')
  })

  it('but never over a screen somebody is watching', () => {
    /* A screen is watched deliberately. Somebody speaking is not a reason to
       take it away, which is the whole of what was asked for. */
    const call = watching(
      [keyOf('share', 'u1'), keyOf('cam', 'u2')],
      {
        members: [person('u1', { sharing: true }), person('u2', { cam: true })],
        speaking: new Set(['u2']),
      },
    )
    expect(shown(draw(call))).toBe('U1')
  })

  it('and stops following once you have chosen for yourself', () => {
    const el = draw(cams([]))
    act(() => { (arrows(el)[1] as HTMLButtonElement).click() })
    expect(shown(el)).toBe('U2')
    /* u1 starts talking. The choice stands. */
    again(cams(['u1']))
    expect(shown(el)).toBe('U2')
  })
})

describe('your own', () => {
  /* Read out of `video` rather than `watching`, because you never subscribe
     to yourself - which is why it needs saying separately here. */
  const own = (over: Partial<Call> = {}): Call => ({
    ...emptyCall(),
    channel: 'c1',
    members: [person('me', { sharing: true })],
    video: new Map([[keyOf('share', 'me'), {} as MediaStream]]),
    ...over,
  })

  it('is what the corner shows when you are the only one sharing', () => {
    const el = draw(own())
    expect(el.querySelector('.pip2')).not.toBe(null)
    expect(shown(el)).toBe('Me')
  })

  it('and offers no way to stop watching it, which would do nothing', () => {
    const el = draw(own())
    const titles = [...el.querySelectorAll('.pipbar button')]
      .map((b) => b.getAttribute('title'))
    expect(titles).toEqual(['Back to the stage'])
  })

  it('never in front of somebody else’s', () => {
    const el = draw(own({
      members: [person('me', { sharing: true }), person('u1', { sharing: true })],
      watching: new Set([keyOf('share', 'u1')]),
      video: new Map([
        [keyOf('share', 'me'), {} as MediaStream],
        [keyOf('share', 'u1'), {} as MediaStream],
      ]),
    }))
    expect(shown(el), 'theirs first').toBe('U1')
    act(() => { (arrows(el)[1] as HTMLButtonElement).click() })
    expect(shown(el), 'and yours is one press away').toBe('Me')
  })

  it('and the corner never follows you when you speak', () => {
    /* Following yourself is a mirror for as long as you are talking. */
    const cams = (speaking: string[]): Call => ({
      ...emptyCall(),
      channel: 'c1',
      members: [person('u1', { cam: true }), person('me', { cam: true })],
      watching: new Set([keyOf('cam', 'u1')]),
      video: new Map([
        [keyOf('cam', 'u1'), {} as MediaStream],
        [keyOf('cam', 'me'), {} as MediaStream],
      ]),
      speaking: new Set(speaking),
    })
    const el = draw(cams([]))
    expect(shown(el)).toBe('U1')
    again(cams(['me']))
    expect(shown(el), 'still theirs').toBe('U1')
  })
})

describe('stopping', () => {
  it('stops the one on screen, not whichever was first', () => {
    const onStop = vi.fn()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const call = watching([keyOf('share', 'u1'), keyOf('share', 'u2')])
    act(() => {
      root!.render(<Pip call={call} world={world()} onOpen={noop} onStop={onStop} />)
    })
    const el = host
    act(() => { (arrows(el)[1] as HTMLButtonElement).click() })
    const stop = [...el.querySelectorAll('.pipbar button')].at(-1) as HTMLButtonElement
    act(() => { stop.click() })
    expect(onStop).toHaveBeenCalledWith(keyOf('share', 'u2'))
  })
})

describe('moving the window', () => {
  it('drags from anywhere on the picture, not only a bar', () => {
    const el = draw(watching([keyOf('share', 'u1')]))
    const before = at(el)
    dragFrom(window_(el).querySelector('video')!, 40, 30)
    const after = at(el)
    expect(after.left).not.toBe(before.left)
    expect(after.top).not.toBe(before.top)
    expect(parseFloat(after.left) - parseFloat(before.left)).toBe(40)
    expect(parseFloat(after.top) - parseFloat(before.top)).toBe(30)
  })

  it('but not when the press was on a button', () => {
    /* Everything on the window that is not a grip has to say so, or reaching
       for an arrow drags the window instead of pressing it. */
    const el = draw(watching([keyOf('share', 'u1'), keyOf('share', 'u2')]))
    const before = at(el)
    dragFrom(arrows(el)[1]!, 40, 30)
    expect(at(el)).toEqual(before)
  })

  it('and a resize is not also a move', () => {
    /* An edge is a child of the window, so its press reaches the window's
       own handler too - which would replace the resize with a move. */
    const el = draw(watching([keyOf('share', 'u1')]))
    const box = window_(el)
    const before = { w: box.style.width, left: box.style.left }
    dragFrom(box.querySelector('[data-edge="e"]')!, 40, 0)
    expect(box.style.width, 'it grew').not.toBe(before.w)
    expect(box.style.left, 'and did not walk sideways').toBe(before.left)
  })
})
