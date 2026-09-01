import { describe, expect, it } from 'vitest'
import { apply, emptyWorld, remember, type World } from './world'
import type { Message, ServerChannel, User } from './wire'

const user = (id: string, over: Partial<User> = {}): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0, ...over,
})
const channel = (id: string, over: Partial<ServerChannel> = {}): ServerChannel => ({
  id, space_id: 'sp', name: id, kind: 'text', topic: '',
  category_id: null, position: 0, ...over,
})
const message = (id: string, channel_id = 'c1'): Message => ({
  id, channel_id, author_id: 'a', body: 'hi', created_at: 1, edited_at: null,
  deleted_at: null, kind: 'text', reply_to: null, pinned_at: null,
  reactions: [], attachments: [],
})

const world = (): World => {
  const w = emptyWorld(user('me'))
  w.messages.set('c1', [message('m1')])
  return w
}

describe('who is here', () => {
  it('takes a presence event as the fact it is', () => {
    const w = world()
    apply(w, { t: 'presence', userId: 'pat', online: true })
    expect(w.presence.statusFor('pat')).toBe('online')
    apply(w, { t: 'presence', userId: 'pat', online: false })
    expect(w.presence.statusFor('pat')).toBe('offline')
  })

  /* A profile change says nothing about a connection. Claiming otherwise
     made every rename blink somebody out and back. */
  it('and a profile change never makes somebody present or absent', () => {
    const w = world()
    apply(w, { t: 'member-update', user: user('pat', { presence: 'dnd' }) })
    expect(w.presence.statusFor('pat')).toBe('offline')

    apply(w, { t: 'presence', userId: 'pat', online: true })
    expect(w.presence.statusFor('pat')).toBe('busy')
  })

  it('remembers the newest row, so a fresh one corrects an older one', () => {
    const w = world()
    w.presence.setHere('pat', true)
    remember(w, user('pat', { presence: 'online' }))
    remember(w, user('pat', { presence: 'idle' }))
    expect(w.presence.statusFor('pat')).toBe('away')
  })
})

describe('messages', () => {
  it('adds one that arrives', () => {
    const w = world()
    apply(w, { t: 'message', message: message('m2') })
    expect(w.messages.get('c1')).toHaveLength(2)
  })

  it('does not add the same one twice, whichever name it came under', () => {
    const w = world()
    apply(w, { t: 'message', message: message('m2') })
    apply(w, { t: 'ack', message: message('m2') })
    expect(w.messages.get('c1')).toHaveLength(2)
  })

  /* Reactions, edits and undeletes all arrive as the whole message again,
     under one name. Nothing listened for it, so a reaction was invisible
     until the page was reloaded. */
  it('replaces one that changed, rather than adding it again', () => {
    const w = world()
    const edited = { ...message('m1'), body: 'edited' }
    apply(w, { t: 'message-update', message: edited })
    expect(w.messages.get('c1')).toHaveLength(1)
    expect(w.messages.get('c1')?.[0]?.body).toBe('edited')
  })

  /* The event carries only an id. The old client read a channel off it that
     was not there, compared null against the open one, and left the message
     on screen until a reload. */
  it('removes a deleted one without being told which channel it was in', () => {
    const w = world()
    apply(w, { t: 'message-delete', id: 'm1' })
    expect(w.messages.get('c1')).toHaveLength(0)
  })
})

describe('channels', () => {
  /* These carry the thing itself, so nothing needs fetching — which is what
     the frozen frame got wrong: it asked again, and got the photograph. */
  it('are added and changed from the event itself', () => {
    const w = world()
    expect(apply(w, { t: 'channel-created', channel: channel('c9') })).toEqual({})
    expect(w.channels.map((c) => c.id)).toContain('c9')

    apply(w, { t: 'channel-updated', channel: channel('c9', { name: 'renamed' }) })
    expect(w.channels.find((c) => c.id === 'c9')?.name).toBe('renamed')
    expect(w.channels.filter((c) => c.id === 'c9')).toHaveLength(1)
  })

  it('and removed', () => {
    const w = world()
    apply(w, { t: 'channel-created', channel: channel('c9') })
    apply(w, { t: 'channel-deleted', id: 'c9', spaceId: 'sp' })
    expect(w.channels.map((c) => c.id)).not.toContain('c9')
  })
})

describe('events that only say something happened', () => {
  /* Kept apart from the ones that carry the change, because asking for
     everything on every event is both wasteful and — with a frame that never
     refreshes — often wrong. */
  it('name what has to be asked for again', () => {
    const w = world()
    expect(apply(w, { t: 'roles-changed' })).toEqual({ refetch: 'roles' })
    expect(apply(w, { t: 'member-roles' })).toEqual({ refetch: 'roles' })
    expect(apply(w, { t: 'friends-changed' })).toEqual({ refetch: 'friends' })
    expect(apply(w, { t: 'member-joined' })).toEqual({ refetch: 'members' })
  })

  /* Reordering used to be in the list above, and it does not belong there:
     the event states the new order, and answering it with a refetch of the
     spaces reloaded the server rows rather than the channels in them. */
  it('put a reorder where the server put it, without asking', () => {
    const w = world()
    w.channels = [
      { id: 'a', space_id: 's', name: 'a', kind: 'text', position: 0 },
      { id: 'b', space_id: 's', name: 'b', kind: 'text', position: 1 },
      { id: 'x', space_id: 'other', name: 'x', kind: 'text', position: 0 },
    ] as World['channels']

    expect(apply(w, {
      t: 'channels-reordered',
      spaceId: 's',
      channels: [{ id: 'b', position: 0 }, { id: 'a', position: 1 }],
    })).toEqual({})

    expect(w.channels.map((c) => [c.id, c.position])).toEqual([['a', 1], ['b', 0], ['x', 0]])
  })

  it('while the ones that carry it ask for nothing', () => {
    const w = world()
    expect(apply(w, { t: 'channel-created', channel: channel('c9') }).refetch)
      .toBeUndefined()
    expect(apply(w, { t: 'message', message: message('m2') }).refetch)
      .toBeUndefined()
  })
})

describe('being told no', () => {
  /* Without this the message simply vanished out of the box and the channel
     carried on as though nothing had been tried. */
  it('is said out loud', () => {
    const w = world()
    expect(apply(w, { t: 'send-refused', detail: 'you cannot post there' }))
      .toEqual({ say: 'you cannot post there' })
  })
})
