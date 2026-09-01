import { describe, expect, it } from 'vitest'
import { ago, whatWaits } from './waiting'
import { emptyWorld, type World } from './world'
import type { Conversation } from './dms'
import type { User } from './wire'

/**
 * What was said while you were away.
 *
 * The home page promised this in its own doc comment and drew a grid of the
 * same conversations already listed down the left instead - which answers a
 * question nobody standing on the home page is asking.
 *
 * Nothing here is fetched. The server counts what is waiting at sign-in and
 * says which of it names you; this arranges what is already held.
 */

const me: User = {
  id: 'me', username: 'sam', discriminator: '0001', verified: 0,
  display_name: 'Sam', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

const chat = (id: string, name: string): Conversation =>
  ({ id, name, others: [], group: false, peer: null })

function world(): World {
  const w = emptyWorld(me)
  w.spaces = [{ id: 's1', name: 'Somewhere' } as never]
  w.channels = [
    { id: 'c1', name: 'general', space_id: 's1' } as never,
    { id: 'c2', name: 'clips', space_id: 's1' } as never,
  ]
  return w
}

describe('what was waiting', () => {
  it('names a channel and the server it is in', () => {
    const w = world()
    w.unread.set('c1', 3)
    w.lastAt.set('c1', 1000)

    const [row] = whatWaits(w, [])
    expect(row?.where).toBe('#general')
    expect(row?.space).toBe('Somewhere')
    expect(row?.count).toBe(3)
  })

  it('and a conversation by who it is with', () => {
    const w = world()
    w.unread.set('d1', 1)
    const [row] = whatWaits(w, [chat('d1', 'Morticia')])
    expect(row?.where).toBe('Morticia')
    expect(row?.space).toBeNull()
    expect(row?.kind).toBe('dm')
  })

  /* The whole reason for marking one. Something naming you from this morning
     matters more than small talk from a minute ago. */
  it('puts anything naming you first, however old', () => {
    const w = world()
    w.unread.set('c1', 1); w.lastAt.set('c1', 1)
    w.unread.set('c2', 1); w.lastAt.set('c2', 9999)
    w.mentioned.add('c1')

    expect(whatWaits(w, []).map((r) => r.where)).toEqual(['#general', '#clips'])
  })

  it('and the rest newest first', () => {
    const w = world()
    w.unread.set('c1', 1); w.lastAt.set('c1', 10)
    w.unread.set('c2', 1); w.lastAt.set('c2', 20)
    expect(whatWaits(w, []).map((r) => r.where)).toEqual(['#clips', '#general'])
  })

  /* Somebody who muted a channel has already said they do not want telling.
     Showing it here would be the app arguing with them. */
  it('leaves out a channel that was muted', () => {
    const w = world()
    w.unread.set('c1', 5)
    w.muted.add('c1')
    expect(whatWaits(w, [])).toEqual([])
  })

  /* A count of nothing is not something waiting. */
  it('and one with nothing in it', () => {
    const w = world()
    w.unread.set('c1', 0)
    expect(whatWaits(w, [])).toEqual([])
  })

  /* Naming it "somewhere" would be worse than leaving it out. */
  it('and one this client has never heard of', () => {
    const w = world()
    w.unread.set('ghost', 4)
    expect(whatWaits(w, [])).toEqual([])
  })

  it('and stops at the number asked for', () => {
    const w = world()
    w.channels = Array.from({ length: 10 }, (_, i) =>
      ({ id: `x${i}`, name: `room${i}`, space_id: 's1' }) as never)
    for (let i = 0; i < 10; i++) { w.unread.set(`x${i}`, 1); w.lastAt.set(`x${i}`, i) }
    expect(whatWaits(w, [], 4)).toHaveLength(4)
  })
})

describe('how long ago', () => {
  const now = Date.parse('2026-08-29T12:00:00Z')
  it('says it in the fewest words that are still true', () => {
    expect(ago(now - 20_000, now)).toBe('just now')
    expect(ago(now - 5 * 60_000, now)).toBe('5m ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d ago')
  })

  /* Past a week "412d ago" is arithmetic, not an answer. */
  it('and gives a date once that stops being useful', () => {
    expect(ago(now - 40 * 86_400_000, now)).toMatch(/[A-Za-z]/)
  })

  it('and says nothing when it never happened', () => {
    expect(ago(0, now)).toBe('')
  })
})
