import { describe, expect, it } from 'vitest'
import { apply, applyReady, emptyWorld } from './world'
import type { ReadyFrame, ServerEvent, User } from './wire'

/**
 * Who is standing in a voice room, before you decide to go in.
 *
 * The server has sent this all along. The client kept the watch lists out of
 * it and dropped everything else, so a room you were not in read as empty
 * however many people were in it - the only roster it had came from the call
 * itself, and you have one of those only once you have joined.
 */

const me = { id: 'me', username: 'me', display_name: 'Me' } as User

const occupancy = (occupants: Array<Record<string, unknown>>): ServerEvent =>
  ({ t: 'voice-state', occupants }) as unknown as ServerEvent

describe('the occupancy of a voice room', () => {
  it('says who is in which room', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general' },
      { userId: 'u2', channelId: 'gaming' },
    ]))
    expect(w.voice.get('u1')?.channelId).toBe('general')
    expect(w.voice.get('u2')?.channelId).toBe('gaming')
  })

  it('and what they are doing in there', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general', muted: true, sharing: true, deafened: false },
    ]))
    expect(w.voice.get('u1')).toEqual({
      channelId: 'general', muted: true, deafened: false, sharing: true,
      serverMuted: false, serverDeafened: false,
    })
  })

  /*
   * And who did the silencing, which is a different fact from being silent.
   *
   * The server has sent both of these since voice was written and this kept
   * neither, so the app could not tell somebody who had muted themselves from
   * somebody a moderator had muted - and could not draw a control that knew
   * which way it was already set.
   */
  it('and whether a moderator did it to them', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general', muted: true, serverMuted: true },
      { userId: 'u2', channelId: 'general', muted: true },
    ]))
    expect(w.voice.get('u1')).toMatchObject({ muted: true, serverMuted: true })
    /* Silent by their own hand. The two must not read the same. */
    expect(w.voice.get('u2')).toMatchObject({ muted: true, serverMuted: false })
  })

  it('and the same for being deafened', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general', deafened: true, serverDeafened: true },
      { userId: 'u2', channelId: 'general', deafened: true },
    ]))
    expect(w.voice.get('u1')).toMatchObject({ serverDeafened: true })
    expect(w.voice.get('u2')).toMatchObject({ serverDeafened: false })
  })

  it('taking silence for no rather than for missing', () => {
    /* An older server sends only the fields it has. Absent is not sharing. */
    const w = emptyWorld(me)
    apply(w, occupancy([{ userId: 'u1', channelId: 'general' }]))
    expect(w.voice.get('u1')).toMatchObject({ muted: false, sharing: false })
  })

  it('and forgets whoever has left, rather than letting them linger', () => {
    /* Every one of these carries the whole occupancy, so it is rebuilt and
       not merged - somebody who walked out has no entry to overwrite. */
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general' },
      { userId: 'u2', channelId: 'general' },
    ]))
    apply(w, occupancy([{ userId: 'u2', channelId: 'general' }]))
    expect(w.voice.has('u1')).toBe(false)
    expect(w.voice.has('u2')).toBe(true)
  })

  it('and empties out when the last person goes', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([{ userId: 'u1', channelId: 'general' }]))
    apply(w, occupancy([]))
    expect(w.voice.size).toBe(0)
  })

  it('while still keeping the watch lists it always kept', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([
      { userId: 'u1', channelId: 'general', watching: ['share:u2'] },
      { userId: 'u2', channelId: 'general' },
    ]))
    expect(w.watchers.get('u1')).toEqual(['share:u2'])
    expect(w.watchers.has('u2'), 'nothing watched, nothing kept').toBe(false)
  })
})

describe('and at the moment of connecting', () => {
  /*
   * Which is every reload. The frame has carried this from the start and
   * nothing read it, so each room went back to looking empty until the next
   * person moved - and occupancy is announced on a change and only on a
   * change, so with nobody moving it stayed empty.
   */
  const ready = (voice: Array<Record<string, unknown>>): ReadyFrame =>
    ({ user: me, voice }) as unknown as ReadyFrame

  it('reads who was already in a room', () => {
    const w = emptyWorld(me)
    applyReady(w, ready([
      { userId: 'u1', channelId: 'general', muted: true, sharing: false },
    ]))
    expect(w.voice.get('u1')).toMatchObject({ channelId: 'general', muted: true })
  })

  it('and takes the older spelling of the same thing', () => {
    /* The frame has said user_id/channel_id and `deaf` in places, and nothing
       read either for long enough that both are still out there. */
    const w = emptyWorld(me)
    applyReady(w, ready([{ user_id: 'u1', channel_id: 'general', deaf: true }]))
    expect(w.voice.get('u1')).toMatchObject({ channelId: 'general', deafened: true })
  })

  it('and skips an entry that names nobody or nowhere', () => {
    const w = emptyWorld(me)
    applyReady(w, ready([{ channelId: 'general' }, { userId: 'u2' }]))
    expect(w.voice.size).toBe(0)
  })

  it('replacing whatever was known before, rather than adding to it', () => {
    const w = emptyWorld(me)
    apply(w, occupancy([{ userId: 'old', channelId: 'general' }]))
    applyReady(w, ready([{ userId: 'u1', channelId: 'general' }]))
    expect(w.voice.has('old')).toBe(false)
    expect(w.voice.has('u1')).toBe(true)
  })
})
