import { describe, expect, it } from 'vitest'
import { homeWaiting } from './Shell'
import { emptyWorld, type World } from '../lib/world'
import type { Friend } from '../lib/load'
import type { User } from '../lib/wire'

/**
 * What the home tile says is waiting behind it.
 *
 * Messages and friend requests, deliberately one number: the tile answers "is
 * there something in here", and somebody who has added you is exactly that.
 *
 * A request arrives on the Friends page, which lives behind that tile. With
 * nothing on it, the only way to find out you had been added was to go and
 * look, and nothing gave you a reason to.
 */
const person = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})
const friend = (id: string, state: Friend['state']): Friend => ({ ...person(id), state })

function world(): World {
  const w = emptyWorld(person('me'))
  w.dms = [{ id: 'dm1', name: 'x', members: [] }]
  return w
}

describe('the number on the home tile', () => {
  it('is nothing when nothing is waiting', () => {
    expect(homeWaiting(world())).toBe(0)
  })

  it('counts somebody asking to be your friend', () => {
    const w = world()
    w.friends = [friend('pat', 'incoming')]
    expect(homeWaiting(w)).toBe(1)
  })

  it('but not one you sent, or one already accepted', () => {
    /* Neither is waiting on you. */
    const w = world()
    w.friends = [friend('pat', 'outgoing'), friend('sam', 'accepted')]
    expect(homeWaiting(w)).toBe(0)
  })

  it('and adds them to the messages waiting', () => {
    const w = world()
    w.unread.set('dm1', 3)
    w.friends = [friend('pat', 'incoming')]
    expect(homeWaiting(w)).toBe(4)
  })

  it('leaving a muted conversation out of it', () => {
    /* The point of muting one is not to be told, and a number is being told. */
    const w = world()
    w.unread.set('dm1', 3)
    w.muted.add('dm1')
    w.friends = [friend('pat', 'incoming')]
    expect(homeWaiting(w)).toBe(1)
  })
})
