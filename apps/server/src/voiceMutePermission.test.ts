import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, CHANNEL_PERMISSIONS } from './permissions.js'

/**
 * Silencing somebody in a call has its own permission.
 *
 * It was manage_messages - "delete anybody's messages" - so a role trusted to
 * tidy a channel could also mute a person mid-sentence in a voice room, and
 * there was no way to grant either without the other. Two rooms, two acts.
 */

const gateway = readFileSync(join(__dirname, 'gateway.ts'), 'utf8').split('\r\n').join('\n')
const db = readFileSync(join(__dirname, 'db.ts'), 'utf8').split('\r\n').join('\n')

describe('the permission itself', () => {
  it('exists', () => {
    expect(PERMISSIONS as readonly string[]).toContain('mute_members')
  })

  /*
   * Server-wide, not per channel. A mute is written against a space and a
   * person - voice_moderation is keyed that way - so a channel has no opinion
   * to have about it, and a row for it in the channel pane would be a switch
   * that changes nothing.
   */
  it('and is not something one channel can have an opinion about', () => {
    expect(CHANNEL_PERMISSIONS as readonly string[]).not.toContain('mute_members')
  })
})

describe('moderating voice', () => {
  const handler = (() => {
    const from = gateway.indexOf("refuse('You cannot moderate voice.')")
    expect(from, 'the voice moderation frame is handled somewhere').toBeGreaterThan(-1)
    /* Backwards to the start of the decision and forwards past it, bounded
       both ways rather than run to the end of a 2,000 line file. */
    return gateway.slice(Math.max(0, from - 1200), from + 1200)
  })()

  it('asks for the permission that is about voice', () => {
    expect(handler).toContain("has('mute_members')")
  })

  it('and no longer for the one that is about messages', () => {
    expect(handler).not.toContain("has('manage_messages')")
  })

  /*
   * The two guards either side of it stay. Permission says you may moderate
   * somebody; rank says which somebody, and membership says where - without
   * those, a moderator can silence the owner by sending the frame by hand.
   */
  it('while still asking whose server it is and who outranks whom', () => {
    expect(handler).toContain('isSpaceMember(targetId, where)')
    expect(handler).toContain('outranks(client.user.id, targetId, where)')
  })
})

/**
 * And nobody woke up having lost it.
 *
 * Splitting a permission out of another one silently takes it away from every
 * role that held the old one - the ability would simply stop working, on
 * servers whose owners never asked for a change. So it is given once to
 * whoever could already do it, and can be taken off afterwards, which is the
 * whole point of it being separate.
 */
describe('the migration', () => {
  const fn = (() => {
    const from = db.indexOf('function migrateVoiceMuteIsItsOwn')
    expect(from).toBeGreaterThan(-1)
    const to = db.indexOf('\n}', from)
    expect(to).toBeGreaterThan(from)
    return db.slice(from, to)
  })()

  it('gives it to every role that could already do it', () => {
    expect(fn).toContain("held.includes('manage_messages')")
    expect(fn).toContain("'mute_members'")
  })

  /* Twice must change nothing: this runs on every boot. */
  it('and skips a role that already has it', () => {
    expect(fn).toContain("if (held.includes('mute_members')) continue")
  })

  /* An administrator expands to everything already, so writing it on would
     be noise rather than a grant. */
  it('and does not write it onto an administrator', () => {
    expect(fn).toContain("if (held.includes('administrator')) continue")
  })

  /*
   * Nor onto @everyone, which one server on this machine has handed
   * manage_messages to. Nothing is lost: moderating needs rank as well as
   * permission and outranks is strictly greater, so a member whose only role
   * is @everyone outranks no other member - the ability being preserved
   * could never have been used. Writing it on would tick "silence people in
   * voice" for every member of a server as a side effect of a refactor.
   */
  it('nor onto @everyone', () => {
    expect(fn).toContain("if (role.kind === 'everyone') continue")
  })

  /*
   * And it runs after the table it reads is in place, which is the failure
   * this codebase has had before: a backfill above the thing it depends on is
   * "no such column" at boot, and the server does not start.
   */
  it('and runs after the roles table exists', () => {
    expect(db.indexOf('CREATE TABLE IF NOT EXISTS roles'))
      .toBeLessThan(db.indexOf('migrateVoiceMuteIsItsOwn()'))
  })
})
