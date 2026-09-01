import { describe, expect, it } from 'vitest'

/**
 * Signing out.
 *
 * It used to be a thing the browser did to itself. The client posted to
 * /api/logout, which did not exist; the 404 went into a silent catch, the
 * token was forgotten locally, and it stayed valid for the rest of its thirty
 * days. Anybody holding a copy still had the account.
 *
 * The account-wide lever was already there and is the wrong shape: it ends
 * every session on every device, so signing out of a laptop signs out the
 * phone. What was missing was ending one.
 */

process.env.AUTH_SECRET ??= 'x'.repeat(40)

const auth = await import('./auth.js')
const { db } = await import('./db.js')

/* Somebody to sign in and out. */
const who = 'u-logout-test'
db.prepare(
  `INSERT OR REPLACE INTO users (id, username, display_name, pass_hash, pass_salt, created_at)
   VALUES (?, ?, ?, '', '', ?)`,
).run(who, 'logout-test', 'Logout Test', Date.now())

describe('signing out one session', () => {
  it('accepts a token that has not been signed out', async () => {
    const token = await auth.issueToken(who)
    /* Or every assertion below is about a token that never worked. */
    expect(await auth.readToken(token)).toBe(who)
  })

  it('and refuses it afterwards', async () => {
    const token = await auth.issueToken(who)
    const held = await auth.tokenIdOf(token)
    expect(held).not.toBeNull()
    auth.revokeToken(held!.jti, held!.exp)
    expect(await auth.readToken(token)).toBeNull()
  })

  /* The whole reason for doing it per token rather than reaching for the
     account-wide epoch, which would fail this. */
  it('and leaves the other devices signed in', async () => {
    const laptop = await auth.issueToken(who)
    const phone = await auth.issueToken(who)
    const held = await auth.tokenIdOf(laptop)
    auth.revokeToken(held!.jti, held!.exp)

    expect(await auth.readToken(laptop)).toBeNull()
    expect(await auth.readToken(phone)).toBe(who)
  })

  /* Two tokens issued together must not collide, or signing out of one signs
     out the other — the account-wide behaviour, by accident. */
  it('and gives every session an id of its own', async () => {
    const a = await auth.tokenIdOf(await auth.issueToken(who))
    const b = await auth.tokenIdOf(await auth.issueToken(who))
    expect(a!.jti).not.toBe(b!.jti)
  })

  /* Changing a password still ends everything, which is its job. */
  it('but a password change still ends them all', async () => {
    const laptop = await auth.issueToken(who)
    const phone = await auth.issueToken(who)
    await new Promise((r) => setTimeout(r, 2))
    auth.revokeSessions(who)
    expect(await auth.readToken(laptop)).toBeNull()
    expect(await auth.readToken(phone)).toBeNull()
  })

  /* Kept only as long as it could still be presented. A row for a token that
     expired months ago is a row that can never match again. */
  it('and forgets a signed-out token once it would have expired anyway', async () => {
    const stale = 'jti-already-expired'
    db.prepare('INSERT OR REPLACE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)')
      .run(stale, Date.now() - 1000)
    const held = await auth.tokenIdOf(await auth.issueToken(who))
    auth.revokeToken(held!.jti, held!.exp)

    const left = db.prepare('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?').get(stale)
    expect(left).toBeUndefined()
    /* And the live one is still there, or the sweep took too much. */
    expect(db.prepare('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?').get(held!.jti))
      .toBeTruthy()
  })
})
