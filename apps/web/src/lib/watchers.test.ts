import { describe, expect, it } from 'vitest'
import { watchersOf } from './watchers'
import { emptyWorld, type World } from './world'
import type { User } from './wire'

/**
 * Turning "what is each person watching" - which is what the wire carries -
 * into "who is watching this", which is what somebody sharing wants to know.
 */

const user = (id: string, name: string) =>
  ({ id, username: id, display_name: name }) as User

function world(
  watching: Record<string, string[]>,
  names: Record<string, string> = {},
): World {
  const w = emptyWorld(user('me', 'Me'))
  for (const [id, keys] of Object.entries(watching)) {
    w.watchers.set(id, keys)
    w.people.set(id, user(id, names[id] ?? id.toUpperCase()))
  }
  return w
}

describe('who is watching a screen', () => {
  it('is everybody who asked for that one', () => {
    const w = world({ u1: ['share:bailey'], u2: ['share:bailey'] })
    expect(watchersOf(w, 'share:bailey', 'me').map((u) => u.id)).toEqual(['u1', 'u2'])
  })

  it('and nobody who asked for a different one', () => {
    const w = world({ u1: ['share:bailey'], u2: ['share:someone-else'] })
    expect(watchersOf(w, 'share:bailey', 'me').map((u) => u.id)).toEqual(['u1'])
  })

  it('never you, however you are counted', () => {
    /* "2 spectators" has to mean the same thing to everybody reading it. */
    const w = world({ me: ['share:bailey'], u1: ['share:bailey'] })
    expect(watchersOf(w, 'share:bailey', 'me').map((u) => u.id)).toEqual(['u1'])
  })

  it('and nobody this client has never heard of', () => {
    const w = world({ u1: ['share:bailey'] })
    w.watchers.set('ghost', ['share:bailey'])
    expect(watchersOf(w, 'share:bailey', 'me').map((u) => u.id)).toEqual(['u1'])
  })

  it('in name order, not in whatever order they arrived', () => {
    /* The map is rebuilt from scratch every time anybody anywhere starts or
       stops watching, so an unsorted list reshuffles while it is being read. */
    const w = world(
      { u1: ['share:b'], u2: ['share:b'], u3: ['share:b'] },
      { u1: 'Zoe', u2: 'Adam', u3: 'Morgan' },
    )
    expect(watchersOf(w, 'share:b', 'me').map((u) => u.display_name))
      .toEqual(['Adam', 'Morgan', 'Zoe'])
  })

  it('and nobody at all when nobody is', () => {
    expect(watchersOf(world({}), 'share:b', 'me')).toEqual([])
  })
})
