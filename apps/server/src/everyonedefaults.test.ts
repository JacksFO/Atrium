import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVERYONE_DEFAULTS } from './db.js'
import { PERMISSIONS } from './permissions.js'

/**
 * What a brand new member can do.
 *
 * The list existed in permissions.ts and the two places that seed an
 * @everyone role wrote it out by hand instead. So when create_polls was added
 * to the defaults, every server made afterwards was seeded from a literal
 * that had never heard of it - and a migration went back and granted it to
 * the roles that already existed, which made the fault invisible on the one
 * machine anybody was looking at.
 *
 * Found by making a server on a spare port and being told "you cannot ask a
 * question here" on it.
 */

const db = readFileSync(resolve(process.cwd(), 'src/db.ts'), 'utf8')

describe('what a new server grants everybody', () => {
  it('is a list, in one place', () => {
    /* Or the assertions below are about something that no longer exists. */
    expect(EVERYONE_DEFAULTS.length).toBeGreaterThan(3)
  })

  it('and every seed reads it rather than repeating it', () => {
    /*
     * One seed now: the one that runs when somebody makes a server. There
     * were two, and the second was the first-run seed that gave the install
     * itself a seeded server - a leftover from when each person
     * hosted their own copy and the install *was* the server. It is one
     * instance with everybody's own servers inside it now, so a fresh account
     * has none until it makes one.
     *
     * Asserted as "at least one seed takes the list" rather than as an exact
     * count, so adding a second legitimate seed does not fail this for no
     * reason - the fault this is about is a seed that writes its own.
     */
    const uses = db.match(/JSON\.stringify\(EVERYONE_DEFAULTS\)/g) ?? []
    expect(uses.length, 'nothing seeds @everyone at all').toBeGreaterThan(0)
  })

  /* The specific one that went missing, named so its absence fails loudly
     rather than as a count that happens not to match. */
  it('and includes asking a question', () => {
    expect(EVERYONE_DEFAULTS).toContain('create_polls')
  })

  it('and the rest of what an ordinary member needs', () => {
    for (const p of ['view_channels', 'send_messages', 'read_history', 'add_reactions']) {
      expect(EVERYONE_DEFAULTS).toContain(p)
    }
  })

  /*
   * A permission not in PERMISSIONS cannot be saved from the roles screen, so
   * granting one here makes the role permanently unsaveable - which is what
   * embed_links did before it was removed.
   */
  it('and grants nothing the roles screen cannot save', () => {
    const known = new Set<string>(PERMISSIONS as readonly string[])
    const unknown = EVERYONE_DEFAULTS.filter((p) => !known.has(p))
    expect(unknown, `not in PERMISSIONS: ${unknown.join(', ')}`).toEqual([])
  })

  /* Nothing that lets an ordinary member reshape the server. */
  it('and nothing that manages anything', () => {
    const managing = EVERYONE_DEFAULTS.filter((p) => /^manage_|^kick|^ban|^move_/.test(p))
    expect(managing, `everybody would hold: ${managing.join(', ')}`).toEqual([])
  })
})
