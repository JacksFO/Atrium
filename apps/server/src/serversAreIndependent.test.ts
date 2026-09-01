import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No server is special, and the install is not one.
 *
 * The app began as a thing each person downloaded and hosted for themselves.
 * The install *was* the server, there was no way to make another inside it,
 * and you invited people into the one you were running. A helper named the
 * oldest server in the app, and a dozen places fell back to it — so a
 * question about nothing was answered about that one, and one server's
 * permissions, ownership and moderation kept turning up in another's.
 *
 * That is not the model. One instance is hosted, everybody makes an account
 * on it, everybody makes their own servers inside it, and nobody has powers
 * over anybody else's. So there is no oldest-server helper any more, no seed
 * that gives an install a server of its own, and no migration that hands
 * unattributed rows to one — the database refuses to hold such a row instead.
 *
 * Written as a rule rather than a list of the places it was wrong, because
 * the next one would be wrong the same way and would not be on a list.
 */

const dir = __dirname
const sources: Array<{ file: string; text: string }> = []
;(function walk(d: string) {
  for (const name of readdirSync(d)) {
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.ts$/.test(name) && !name.includes('.test.')) {
      sources.push({
        file: p.slice(dir.length + 1).split('\\').join('/'),
        text: readFileSync(p, 'utf8'),
      })
    }
  }
})(dir)

/** Code, with the comments taken out - they recount the old shape on purpose. */
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** Everything the old model was built out of, by name. */
const GONE = [
  'firstSpaceId',
  'originalSpaceId',
  'forgetOriginalSpace',
  'seedFirstSpace',
  'attachOrphansToFirstSpace',
  'adoptOwnerlessSpaces',
  'backfillOwnerRoles',
  'scopeVoiceModeration',
]

describe('the oldest server', () => {
  it('is not something anything can ask for', () => {
    for (const { file, text } of sources) {
      for (const name of GONE) {
        expect(code(text), `${file} still has ${name}`).not.toContain(name)
      }
    }
  })

  it('and nothing falls back to a server it was not given', () => {
    /* The shape, whatever it ends up being called. A question about nothing
       must answer nothing, and the caller must refuse. */
    for (const { file, text } of sources) {
      expect(code(text), `${file} falls back to some other server`)
        .not.toMatch(/(\?\?|\|\|)\s*\w*[Ss]paceId\(\)/)
    }
  })
})

describe('a fresh install', () => {
  const db = sources.find((s) => s.file === 'db.ts')
  const index = sources.find((s) => s.file === 'index.ts')

  it('is given no server of its own', () => {
    /* It used to seed one, with five channels and a pair of
       roles, because the install was the server. A brand new account landing
       in one is not a thing that should happen. */
    expect(db, 'db.ts is still here').toBeDefined()
    const body = code(db!.text)
    expect(body).not.toMatch(/INSERT INTO channels[^;]*'general'/)
    /* No seeded server of any name. It was one called Basement; the check
       is that db.ts hands out no server at all, so it asks about the seed
       rather than about the word. */
    expect(body).not.toMatch(/INSERT INTO spaces[^;]*VALUES/)
    expect(body).not.toContain("insert.run('owner', 'Owner'")
  })

  it('and claiming the machine joins nothing', () => {
    /* The person who claims it gets an account and the host role, which is
       what the machine's own health page is gated on. They make a server
       exactly like everybody else, from the page they land on. */
    expect(index, 'index.ts is still here').toBeDefined()
    const claim = code(index!.text)
    expect(claim).not.toMatch(/joinSpace\(user\.id,\s*\w*[Ss]paceId\(\)\)/)
  })
})

describe('what stops the fallbacks being needed', () => {
  it('is the database refusing a row with no server', () => {
    /*
     * roles and invites refuse a null server outright; a channel must have one
     * unless it is a conversation. That is why nothing needs a default any
     * more, so loosening any of it has to be a deliberate act with this test
     * in front of it.
     */
    const body = sources.find((s) => s.file === 'db.ts')!.text
    expect(body).toContain("bits.push('NOT NULL REFERENCES spaces(id) ON DELETE CASCADE')")
    expect(body).toContain("CHECK ((kind IN ('dm', 'group')) = (space_id IS NULL))")
  })

  it('and that rule is still applied at boot', () => {
    /* It is what puts those constraints on, on a fresh database as much as an
       old one - so it is the one thing here that is not a leftover. */
    const boot = sources.find((s) => s.file === 'index.ts')!.text
    expect(code(boot)).toContain('tightenSpaceColumns()')
  })
})
