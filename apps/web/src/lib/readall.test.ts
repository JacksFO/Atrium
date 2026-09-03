import { describe, expect, it } from 'vitest'
import { waitingCount, waitingHere } from './readall'
import { emptyWorld, type World } from './world'
import type { Conversation } from './dms'
import type { Space, User } from './wire'

/**
 * What "read all" would clear.
 *
 * Scoped to where you are looking, and the original build learned this the
 * hard way: it counted every channel anywhere, so an unread conversation - or
 * something waiting in a completely different server - put a Read all button
 * in the header of a server with nothing unread in it at all.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}
const space = (id: string): Space => ({ id, name: id } as Space)
const chat = (id: string): Conversation =>
  ({ id, name: id, others: [], group: false, peer: null })

function world(): World {
  const w = emptyWorld(me)
  w.channels = [
    { id: 'a1', name: 'general', space_id: 's1' } as never,
    { id: 'a2', name: 'clips', space_id: 's1' } as never,
    { id: 'b1', name: 'other', space_id: 's2' } as never,
  ]
  return w
}

describe('what read all would clear', () => {
  it('is this server, and only this server', () => {
    const w = world()
    w.unread.set('a1', 3)
    w.unread.set('b1', 9)
    expect(waitingHere(w, space('s1'), [])).toEqual(['a1'])
  })

  /* A conversation belongs to no server. Counting it against one is how the
     button appeared in a server with nothing unread in it. */
  it('and never a conversation while you are in a server', () => {
    const w = world()
    w.unread.set('d1', 4)
    expect(waitingHere(w, space('s1'), [chat('d1')])).toEqual([])
  })

  it('and the conversations when you are not in a server', () => {
    const w = world()
    w.unread.set('d1', 4)
    w.unread.set('a1', 3)
    expect(waitingHere(w, null, [chat('d1')])).toEqual(['d1'])
  })

  /* Somebody who muted a channel has said they do not want telling about it,
     and a button that clears it is a button that had to count it first. */
  it('and leaves a muted channel alone', () => {
    const w = world()
    w.unread.set('a1', 3)
    /* Set where the app sets it. `muted` is a convenience copy derived from
       the preferences, and asking the preferences is what lets a muted
       server behave the same way as a muted channel. */
    w.prefs.set('a1', { channelId: 'a1', level: 'default', mutedUntil: Date.now() + 60_000 })
    w.muted.add('a1')
    expect(waitingHere(w, space('s1'), [])).toEqual([])
  })

  /*
   * And one in a muted server, so a mute behaves the same way whichever of
   * the two it was set on. It could not, while this asked a set that only
   * ever held channel ids.
   */
  it('and a channel in a muted server', () => {
    const w = world()
    w.unread.set('a1', 3)
    w.spacePrefs.set('s1', {
      spaceId: 's1', level: 'all', mutedUntil: Date.now() + 60_000, suppressEveryone: false,
    })
    expect(waitingHere(w, space('s1'), [])).toEqual([])
  })

  it('and nothing at all when nothing is waiting', () => {
    expect(waitingHere(world(), space('s1'), [])).toEqual([])
  })

  it('and counts what it would clear', () => {
    const w = world()
    w.unread.set('a1', 3)
    w.unread.set('a2', 5)
    const ids = waitingHere(w, space('s1'), [])
    expect(ids).toHaveLength(2)
    expect(waitingCount(w, ids)).toBe(8)
  })
})
