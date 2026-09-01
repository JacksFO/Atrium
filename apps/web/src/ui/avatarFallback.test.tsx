import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'
import type { User } from '../lib/wire'

/**
 * A picture that will not load.
 *
 * The row says what somebody's picture is, and that was taken as proof the
 * picture exists. When the file is gone the browser draws its own broken
 * image - a torn page and the alt text - which is the ugliest possible answer
 * to a question the app already has a good answer to: it draws everybody
 * without a picture as generated art and their initial.
 *
 * Not hypothetical. On 2026-08-29 the orphan sweep was handed the wrong
 * database and deleted every upload; most came back from the offsite copy and
 * one avatar did not, so one member's row pointed at a file that was gone.
 * Until this, that was a torn page rather than her initial.
 */

const person = (over: Partial<User> = {}): User => ({
  id: 'u1', username: 'morticia', discriminator: '0001', verified: 0,
  display_name: 'Morticia', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('an avatar whose file is gone', () => {
  it('draws the picture while it is loading', () => {
    const el = draw(<Avatar user={person({ avatar_path: '/uploads/gone.png' })} />)
    /* Or the fallback below could pass simply by never trying. */
    expect(el.querySelector('img')).not.toBeNull()
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/uploads/gone.png')
  })

  it('and falls back to the drawn one when it fails', () => {
    const el = draw(<Avatar user={person({ avatar_path: '/uploads/gone.png' })} />)
    const img = el.querySelector('img')!
    act(() => { img.dispatchEvent(new Event('error', { bubbles: true })) })

    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('M')
  })

  /* Somebody putting a new picture on must not be told it is broken because
     the last one was. */
  it('and tries again for a different picture', () => {
    const el = draw(<Avatar user={person({ avatar_path: '/uploads/gone.png' })} />)
    act(() => { el.querySelector('img')!.dispatchEvent(new Event('error', { bubbles: true })) })
    expect(el.querySelector('img')).toBeNull()

    act(() => { root!.render(<Avatar user={person({ avatar_path: '/uploads/new.png' })} />) })
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/uploads/new.png')
  })

  /* Nothing set at all was always drawn this way, and still is. */
  it('and somebody with no picture is unchanged', () => {
    const el = draw(<Avatar user={person()} />)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('M')
  })
})
