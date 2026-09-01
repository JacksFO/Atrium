import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Spectators } from './Spectators'
import type { User } from '../lib/wire'

/**
 * The faces in the corner of a share, and the list behind them.
 *
 * The list used to be a `title`: a native tooltip, which waits a second,
 * cannot be styled, and puts every name on one line with no faces beside
 * them. Nothing tested it, because there was nothing there to test.
 */

const user = (id: string, name: string) =>
  ({ id, username: id, display_name: name }) as User

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => user(`u${i}`, `Person ${i}`))

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(people: User[]): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => { root!.render(<Spectators people={people} />) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  document.querySelectorAll('.ctx,.ctxscrim').forEach((n) => n.remove())
  root = null
  host = null
})

/* Portalled to the body, so it is not under the host element. */
const panel = () => document.querySelector('.spects')
const faces = (el: HTMLElement) => el.querySelector('.watchers')

describe('the faces', () => {
  it('are not drawn at all when nobody is watching', () => {
    /* "Spectators - 0" is a count of an empty room, and the faces are the
       thing you press: no faces, nothing to press. */
    expect(faces(draw([]))).toBe(null)
  })

  it('show everybody, up to four', () => {
    const el = draw(many(3))
    expect(el.querySelectorAll('.watchers .av')).toHaveLength(3)
    expect(el.querySelector('.more')).toBe(null)
  })

  it('and say how many more there are beyond that', () => {
    const el = draw(many(7))
    expect(el.querySelectorAll('.watchers .av')).toHaveLength(4)
    expect(el.querySelector('.more')?.textContent).toBe('+3')
  })

  it('and are named for a reader who cannot see them', () => {
    expect(faces(draw(many(2)))?.getAttribute('aria-label')).toBe('2 watching')
  })
})

describe('the list behind them', () => {
  it('is shut until somebody asks', () => {
    draw(many(2))
    expect(panel()).toBe(null)
  })

  it('opens on a press, headed with the count', () => {
    const el = draw(many(2))
    act(() => { (faces(el) as HTMLButtonElement).click() })
    expect(panel()?.querySelector('.specthead')?.textContent).toBe('Spectators — 2')
  })

  it('and names every one of them, not only the four with faces', () => {
    const el = draw(many(6))
    act(() => { (faces(el) as HTMLButtonElement).click() })
    const names = [...panel()!.querySelectorAll('.spectname')].map((n) => n.textContent)
    expect(names).toHaveLength(6)
    expect(names[5]).toBe('Person 5')
  })

  it('and shuts again on the scrim', () => {
    const el = draw(many(2))
    act(() => { (faces(el) as HTMLButtonElement).click() })
    expect(panel()).not.toBe(null)
    act(() => { (document.querySelector('.ctxscrim') as HTMLElement).click() })
    expect(panel()).toBe(null)
  })
})
