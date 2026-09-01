import { describe, expect, it } from 'vitest'
import { firstInvite, invitesIn } from './invites'

/* Both prefixes are live: `at-` is what is handed out now, `jc-` is what
   every code issued before the rename carries - and those are still in the
   database and in messages people have already sent. */
describe('spotting an invite in a message', () => {
  it('finds the one the server sends', () => {
    expect(firstInvite('Join Somewhere: jc-1a2b3c4d')).toBe('jc-1a2b3c4d')
  })

  it('finds one on its own', () => {
    expect(firstInvite('jc-deadbeef')).toBe('jc-deadbeef')
  })

  it('finds one in a link', () => {
    expect(firstInvite('come on https://atriumapp.duckdns.org/invite/jc-00ff11aa please'))
      .toBe('jc-00ff11aa')
  })

  it('finds one in the middle of a sentence', () => {
    expect(firstInvite('use jc-abcdef01 before it runs out')).toBe('jc-abcdef01')
  })

  /*
   * The point of anchoring. A code is eight hex characters, and eight hex
   * characters turn up inside other things - a colour, an id, the tail of a
   * filename. Matching those would put a card offering to join a server
   * under a message about none of it.
   */
  it('is not fooled by something longer that contains one', () => {
    expect(firstInvite('jc-1a2b3c4d5e')).toBe(null)
    expect(firstInvite('xjc-1a2b3c4d')).toBe(null)
    expect(firstInvite('jc-1a2b3c4-d')).toBe(null)
  })

  it('ignores something that is not hex', () => {
    expect(firstInvite('jc-zzzzzzzz')).toBe(null)
  })

  it('ignores a code that is too short', () => {
    expect(firstInvite('jc-1a2b')).toBe(null)
  })

  it('says nothing about an ordinary message', () => {
    expect(firstInvite('shall we play tonight')).toBe(null)
    expect(firstInvite('')).toBe(null)
  })

  it('reads the same code in either case', () => {
    expect(firstInvite('JC-1A2B3C4D')).toBe('jc-1a2b3c4d')
  })

  it('lists several without repeating one', () => {
    expect(invitesIn('jc-11111111 and jc-22222222 and jc-11111111 again'))
      .toEqual(['jc-11111111', 'jc-22222222'])
  })

  /*
   * A /g regex remembers where it stopped. Kept between calls, the second
   * message it is asked about starts halfway through the first one's answer
   * and quietly finds nothing - which reads as "that invite has expired".
   */
  it('answers the same on the second message as the first', () => {
    const body = 'jc-1a2b3c4d'
    expect(firstInvite(body)).toBe('jc-1a2b3c4d')
    expect(firstInvite(body)).toBe('jc-1a2b3c4d')
    expect(firstInvite(body)).toBe('jc-1a2b3c4d')
  })
})

describe('a code from before the app was renamed', () => {
  it('is still read', () => {
    expect(firstInvite('come on https://atriumapp.duckdns.org/invite/jc-00ff11aa please'))
      .toBe('jc-00ff11aa')
  })

  it('and so is one from after it', () => {
    expect(firstInvite('join https://atriumapp.duckdns.org/invite/at-00ff11aa'))
      .toBe('at-00ff11aa')
  })
})
