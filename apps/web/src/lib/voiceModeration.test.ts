import { describe, expect, it } from 'vitest'
import { voiceModerationFor } from './voiceModeration'
import { emptyWorld, remember, type World } from './world'
import type { Channel, Role, Space, User } from './wire'

/**
 * Who may silence whom, and where the app is allowed to offer it.
 *
 * Every condition here mirrors one the server enforces, and the point of
 * having them is that a control which would be refused is absent instead. So
 * the tests worth writing are the five ways to get nothing, not the one way
 * to get something: an item offered and then refused is the failure this
 * exists to avoid, and it is invisible until somebody presses it.
 */

const person = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})

const space: Space = {
  id: 'sp', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'boss', created_at: 0,
} as Space

const room = { id: 'vc', space_id: 'sp', name: 'General', kind: 'voice', position: 0 } as unknown as Channel
const dmRoom = { id: 'dm1', space_id: null, name: '', kind: 'dm', position: 0 } as unknown as Channel

const role = (over: Partial<Role> & { id: string }): Role => ({
  space_id: 'sp', name: over.id, colour: '', position: 0, permissions: '[]',
  kind: 'custom', hoist: 0, created_at: 0, ...over,
} as Role)

/**
 * A world where `me` holds a role above `them`, with whatever permissions
 * this test is about.
 */
function world(mine: string[], opts: { theirRole?: boolean } = {}): World {
  const w = emptyWorld(person('me'))
  remember(w, person('them'))
  w.spaces = [space]
  w.channels = [room, dmRoom]
  w.roles = [
    role({ id: 'mods', position: 5 }),
    role({ id: 'plebs', position: 1 }),
    role({ id: 'everyone', kind: 'everyone', position: 0 }),
  ]
  w.assignments = [
    { user_id: 'me', role_id: 'mods' },
    ...(opts.theirRole ? [{ user_id: 'them', role_id: 'plebs' }] : []),
  ]
  /* What the server says this account may do in that server. */
  w.held.setSpace('sp', mine, undefined)
  return w
}

const standing = (w: World, where = 'vc', over: Partial<{ serverMuted: boolean; serverDeafened: boolean }> = {}) => {
  w.voice.set('them', {
    channelId: where, muted: false, deafened: false,
    serverMuted: false, serverDeafened: false, sharing: false, ...over,
  })
  return w
}

describe('what may be done to somebody in a call', () => {
  it('offers both when you may silence and may move', () => {
    const got = voiceModerationFor(standing(world(['mute_members', 'move_members'])), 'them')
    expect(got?.maySilence).toBe(true)
    expect(got?.mayRemove).toBe(true)
    expect(got?.channelId).toBe('vc')
    expect(got?.spaceId).toBe('sp')
  })

  /* One permission is not the other. Silencing somebody mid-sentence and
     taking them out of the room are different acts and different switches. */
  it('and only silencing with only mute_members', () => {
    const got = voiceModerationFor(standing(world(['mute_members'])), 'them')
    expect(got?.maySilence).toBe(true)
    expect(got?.mayRemove).toBe(false)
  })

  it('and only removing with only move_members', () => {
    const got = voiceModerationFor(standing(world(['move_members'])), 'them')
    expect(got?.maySilence).toBe(false)
    expect(got?.mayRemove).toBe(true)
  })

  /* So a control can say the opposite of what is in force rather than
     guessing, which is what made the state worth carrying on the wire. */
  it('and says which way each is already set', () => {
    const w = standing(world(['mute_members']), 'vc', { serverMuted: true, serverDeafened: true })
    const got = voiceModerationFor(w, 'them')
    expect(got?.serverMuted).toBe(true)
    expect(got?.serverDeafened).toBe(true)
  })
})

describe('and the five ways to get nothing', () => {
  it('nothing when they are not in a call', () => {
    expect(voiceModerationFor(world(['mute_members', 'move_members']), 'them')).toBeNull()
  })

  /*
   * A conversation's call is between the two people in it. Reaching into one
   * to silence somebody is not what a server's moderator is for, and the
   * server refuses it - so it must not be offered.
   */
  it('nothing in somebody’s private call', () => {
    const w = standing(world(['mute_members', 'move_members']), 'dm1')
    expect(voiceModerationFor(w, 'them')).toBeNull()
  })

  it('nothing on yourself', () => {
    const w = standing(world(['mute_members', 'move_members']))
    w.voice.set('me', {
      channelId: 'vc', muted: false, deafened: false,
      serverMuted: false, serverDeafened: false, sharing: false,
    })
    expect(voiceModerationFor(w, 'me')).toBeNull()
  })

  it('nothing without either permission', () => {
    const w = standing(world(['send_messages', 'manage_messages']))
    expect(voiceModerationFor(w, 'them')).toBeNull()
  })

  /*
   * Rank is strictly greater on the server, so equals cannot moderate each
   * other. Two people with no roles are equals - which is the common case in
   * a server that has never made one, and the case a permission alone would
   * get wrong.
   */
  it('nothing on somebody you do not outrank', () => {
    const w = standing(world(['mute_members', 'move_members']))
    w.assignments = [{ user_id: 'them', role_id: 'mods' }]
    expect(voiceModerationFor(w, 'them')).toBeNull()
  })

  it('and nothing between two people who both hold no role', () => {
    const w = standing(world(['mute_members', 'move_members']))
    w.assignments = []
    expect(voiceModerationFor(w, 'them')).toBeNull()
  })

  /* And never on the owner, whatever you hold. */
  it('and never on the owner of the server', () => {
    const w = standing(world(['mute_members', 'move_members']))
    remember(w, person('boss'))
    w.voice.set('boss', {
      channelId: 'vc', muted: false, deafened: false,
      serverMuted: false, serverDeafened: false, sharing: false,
    })
    expect(voiceModerationFor(w, 'boss')).toBeNull()
  })

  /* A room this client has no record of is not a room to act on. */
  it('and nothing for a room it has never heard of', () => {
    const w = standing(world(['mute_members', 'move_members']), 'ghost')
    expect(voiceModerationFor(w, 'them')).toBeNull()
  })
})
