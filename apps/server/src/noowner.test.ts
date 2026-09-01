import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { db, migrateEverybodyIsAMember, PUBLIC_USER_COLUMNS } from './db.js'

/**
 * Atrium is one app that people sign up to.
 *
 * It began as something one person ran for their friends, and the code said
 * so in the place a stranger would meet it first: the very first visitor got
 * a sign-up form telling them the install was unclaimed and that the code to
 * claim it was printed in a console they could not see. Whoever used it held
 * an account role that opened the health and storage pages.
 *
 * None of that is what this is. Running the app is not a rank inside it -
 * the people who run any other app are not a role in somebody's group on it
 * either - so there is no owner account, no claim, and no kind of account
 * that means anything outside a server somebody made.
 *
 * These are the checks that keep it that way, because every one of them was
 * true once and would read as perfectly reasonable code to restore.
 */

const SRC = join(__dirname)

function sources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(at))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push([entry.name, readFileSync(at, 'utf8')])
    }
  }
  return out
}

/* Comments describe what was removed, on purpose, so a plain search cannot
   tell the account of the bug from the bug. */
const codeOnly = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

describe('no account owns the app', () => {
  it('nothing anywhere reads a global role', () => {
    const offenders: string[] = []
    for (const [name, text] of sources(SRC)) {
      const code = codeOnly(text)
      /* `role` on a person. Not role_id, not member_roles, not a server's
         roles - those are the ordinary per-server kind and are the whole
         point of the model. */
      if (/\buser\.role\b|\brole === 'owner'|isHost\s*\(/.test(code)) offenders.push(name)
    }
    expect(offenders, 'read an account role').toEqual([])
  })

  /*
   * And it is not sent to anybody either.
   *
   * The column stays on the table - dropping one rebuilds it for no gain -
   * but a field on the wire is a field somebody draws a badge from, and
   * there is no badge to draw.
   */
  it('and no account role goes out to clients', () => {
    expect(PUBLIC_USER_COLUMNS.split(',').map((c) => c.trim())).not.toContain('role')
  })

  /* Every account created is the same kind of account. */
  it('and every account is made the same', () => {
    const auth = codeOnly(sources(SRC).find(([n]) => n === 'auth.ts')![1])
    expect(auth).toContain("'member', 0,")
    expect(auth).not.toMatch(/asOwner|ownerExists|ownerNameAllowed/)
  })

  /*
   * And the rows say it too.
   *
   * Nothing reads this column, so a row still saying 'owner' would break
   * nothing - and would sit in the database as a lie somebody finds in a
   * year, believes, and writes a query against.
   *
   * The precondition is planted rather than hoped for: on a database that is
   * already clean this test would pass without the migration existing, which
   * is the way a check like this quietly stops meaning anything.
   */
  it('and no row claims one either', () => {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, role, created_at)
       VALUES (?, ?, ?, '0001', 'x', 'y', 'owner', ?)`
    ).run(id, 'legacy' + id.slice(0, 8), 'Legacy', Date.now())
    expect(
      (db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'member'").get() as { c: number }).c,
      'the row this test is about was not planted',
    ).toBe(1)

    migrateEverybodyIsAMember()

    expect(
      (db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'member'").get() as { c: number }).c,
    ).toBe(0)
  })
})

describe('there is no claim', () => {
  it('no claim code is written, printed or asked for', () => {
    const offenders: string[] = []
    for (const [name, text] of sources(SRC)) {
      const code = codeOnly(text)
      if (/ownerClaimCode|clearOwnerClaimCode|owner-claim|claimsOwner|needsOwner/.test(code)) {
        offenders.push(name)
      }
    }
    expect(offenders, 'still part of a claim flow').toEqual([])
  })

  /*
   * And signing up has two answers, not three.
   *
   * Open, or by invitation. The third was about an install nobody had taken
   * yet, which is not a state this can be in.
   */
  it('and signing up is open or by invitation, and nothing else', () => {
    const index = codeOnly(sources(SRC).find(([n]) => n === 'index.ts')![1])
    expect(index).toContain("error: 'a valid invite code is required'")
    expect(index).not.toMatch(/has no owner yet|claim code/i)
  })

  /* The name rules apply to everybody, including the first person through
     the door - the exemption existed only for the account that claimed. */
  it('and the first account is held to the same name rules as the rest', () => {
    const index = codeOnly(sources(SRC).find(([n]) => n === 'index.ts')![1])
    expect(index).not.toMatch(/if \(ownerExists\(\)\) \{[\s\S]{0,200}nameProblem/)
    expect(index).toContain('const why = nameProblem(candidate)')
  })
})

describe('what the operator proves instead', () => {
  const auth = sources(SRC).find(([n]) => n === 'auth.ts')![1]

  /* A secret, in constant time. It is a bearer token, and an early exit on
     the first wrong byte is how one gets guessed a byte at a time. */
  it('is a secret, compared without leaking its length in time', () => {
    expect(auth).toContain('export function isOperator')
    expect(auth).toContain('timingSafeEqual')
  })

  /* Unset means the routes do not exist. An app being used has no need of
     them, and a default-open operator route is a hole waiting for someone. */
  it('and unset means those routes never answer', () => {
    expect(auth).toMatch(/if \(!want\) return false/)
  })

  it('and it gates the two pages that are about the hardware', () => {
    const index = codeOnly(sources(SRC).find(([n]) => n === 'index.ts')![1])
    const admin = codeOnly(sources(SRC).find(([n]) => n === 'admin.ts')![1])
    expect(index).toContain('isOperator(req.headers)')
    expect(admin).toContain('isOperator(req.headers)')
  })

  /*
   * And they answer 404 rather than 403.
   *
   * 403 says "there is something here you may not have", which invites
   * somebody to go looking for the credential. There is nothing here for
   * anybody using the app.
   */
  it('and says nothing is there rather than refusing', () => {
    const index = codeOnly(sources(SRC).find(([n]) => n === 'index.ts')![1])
    const at = index.indexOf('isOperator(req.headers)')
    expect(index.slice(at, at + 160)).toContain('404')
  })
})

describe('and nothing tells a user about the hardware', () => {
  /*
   * "Server" means a place somebody made in the app. Using the same word for
   * the machine, in something a person reads, is the one confusion this
   * whole change is about.
   */
  it('no message a person sees calls the machine a server', () => {
    const offenders: string[] = []
    for (const [name, text] of sources(SRC)) {
      for (const m of codeOnly(text).matchAll(/error: '([^']+)'|new Error\('([^']+)'\)/g)) {
        const said = m[1] ?? m[2] ?? ''
        if (/this server (is|has|pins)|server console|whoever runs it/i.test(said)) {
          offenders.push(`${name}: ${said}`)
        }
      }
    }
    expect(offenders, 'told somebody about the machine').toEqual([])
  })
})
