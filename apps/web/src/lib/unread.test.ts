import { describe, expect, it } from 'vitest'
import { applyReady, apply, emptyWorld, type World } from './world'
import type { Message, ReadyFrame, User } from './wire'

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

const frame = (unread: ReadyFrame['unread']): ReadyFrame => ({
  t: 'ready', user: me, members: [], channels: [], categories: [], roles: [],
  assignments: [], online: [], voice: [], unread, channelPrefs: [],
  permissionsBySpace: {}, channelPermissions: {}, looseOrder: {}, activities: {},
})

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', channel_id: 'c1', author_id: 'pat', body: 'hi', created_at: 1,
  edited_at: null, deleted_at: null, kind: 'text', reply_to: null,
  pinned_at: null, reactions: [], attachments: [], ...over,
})

const world = (unread: ReadyFrame['unread'] = []): World => {
  const w = emptyWorld(me)
  applyReady(w, frame(unread))
  return w
}

describe('what the opening frame says is waiting', () => {
  /*
   * `channelId`, which is what the server's own query aliases it to. The type
   * here said `channel_id` — read that way every entry comes back undefined
   * and every badge is drawn on nothing. It had never bitten because nothing
   * read it yet.
   */
  it('is read under the name the server sends it under', () => {
    const w = world([{ channelId: 'c1', count: 3 }])
    expect(w.unread.get('c1')).toBe(3)
  })

  it('and an entry naming no channel is left out rather than filed under nothing', () => {
    const w = world([{ channelId: '', count: 3 }])
    expect(w.unread.size).toBe(0)
  })
})

describe('a message arriving', () => {
  it('adds to what is waiting there', () => {
    const w = world()
    apply(w, { t: 'message', message: msg() })
    apply(w, { t: 'message', message: msg({ id: 'm2' }) })
    expect(w.unread.get('c1')).toBe(2)
  })

  /* Your own coming back is not something to be told about — counted, it puts
     a badge on the channel you are typing in, which reads as the app having
     lost track of what you just did. */
  it('but not your own', () => {
    const w = world()
    apply(w, { t: 'message', message: msg({ author_id: 'me' }) })
    expect(w.unread.get('c1')).toBeUndefined()
  })

  it('and somewhere else does not touch this one', () => {
    const w = world([{ channelId: 'c1', count: 2 }])
    apply(w, { t: 'message', message: msg({ channel_id: 'c2' }) })
    expect(w.unread.get('c1')).toBe(2)
    expect(w.unread.get('c2')).toBe(1)
  })
})

describe('reading a channel', () => {
  /*
   * The server says so out loud, to every window this account has open —
   * cleared only locally, two windows would disagree, and the next reload
   * would side with whichever one the server had heard from.
   */
  it('clears it, and only it', () => {
    const w = world([{ channelId: 'c1', count: 4 }, { channelId: 'c2', count: 1 }])
    apply(w, { t: 'read', channelId: 'c1', at: 5 })
    expect(w.unread.get('c1')).toBeUndefined()
    expect(w.unread.get('c2')).toBe(1)
  })

  /* The event was declared as carrying nothing at all — the same shape of
     mistake as the permissions one — which says something was read without
     saying what, and clears nothing. */
  it('and the event carries which channel it was', () => {
    const e = { t: 'read', channelId: 'c1', at: 5 } as const
    expect(e.channelId).toBe('c1')
  })
})

describe('a muted channel', () => {
  const framed = (prefs: ReadyFrame['channelPrefs']) => {
    const w = emptyWorld(me)
    applyReady(w, { ...frame([]), channelPrefs: prefs })
    return w
  }

  /*
   * `channelId` and `mutedUntil`. This read `channel_id` and `muted`, neither
   * of which is on the wire — so every row read as nothing and no channel was
   * ever muted, however many times somebody muted it. The same mistake was in
   * the other client, in both directions at once, which is why neither half
   * could reveal the other.
   */
  it('is read under the names the server sends', () => {
    const w = framed([{ channelId: 'c1', level: 'default', mutedUntil: 99 }])
    expect(w.muted.has('c1')).toBe(true)
  })

  /* A level of `nothing` is muted by another name, and the server sends rows
     for either reason. */
  it('and is muted by its level as well as by a time', () => {
    const w = framed([{ channelId: 'c1', level: 'nothing', mutedUntil: null }])
    expect(w.muted.has('c1')).toBe(true)
  })

  /* A row can be sent for having a level worth keeping without being muted at
     all — read as muted, turning notifications up would turn them off. */
  it('while a row that says nothing about muting is not muted', () => {
    const w = framed([{ channelId: 'c1', level: 'all', mutedUntil: null }])
    expect(w.muted.has('c1')).toBe(false)
  })
})
