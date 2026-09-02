import { describe, expect, it } from 'vitest'
import { Presences, presenceOf, statusOf } from './presence'

/* Each of these is a bug the old client actually shipped. They are written as
   the fault rather than as the feature, so that a future change that brings
   one back says which one. */

describe('the two words for the same four states', () => {
  it('reads the server\'s words as ours', () => {
    expect(statusOf('idle')).toBe('away')
    expect(statusOf('dnd')).toBe('busy')
    expect(statusOf('online')).toBe('online')
    expect(statusOf('offline')).toBe('offline')
  })

  it('and says ours back in theirs', () => {
    expect(presenceOf('away')).toBe('idle')
    expect(presenceOf('busy')).toBe('dnd')
  })

  /* A presence event carries a boolean, not a word. Read as a word it was
     undefined, and every dot in the app stayed the colour it was drawn. */
  it('treats a missing word as being here, not as nothing', () => {
    expect(statusOf(undefined)).toBe('online')
  })
})

describe('who is here', () => {
  it('is offline until something says otherwise', () => {
    const p = new Presences()
    expect(p.statusFor('a')).toBe('offline')
  })

  it('takes the opening list, and one person at a time after it', () => {
    const p = new Presences()
    p.replaceHere(['a', 'b'])
    expect(p.statusFor('a')).toBe('online')
    p.setHere('a', false)
    expect(p.statusFor('a')).toBe('offline')
    expect(p.statusFor('b')).toBe('online')
  })

  /* The one that flickered: a member of a server who had chosen Busy. The
     roster knew the word, the map did not, and the map was applied second. */
  it('shows what somebody chose, once anything has said what that is', () => {
    const p = new Presences()
    p.replaceHere(['a'])
    expect(p.statusFor('a')).toBe('online')
    p.remember({ id: 'a', presence: 'dnd' })
    expect(p.statusFor('a')).toBe('busy')
  })

  /* Newest wins, so the caller feeds the oldest source first. Remembering the
     sign-in snapshot of yourself after a fresh roster is what put your own
     name back to plain Online a frame after drawing it correctly. */
  it('lets a later row correct an earlier one', () => {
    const p = new Presences()
    p.replaceHere(['a'])
    p.remember({ id: 'a', presence: 'online' })
    p.remember({ id: 'a', presence: 'idle' })
    expect(p.statusFor('a')).toBe('away')
  })

  /* A chosen status is not a claim to be present. Saying `offline` for
     somebody the online list had not caught up on turned every rename into
     that person blinking out and back. */
  it('never lets a chosen word make somebody present', () => {
    const p = new Presences()
    p.remember({ id: 'a', presence: 'online' })
    expect(p.statusFor('a')).toBe('offline')
  })

  it('answers for everybody at once the same way it answers for one', () => {
    const p = new Presences()
    p.replaceHere(['a', 'b'])
    p.remember({ id: 'b', presence: 'dnd' })
    const all = p.all()
    expect(all.get('a')).toBe(p.statusFor('a'))
    expect(all.get('b')).toBe(p.statusFor('b'))
    expect(all.get('b')).toBe('busy')
  })
})

/**
 * How somebody chooses to appear.
 *
 * Every part of this was already here - the column on the account, the four
 * words the server accepts, the mapping into the ones on screen, and a store
 * that reads a chosen presence off any row it is given. What was missing was
 * anywhere to choose one, so everybody was permanently "online" and Do Not
 * Disturb existed only as a value nothing ever set.
 */
describe('choosing how you appear', () => {
  it('is remembered from the row, whatever it says', () => {
    const p = new Presences()
    p.replaceHere(['u1'])
    p.remember({ id: 'u1', presence: 'dnd' })
    expect(p.statusFor('u1')).toBe('busy')
  })

  it('and away is away', () => {
    const p = new Presences()
    p.replaceHere(['u1'])
    p.remember({ id: 'u1', presence: 'idle' })
    expect(p.statusFor('u1')).toBe('away')
  })

  /*
   * Appearing offline is a choice, not a claim about the app.
   *
   * Somebody who has chosen it has a socket open like anybody else - they are
   * in `here` - so the only thing that makes them look gone is the value they
   * picked being read.
   */
  it('and appearing offline works while the app is plainly running', () => {
    const p = new Presences()
    p.replaceHere(['u1'])
    p.remember({ id: 'u1', presence: 'offline' })
    expect(p.isHere('u1'), 'they are connected either way').toBe(true)
    expect(p.statusFor('u1'), 'the choice was not read').toBe('offline')
  })

  /* And somebody who has closed the app is offline whatever they chose. */
  it('but choosing online does not keep somebody here', () => {
    const p = new Presences()
    p.remember({ id: 'u1', presence: 'online' })
    expect(p.statusFor('u1')).toBe('offline')
  })
})
