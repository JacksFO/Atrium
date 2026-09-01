import { describe, expect, it } from 'vitest'
import { namesMe } from './named'
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
