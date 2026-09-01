import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inviteFromPath, inviteLink } from './invitelink'
import { invitesIn } from './invites'

const ORIGIN = 'https://atriumapp.duckdns.org'

describe('an invite as a link', () => {
  it('is built from where the app is being served', () => {
    expect(inviteLink('jc-1a2b3c4d', ORIGIN))
      .toBe('https://atriumapp.duckdns.org/invite/jc-1a2b3c4d')
  })

  it('does not double the slash', () => {
    expect(inviteLink('jc-1a2b3c4d', ORIGIN + '/'))
      .toBe('https://atriumapp.duckdns.org/invite/jc-1a2b3c4d')
  })

  /*
   * The two have to agree exactly. A link this app writes and cannot read
   * again would be worse than the bare code it replaces.
   */
  it('and is read back by the app that wrote it', () => {
    const code = 'jc-deadbeef'
    const url = new URL(inviteLink(code, ORIGIN))
    expect(inviteFromPath(url.pathname)).toBe(code)
  })

  it('reads one with a trailing slash', () => {
    expect(inviteFromPath('/invite/jc-1a2b3c4d/')).toBe('jc-1a2b3c4d')
  })

  it('reads one in either case, and answers in one', () => {
    expect(inviteFromPath('/invite/JC-1A2B3C4D')).toBe('jc-1a2b3c4d')
  })

  /*
   * Nearly right should read as no invite at all. A code that is refused
   * later, by a route, is explained with something far less useful than an
   * ordinary app opening normally.
   */
  it('refuses something that only looks like one', () => {
    expect(inviteFromPath('/invite/jc-1a2b3c4d5e')).toBe(null)
    expect(inviteFromPath('/invite/jc-zzzzzzzz')).toBe(null)
    expect(inviteFromPath('/invite/jc-1a2b')).toBe(null)
    expect(inviteFromPath('/invites/jc-1a2b3c4d')).toBe(null)
    expect(inviteFromPath('/invite/jc-1a2b3c4d/extra')).toBe(null)
  })

  it('and says nothing about an ordinary visit', () => {
    expect(inviteFromPath('/')).toBe(null)
    expect(inviteFromPath('')).toBe(null)
    expect(inviteFromPath('/settings')).toBe(null)
  })
})

/**
 * The parser and the thing that makes the codes have to agree.
 *
 * They did not, for one commit. The server's codes were widened from four
 * bytes to nine and this file still matched exactly eight hex characters, so
 * an address the app had just written could not be read back by the app that
 * wrote it - pasting a fresh invite link simply did nothing. Four generators
 * exist and only two of them were changed, which is the other half of the
 * same mistake.
 *
 * Read out of the server's own source, so the two cannot drift again without
 * this saying so.
 */
describe('the code shape the server actually produces', () => {
  const serverFiles = [
    join(__dirname, '..', '..', '..', 'server', 'src', 'routes', 'spaces.ts'),
    join(__dirname, '..', '..', '..', 'server', 'src', 'routes', 'admin.ts'),
    join(__dirname, '..', '..', '..', 'server', 'src', 'scripts', 'invite.ts'),
  ]

  /** Every `at-${randomBytes(N)...}` the server has, as byte counts. */
  const widths = serverFiles.flatMap((f) =>
    [...readFileSync(f, 'utf8').matchAll(/`at-\$\{randomBytes\((\d+)\)/g)]
      .map((m) => Number(m[1])))

  it('finds where the codes are made', () => {
    expect(widths.length).toBeGreaterThan(2)
  })

  it('makes them all the same width', () => {
    expect(new Set(widths).size, `byte counts: ${widths.join(', ')}`).toBe(1)
  })

  for (const bytes of new Set(widths)) {
    const sample = `at-${'ab'.repeat(bytes)}`

    it(`reads a link carrying a ${bytes}-byte code`, () => {
      expect(inviteFromPath(`/invite/${sample}`)).toBe(sample)
    })

    it(`and finds a ${bytes}-byte code inside a message`, () => {
      expect(invitesIn(`Join Somewhere: ${sample}`)).toContain(sample)
    })
  }

  it('and still reads the four-byte codes already in the database', () => {
    // Widening what is issued must not invalidate what was issued.
    const old = 'jc-8f378fe3'
    expect(inviteFromPath(`/invite/${old}`)).toBe(old)
    expect(invitesIn(`Join Somewhere: ${old}`)).toContain(old)
  })
})
