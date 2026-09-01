import { describe, expect, it } from 'vitest'
import { nameIn, nameOfId, nicknameIn } from './names'
import { emptyWorld, remember, type World } from './world'
import type { User } from './wire'

/**
 * The name somebody is drawn under, and where it stops.
 *
 * There used to be six copies of `u.nickname || u.display_name || u.username`
 * written out at the places that needed a name, which was fine while a
 * nickname was one column on the account. It is what one server calls
 * somebody now, so asking for a name without saying where is a question with
 * no answer - and the six copies would each have had to remember that.
 *
 * The tests worth having are the boundary ones. A nickname that leaks into
 * another server, or into a conversation, is the exact bug this replaced and
 * it is invisible from inside the server that set it.
 */

const person = (id: string, display: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: display,
  bio: '', accent: '', accent_2: '', name_font: 'default', name_effect: 'none',
  avatar_path: null, banner_path: null, status_text: '',
  presence: 'online', created_at: 0,
})

function world(): World {
  const w = emptyWorld(person('me', 'Me'))
  remember(w, person('pat', 'Pat'))
  w.nicknames.set('here', new Map([['pat', 'Patricia']]))
  return w
}

describe('what somebody is called', () => {
  it('is what this server calls them', () => {
    expect(nameIn(world(), 'here', person('pat', 'Pat'))).toBe('Patricia')
  })

  /* The one that fails if a nickname goes back onto the record. */
  it('and their own name in a server that has not renamed them', () => {
    expect(nameIn(world(), 'elsewhere', person('pat', 'Pat'))).toBe('Pat')
  })

  /*
   * A conversation belongs to nobody, so nothing a server decided reaches
   * it. Two people talking see the names they chose for themselves, whatever
   * a server they both happen to be in calls one of them.
   */
  it('and their own name in a conversation', () => {
    expect(nameIn(world(), null, person('pat', 'Pat'))).toBe('Pat')
  })

  /* And the username when there is nothing else, which is not an error -
     display_name is set at sign-up and can be cleared. */
  it('and their username when they have no display name', () => {
    expect(nameIn(world(), null, person('pat', ''))).toBe('pat')
  })
})

describe('somebody the app has not heard of', () => {
  /*
   * Not an error either. A message from somebody whose record has not
   * arrived is the ordinary case for the moment before a server's members
   * land, and it resolves by itself.
   */
  it('is named rather than crashed on', () => {
    expect(nameOfId(world(), 'here', 'nobody')).toBe('Someone')
  })

  it('and a known one is named the way this server names them', () => {
    expect(nameOfId(world(), 'here', 'pat')).toBe('Patricia')
    expect(nameOfId(world(), null, 'pat')).toBe('Pat')
  })
})

describe('the override on its own', () => {
  /*
   * For the box that edits it, which has to start empty when there is no
   * nickname - otherwise saving without touching it pins their own name as a
   * nickname, and clearing it becomes impossible to tell from setting it.
   */
  it('is empty when there is none, rather than their name', () => {
    expect(nicknameIn(world(), 'here', 'pat')).toBe('Patricia')
    expect(nicknameIn(world(), 'elsewhere', 'pat')).toBe('')
    expect(nicknameIn(world(), null, 'pat')).toBe('')
  })
})

describe('when a server renames somebody', () => {
  it('the change lands in that server and no other', () => {
    const w = world()
    w.nicknames.set('elsewhere', new Map())

    /* The frame the server sends, applied the way the reducer applies it. */
    const here = w.nicknames.get('here')!
    here.set('pat', 'Trish')

    expect(nameIn(w, 'here', person('pat', 'Pat'))).toBe('Trish')
    expect(nameIn(w, 'elsewhere', person('pat', 'Pat'))).toBe('Pat')
  })
})
