import { describe, expect, it } from 'vitest'
import { isNamed, namesMe } from './named'
import { emptyWorld, type World } from './world'
import type { User } from './wire'

/**
 * Whether a message names you.
 *
 * The server decides this at sign-in and is the authority; this answers the
 * same question for a message that has just arrived. It mirrors the server's
 * rule - @ then a username, a mentionable role you hold, or the two broadcast
 * words, ending on a word boundary - rather than inventing a looser one.
 *
 * It errs towards no. A mark that fires when nobody named you teaches people
 * to ignore the mark; a mark that is missed is corrected by the next sign-in.
 */

const me: User = {
  id: 'u1', username: 'sam', discriminator: '0001', verified: 0,
  display_name: 'Sam', bio: '', accent: '', accent_2: '',
  name_font: 'default', name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

function world(over: Partial<World> = {}): World {
  return { ...emptyWorld(me), ...over }
}

describe('a message that names you', () => {
  it('by your username', () => {
    expect(namesMe('hey @sam are you about', world())).toBe(true)
  })

  it('and at the very end of a message', () => {
    expect(namesMe('this one is for @sam', world())).toBe(true)
  })

  it('and by the broadcast words', () => {
    expect(namesMe('@everyone stand up', world())).toBe(true)
    expect(namesMe('@here now please', world())).toBe(true)
  })

  it('and by a role you hold', () => {
    expect(namesMe('@mods look at this', world({
      roles: [{ id: 'r1', name: 'mods', kind: 'custom', mentionable: 1 } as never],
      assignments: [{ user_id: 'u1', role_id: 'r1' } as never],
    }))).toBe(true)
  })
})

describe('but a message that does not', () => {
  it('with no @ at all', () => {
    expect(namesMe('sam was here', world())).toBe(false)
  })

  /* The reason the server sorts longest first, and the reason this does. */
  it('when your name only begins a longer one', () => {
    expect(namesMe('tell @sammy about it', world())).toBe(false)
  })

  it('when it names somebody else', () => {
    expect(namesMe('@keeko your turn', world())).toBe(false)
  })

  /* Holding the role is the point - naming a role you are not in is not
     about you. */
  it('when the role named is one you do not hold', () => {
    expect(namesMe('@mods look at this', world({
      roles: [{ id: 'r1', name: 'mods', kind: 'custom', mentionable: 1 } as never],
      assignments: [],
    }))).toBe(false)
  })

  /* A role nobody may name is not a way to reach people. */
  it('and when the role cannot be named', () => {
    expect(namesMe('@mods look at this', world({
      roles: [{ id: 'r1', name: 'mods', kind: 'custom', mentionable: 0 } as never],
      assignments: [{ user_id: 'u1', role_id: 'r1' } as never],
    }))).toBe(false)
  })

  /* Everybody holds it, so it would mark every message in the server. The
     word @everyone above is the way to reach everybody. */
  it('and never because you hold @everyone', () => {
    expect(namesMe('@everyonewho is about', world({
      roles: [{ id: 'r0', name: 'everyone', kind: 'everyone', mentionable: 1 } as never],
      assignments: [{ user_id: 'u1', role_id: 'r0' } as never],
    }))).toBe(false)
  })
})

/**
 * And whether anything waiting in a channel names you, either way.
 *
 * Two sets, because being named personally and being caught by an @everyone
 * are different things and a server can have broadcasts turned off. Folded
 * into one, suppressing them silenced the sound and left the badge exactly
 * where it was.
 */
describe('whether a channel holds something naming you', () => {
  it('is no when nothing does', () => {
    expect(isNamed(world(), 'c1')).toBe(false)
  })

  it('and yes when something names you personally', () => {
    const w = world()
    w.mentioned.add('c1')
    expect(isNamed(w, 'c1')).toBe(true)
  })

  /* An @everyone that has not been suppressed is still being named - the
     server leaves the suppressed ones out of what it sends, so anything in
     this set is worth a badge. */
  it('and yes when an @everyone caught you', () => {
    const w = world()
    w.mentionedWidely.add('c1')
    expect(isNamed(w, 'c1')).toBe(true)
  })

  it('and is about that channel and no other', () => {
    const w = world()
    w.mentioned.add('c1')
    expect(isNamed(w, 'c2')).toBe(false)
  })

  /*
   * And the setting reaches the badge.
   *
   * This is the defect the two sets were split for. Suppressing @everyone
   * was honoured where the sound is decided and nowhere else, so a server
   * with broadcasts turned off went quiet and kept its red numbers - which
   * is exactly what somebody turning it off was trying to stop.
   */
  it('and an @everyone stops counting where broadcasts are suppressed', () => {
    const w = world()
    w.mentionedWidely.add('c1')
    w.spacePrefs.set('s1', { spaceId: 's1', level: 'all', mutedUntil: null, suppressEveryone: true })
    expect(isNamed(w, 'c1', 's1')).toBe(false)
  })

  /* But suppressing it never hides something addressed to you personally,
     the same way it does not for the sound. */
  it('and never hides a message that names you', () => {
    const w = world()
    w.mentioned.add('c1')
    w.spacePrefs.set('s1', { spaceId: 's1', level: 'all', mutedUntil: null, suppressEveryone: true })
    expect(isNamed(w, 'c1', 's1')).toBe(true)
  })

  /* And it is the server the channel is in that decides, not any server. */
  it('and takes the setting from that server alone', () => {
    const w = world()
    w.mentionedWidely.add('c1')
    w.spacePrefs.set('s2', { spaceId: 's2', level: 'all', mutedUntil: null, suppressEveryone: true })
    expect(isNamed(w, 'c1', 's1')).toBe(true)
  })
})
