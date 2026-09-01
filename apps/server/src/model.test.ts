import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db, migrateEverybodyIsAMember, PUBLIC_USER_COLUMNS } from './db.js'
import { isOperator } from './auth.js'

/**
 * What Atrium is, asserted as what it is.
 *
 * People sign up, and make or join servers inside the app. Every account is
 * the same kind of account. What anybody may do is decided inside the server
 * they are in and nowhere else, and the few routes that are about the
 * hardware belong to whoever runs the app rather than to anybody in it.
 *
 * This file used to be written the other way round - a list of things that
 * must not appear, by name. That is a weaker guard than it looks, because
 * almost everything on the list is already impossible: the functions do not
 * exist and the fields are not on the types, so anything reaching for them
 * fails to compile long before a test runs. A regex forbidding a name the
 * compiler already forbids adds nothing, and it kept the old shape written
 * down in the one file claiming it was gone.
 *
 * So these say what is true. Each one fails if the model changes underneath
 * it, which is the only thing a test here can usefully do.
 */

const SRC = join(__dirname)
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8').split('\r\n').join('\n')

/* Comments explain decisions and naturally describe what a thing is not.
   Checks are about the code. */
const codeOnly = (t: string) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')

describe('a person, as everybody else receives them', () => {
  /*
   * The whole list, by equality rather than by absence.
   *
   * Exact, so a field cannot be added without somebody deciding to add it
   * here too - which is the moment to ask whether everybody should have it.
   * It is also what keeps the wire and the User type in step; columnparity
   * checks the other half of that.
   */
  it('is exactly these things and nothing more', () => {
    expect(PUBLIC_USER_COLUMNS.split(',').map((c) => c.trim())).toEqual([
      'id', 'username', 'discriminator', 'verified', 'display_name',
      'bio', 'accent', 'accent_2', 'name_font', 'name_effect',
      'avatar_path', 'banner_path', 'status_text', 'status_until',
      'presence', 'created_at',
    ])
  })
})

describe('every account', () => {
  /*
   * One way to make one, taking a name, a name to show and a password.
   *
   * The arity is the assertion. A fourth argument here has only ever meant
   * one thing - that some accounts are made differently from others - and
   * that is the difference this model does not have.
   */
  it('is made by one function, from a name and a password', () => {
    const auth = codeOnly(read('auth.ts'))
    const sig = auth.slice(auth.indexOf('export async function createUser'))
    const params = sig.slice(sig.indexOf('(') + 1, sig.indexOf(')'))
      .split(',').map((s) => s.trim()).filter(Boolean)
    expect(params).toHaveLength(3)
    expect(params.map((p) => p.split(':')[0]!.trim()))
      .toEqual(['username', 'displayName', 'password'])
  })

  /* And written with the same two values every time, as literals - there is
     no expression here that could evaluate to something else. */
  it('and is written as a member, unverified, every time', () => {
    expect(codeOnly(read('auth.ts'))).toContain("'member', 0,")
  })

  /*
   * And every row says so, including any written before that was true.
   *
   * The row is planted rather than hoped for: on a database that is already
   * uniform this passes whether or not the migration exists, which is how a
   * check like this quietly stops meaning anything.
   */
  it('and every row in the table agrees', () => {
    const id = randomUUID()
    db.prepare(
      `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, role, created_at)
       VALUES (?, ?, ?, '0001', 'x', 'y', 'something-else', ?)`
    ).run(id, 'legacy' + id.slice(0, 8), 'Legacy', Date.now())
    const odd = () => (db.prepare(
      "SELECT COUNT(*) c FROM users WHERE role != 'member'"
    ).get() as { c: number }).c
    expect(odd(), 'the row this test is about was not planted').toBe(1)

    migrateEverybodyIsAMember()
    expect(odd()).toBe(0)
  })
})

describe('signing up', () => {
  const route = (() => {
    const src = codeOnly(read('index.ts'))
    const from = src.indexOf("app.post('/api/register'")
    expect(from).toBeGreaterThan(-1)
    return src.slice(from, src.indexOf('\napp.', from + 10))
  })()

  /*
   * Every answer the front door gives, by equality.
   *
   * Two of these are about the name and the password being usable, one is
   * about the name being free, and two are the whole of who may come in:
   * an invite that works, or open registration. A sixth answer would be a
   * third way to decide who gets an account, and this is where somebody
   * would have to come and write it down.
   */
  it('has exactly these answers', () => {
    const said = [...route.matchAll(/error: '([^']+)'/g)].map((m) => m[1]!)
    expect([...new Set(said)].sort()).toEqual([
      'a valid invite code is required',
      'password must be at least 8 characters',
      'that invite is not valid',
      'that name is already taken',
      'username and password required',
      'username must be 2-24 chars: letters, numbers, _ or .',
    ])
  })

  /* And the name rules are asked of everybody who signs up, with nothing
     around them deciding who they apply to. */
  it('and holds every account to the same name rules', () => {
    expect(route).toMatch(/for \(const candidate of \[username, displayName\]\)/)
    expect(route).toContain('const why = nameProblem(candidate)')
  })
})

describe('the routes about the hardware', () => {
  /*
   * Proved by a secret, and it is not an identity: nothing signs in, and no
   * account can hold it.
   *
   * Unset is the state a test process is in, and the answer has to be no.
   * An operator route that opens by default is a hole waiting for somebody
   * who has read the source.
   */
  it('answer to nobody when no secret is configured', () => {
    expect(isOperator({})).toBe(false)
    expect(isOperator({ 'x-operator-token': 'anything at all' })).toBe(false)
    expect(isOperator(undefined)).toBe(false)
  })

  /* Compared whole, in constant time. It is a bearer secret, and an early
     exit on the first wrong byte is how one gets guessed a byte at a time. */
  it('and compare it in constant time', () => {
    expect(read('auth.ts')).toContain('timingSafeEqual')
  })

  /*
   * And both of them ask, and say there is nothing there rather than
   * refusing - a refusal tells somebody a credential exists to go and find.
   */
  it('and both ask it, and answer as though nothing is there', () => {
    for (const [file, src] of [
      ['index.ts', codeOnly(read('index.ts'))],
      ['admin.ts', codeOnly(read('routes', 'admin.ts'))],
    ] as const) {
      const at = src.indexOf('isOperator(req.headers)')
      expect(at, `${file} asks`).toBeGreaterThan(-1)
      expect(src.slice(at, at + 160), `${file} answers 404`).toContain('404')
    }
  })
})
