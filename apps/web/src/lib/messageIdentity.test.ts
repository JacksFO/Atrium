import { describe, expect, it } from 'vitest'
import { apply, emptyWorld, type World } from './world'
import type { Message, User } from './wire'

/**
 * A channel's messages are a new list every time they change.
 *
 * Everything else in the world is mutated in place and announced with a
 * counter, which is right for values read as they are drawn. A list is the
 * exception, because it is the one thing React can compare cheaply: while it
 * was pushed into, the array handed to the message list was the same array
 * before and after, so nothing could be memoised on it.
 *
 * Measured before this: adding one message to a channel with five hundred
 * loaded redrew all five hundred, 119 ms of work in jsdom to add one of them.
 * Copying the pointers is a few microseconds. Said as a test because a push
 * is the obvious thing to write and reads as harmless.
 */

const user = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, channel_id: 'c1', author_id: 'pat', body: 'hello', created_at: 1,
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [], ...over,
})

function loaded(): { w: World; before: readonly Message[] } {
  const w = emptyWorld(user('me'))
  w.messages.set('c1', [msg('m1'), msg('m2')])
  return { w, before: w.messages.get('c1')! }
}

const now = (w: World) => w.messages.get('c1')!

describe('a message arriving', () => {
  it('leaves a different list behind', () => {
    const { w, before } = loaded()
    apply(w, { t: 'message', message: msg('m3') } as never)
    expect(now(w)).not.toBe(before)
    expect(now(w).map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('and one already there changes nothing at all', () => {
    /* A duplicate is not a change, so it must not look like one either. */
    const { w, before } = loaded()
    apply(w, { t: 'message', message: msg('m2') } as never)
    expect(now(w)).toBe(before)
  })
})

describe('a message being edited', () => {
  it('leaves a different list behind', () => {
    const { w, before } = loaded()
    apply(w, { t: 'message-update', message: msg('m2', { body: 'changed' }) } as never)
    expect(now(w)).not.toBe(before)
    expect(now(w)[1]?.body).toBe('changed')
    expect(now(w)).toHaveLength(2)
  })
})

describe('a message being deleted', () => {
  it('leaves a different list behind', () => {
    const { w, before } = loaded()
    apply(w, { t: 'message-delete', id: 'm1' } as never)
    expect(now(w)).not.toBe(before)
    expect(now(w).map((m) => m.id)).toEqual(['m2'])
  })

  it('and only touches the channel it was in', () => {
    const { w } = loaded()
    w.messages.set('c2', [msg('x1', { channel_id: 'c2' })])
    const other = w.messages.get('c2')!
    apply(w, { t: 'message-delete', id: 'm1' } as never)
    expect(w.messages.get('c2')).toBe(other)
  })
})
