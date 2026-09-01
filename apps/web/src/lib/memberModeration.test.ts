import { describe, expect, it } from 'vitest'
import { memberModerationFor } from './memberModeration'
import { emptyWorld, remember, type World } from './world'
import type { Role, Space, User } from './wire'

/**
 * Who may remove or bar whom, and where the app is allowed to offer it.
 *
 * Both already existed, several clicks into a server's settings. This is the
 * same two acts from the place anybody actually reaches for them - the person
 * themselves - so every condition here mirrors one the server enforces, and a
 * control that would be refused is absent rather than offered and then
 * failing.
 *
 * So the tests worth having are the ways to get nothing, not the one way to
 * get something: an item offered and then refused is invisible until somebody
 * presses it, and this one is not undone by pressing it again.
 */

const person = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default', name_effect: 'none',
  avatar_path: null, banner_path: null, status_text: '', presence: 'online',
  created_at: 0,
})

const space = {
  id: 'sp', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'boss', created_at: 0,
} as Space

const role = (over: Partial<Role> & { id: string }): Role => ({
  space_id: 'sp', name: over.id, colour: '', position: 0, permissions: '[]',
  kind: 'custom', hoist: 0, created_at: 0, ...over,
} as Role)

/** A world where `me` holds a role above `them`, both in the same server. */
function world(mine: string[], opts: { theirRole?: string } = {}): World {
  const w = emptyWorld(person('me'))
  remember(w, person('them'))
  remember(w, person('boss'))
  w.spaces = [space]
  w.roles = [
    role({ id: 'mods', position: 5 }),
    role({ id: 'plebs', position: 1 }),
    role({ id: 'everyone', kind: 'everyone', position: 0 }),
  ]
  w.assignments = [
    { user_id: 'me', role_id: 'mods' },
    ...(opts.theirRole ? [{ user_id: 'them', role_id: opts.theirRole }] : []),
  ]
  w.membersBySpace.set('sp', new Set(['me', 'them', 'boss']))
  w.held.setSpace('sp', mine, undefined)
  return w
}

describe('what may be done to somebody here', () => {
  it('offers both when you may remove and may bar', () => {
    const got = memberModerationFor(world(['kick_members', 'ban_members']), space, 'them')
    expect(got?.mayKick).toBe(true)
    expect(got?.mayBan).toBe(true)
    expect(got?.spaceId).toBe('sp')
  })

  /*
   * One is not the other. A kick ends the moment they click the invite
   * again; barring somebody does not end until a moderator ends it, and
   * trusting somebody with the first is not trusting them with the second.
   */
  it('and only removing with only kick_members', () => {
    const got = memberModerationFor(world(['kick_members']), space, 'them')
    expect(got?.mayKick).toBe(true)
    expect(got?.mayBan).toBe(false)
  })

  it('and only barring with only ban_members', () => {
    const got = memberModerationFor(world(['ban_members']), space, 'them')
    expect(got?.mayKick).toBe(false)
    expect(got?.mayBan).toBe(true)
  })
})

describe('and the ways to get nothing', () => {
  it('nothing with no server open', () => {
    expect(memberModerationFor(world(['kick_members', 'ban_members']), null, 'them'))
      .toBeNull()
  })

  it('nothing on yourself', () => {
    expect(memberModerationFor(world(['kick_members', 'ban_members']), space, 'me'))
      .toBeNull()
  })

  /*
   * And never on the person whose server it is, whatever you hold. The
   * server refuses it outright, and it is the one refusal somebody with
   * every permission would otherwise expect to work.
   */
  it('and never on whoever made it', () => {
    expect(memberModerationFor(world(['kick_members', 'ban_members']), space, 'boss'))
      .toBeNull()
  })

  /*
   * Somebody who is not in this server.
   *
   * The member list is drawn from the roster, so a name on screen is
   * normally in it - but the same menu opens from a message, and a message
   * can be from somebody who has since left. Removing somebody already gone
   * is refused, so it must not be offered.
   */
  it('and nothing on somebody who has left', () => {
    const w = world(['kick_members', 'ban_members'])
    w.membersBySpace.set('sp', new Set(['me', 'boss']))
    expect(memberModerationFor(w, space, 'them')).toBeNull()
  })

  it('and nothing without either permission', () => {
    expect(memberModerationFor(world(['send_messages', 'manage_messages']), space, 'them'))
      .toBeNull()
  })

  /*
   * Rank is strictly greater on the server, so equals cannot act on each
   * other - and two people holding no role are equals, which is the common
   * case in a server that has never made one.
   */
  it('and nothing on somebody you do not outrank', () => {
    expect(memberModerationFor(world(['kick_members', 'ban_members'], { theirRole: 'mods' }), space, 'them'))
      .toBeNull()
  })

  it('and nothing between two people who both hold no role', () => {
    const w = world(['kick_members', 'ban_members'])
    w.assignments = []
    expect(memberModerationFor(w, space, 'them')).toBeNull()
  })

  /* Somebody below you is still reachable - the rule is rank, not roles. */
  it('while somebody below you is', () => {
    const got = memberModerationFor(
      world(['kick_members', 'ban_members'], { theirRole: 'plebs' }), space, 'them')
    expect(got?.mayKick).toBe(true)
  })
})
