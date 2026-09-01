import { scrypt as scryptCb, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'
import { config } from './config.js'
import { db, PUBLIC_USER_COLUMNS, type User } from './db.js'

const SCRYPT_KEYLEN = 64

// Async, not scryptSync. The sync form blocks the event loop for ~35ms per
// call, so concurrent sign-ins serialise and stall every other request.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN)
  return { hash: derived.toString('hex'), salt }
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const attempt = await scrypt(password, salt, SCRYPT_KEYLEN)
  const stored = Buffer.from(hash, 'hex')
  // Lengths must match before timingSafeEqual, which throws otherwise.
  if (attempt.length !== stored.length) return false
  return timingSafeEqual(attempt, stored)
}

/**
 * Everything signed into a session token.
 *
 * `epoch` is the point the account's sessions were last invalidated. A token
 * minted before that is refused, which is what makes changing a password
 * actually end the sessions somebody else may be holding.
 */
export function tokenEpoch(userId: string): number {
  const row = db.prepare('SELECT token_epoch AS e FROM users WHERE id = ?').get(userId) as
    unknown as { e: number | null } | undefined
  return row?.e ?? 0
}

export async function issueToken(userId: string): Promise<string> {
  /* An id of its own, so one session can be ended without ending the rest.
     Without it the only lever was the account-wide epoch, which signs you out
     of your phone because you signed out of your laptop. */
  return new SignJWT({ sub: userId, epoch: tokenEpoch(userId), jti: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(config.authSecret)
}

/**
 * End one session — the one holding this token, and no other.
 *
 * Kept only until the token would have expired anyway: after that the
 * signature is refused on its own and the row is just taking up room. The
 * sweep happens here rather than on a timer, because this is rare and a
 * timer for a table this small is a moving part for nothing.
 */
export function revokeToken(jti: string, expiresAt: number): void {
  db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)')
    .run(jti, expiresAt)
}

/** What a request is holding, for signing exactly it out. */
export async function tokenIdOf(token: string): Promise<{ jti: string; exp: number } | null> {
  try {
    const { payload } = await jwtVerify(token, config.authSecret, { algorithms: ['HS256'] })
    if (typeof payload.jti !== 'string' || typeof payload.exp !== 'number') return null
    return { jti: payload.jti, exp: payload.exp * 1000 }
  } catch {
    return null
  }
}

/** End every session for this account, including whoever else was holding one. */
export function revokeSessions(userId: string): void {
  db.prepare('UPDATE users SET token_epoch = ? WHERE id = ?').run(Date.now(), userId)
}

export async function readToken(token: string): Promise<string | null> {
  try {
    // The algorithm is pinned. jose would not accept an asymmetric one against
    // a shared secret anyway, but saying so costs nothing and closes the whole
    // family of algorithm-confusion tricks by name.
    const { payload } = await jwtVerify(token, config.authSecret, { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string') return null
    // Minted before the account's sessions were last ended.
    const epoch = typeof payload.epoch === 'number' ? payload.epoch : 0
    if (epoch < tokenEpoch(payload.sub)) return null
    /*
     * Signed out on its own.
     *
     * A token minted before this existed carries no jti and cannot be
     * revoked individually — it still expires on its own, and changing a
     * password still ends it. Nothing here pretends otherwise.
     */
    if (typeof payload.jti === 'string') {
      const gone = db.prepare('SELECT 1 AS x FROM revoked_tokens WHERE jti = ?')
        .get(payload.jti)
      if (gone) return null
    }
    return payload.sub
  } catch {
    return null
  }
}

export type StoredUser = User & { pass_hash: string; pass_salt: string }

export function findUser(id: string): User | undefined {
  // A removed member keeps their row so their messages survive, but they are
  // no longer a member: every lookup that gates access must skip them.
  return db
    .prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ? AND removed_at IS NULL`)
    .get(id) as unknown as User | undefined
}


/**
 * Split what somebody typed into a name and, if they gave one, four digits.
 *
 * "Keeko#4821" is one person. "Keeko" is whoever holds the bare name, which
 * is at most one account by definition - so it stays unambiguous without
 * having to guess between the people who share it.
 */
export function splitHandle(input: string): { username: string; discriminator: string | null } {
  const at = input.lastIndexOf('#')
  if (at === -1) return { username: input.trim(), discriminator: null }
  const digits = input.slice(at + 1).trim()
  if (!/^\d{1,4}$/.test(digits)) return { username: input.trim(), discriminator: null }
  return { username: input.slice(0, at).trim(), discriminator: digits.padStart(4, '0') }
}

/**
 * The account somebody meant.
 *
 * With no digits this means the bare name and nothing else. Falling back to
 * "the only Keeko" would be friendly right up until a second one registers,
 * at which point whoever was logging in fine yesterday is suddenly signing in
 * as a stranger - so the rule stays the same whatever the database happens to
 * hold today.
 */
export function findByHandle(input: string): StoredUser | undefined {
  const { username, discriminator } = splitHandle(input)
  if (!username) return undefined
  return db
    .prepare(
      'SELECT * FROM users WHERE username = ? COLLATE NOCASE AND discriminator = ? AND removed_at IS NULL'
    )
    .get(username, discriminator ?? '') as unknown as StoredUser | undefined
}


/**
 * Every account somebody typing this could have meant, for signing in.
 *
 * Typing "Keeko" should just work. Making people remember four digits to get
 * into their own account is a tax for a problem they did not cause - the
 * digits exist so two people can share a name, not so everybody has to recite
 * one.
 *
 * The reason this cannot simply pick "the only Keeko" is that it stops being
 * the only Keeko the moment somebody else registers, and then a login that
 * worked yesterday points at a stranger. So it does not guess: it hands back
 * everybody with that name and lets the password say which one, because the
 * password is the thing only the right person has.
 *
 * Capped, because each candidate costs a real scrypt verification and an
 * unbounded list would turn one popular name into a way to make the server do
 * arbitrary work. Anybody past the cap can still sign in with their digits.
 */
const MAX_LOGIN_CANDIDATES = 8

export function loginCandidates(input: string): StoredUser[] {
  const { username, discriminator } = splitHandle(input)
  if (!username) return []

  // Digits given: they have said exactly who they are, so believe them.
  if (discriminator !== null) {
    const exact = findByHandle(input)
    return exact ? [exact] : []
  }

  return db
    .prepare(
      `SELECT * FROM users
       WHERE username = ? COLLATE NOCASE AND removed_at IS NULL
       -- The bare name first: it is the verified account where there is one,
       -- and the likeliest person meant by an unqualified name.
       ORDER BY CASE WHEN discriminator = '' THEN 0 ELSE 1 END, created_at
       LIMIT ?`
    )
    .all(username, MAX_LOGIN_CANDIDATES) as unknown as StoredUser[]
}

/**
 * Is this exact handle spoken for?
 *
 * Removed members still count: their messages are still attributed to them,
 * so letting somebody re-register the handle would rewrite who said what.
 */
export function handleTaken(username: string, discriminator: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE AND discriminator = ?')
      .get(username, discriminator)
  )
}

/** Whether the bare name is held, which is what verification grants. */
export function usernameTaken(username: string): boolean {
  return handleTaken(username, '')
}

/**
 * Whether anybody at all has this name, digits or not.
 *
 * What registration asks, now that a name belongs to one person. Removed
 * members count: their messages are still signed with the name, so handing it
 * to somebody else would quietly rewrite who said what.
 */
export function nameTaken(username: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 AS x FROM users WHERE username = ? COLLATE NOCASE').get(username)
  )
}

/**
 * Whether this request is from whoever runs the app.
 *
 * A handful of routes are about the hardware rather than about anybody's
 * server - disk, memory, how long the database takes to answer - and they
 * used to be gated on an account: the first person to sign up claimed the
 * install and held a role that opened them. That put a claim screen in
 * front of the very first visitor, and made running the app into a rank
 * inside it.
 *
 * Running it is not a rank inside it. So the operator proves themselves
 * with something only they have, which is what a secret is for, and it is
 * not an identity: nobody signs in as the operator and no account is
 * special.
 *
 * Compared in constant time. It is a bearer secret, and an early exit on
 * the first wrong byte is how a secret gets guessed one byte at a time.
 * Unset means these routes never answer, which is the right default for an
 * app that is simply being used.
 */
export function isOperator(headers: unknown): boolean {
  const want = config.operatorToken
  if (!want) return false
  const got = String(
    (headers as Record<string, unknown> | undefined)?.['x-operator-token'] ?? ''
  )
  /* Length is not a secret worth protecting here and comparing different
     lengths throws, so it is checked first and plainly. */
  if (got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export async function createUser(
  username: string,
  displayName: string,
  password: string,
): Promise<User> {
  const { hash, salt } = await hashPassword(password)
  const id = randomUUID()

  /*
   * Everybody holds their name outright.
   *
   * Registration refuses a name somebody already has, so there is nothing for
   * digits to disambiguate. The column stays because taking it out means
   * rebuilding the table again for nothing, and because leaving it means this
   * can be reconsidered if there are ever enough people to need it.
   */
  const discriminator = ''

  /*
   * Everybody is a member. There is no other kind of account.
   *
   * `role` used to be 'owner' for whoever claimed the install, and that
   * account opened the health page and could hand out verified badges. Both
   * are the operator's business now and proved with a secret instead - see
   * isOperator - so nothing anywhere reads this column and every row written
   * from here says the same thing. It is left on the table rather than
   * dropped, because dropping a column rebuilds it for no gain.
   */
  db.prepare(
    `INSERT INTO users (id, username, discriminator, display_name, pass_hash, pass_salt, role, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'member', 0, ?)`
  ).run(id, username, discriminator, displayName, hash, salt, Date.now())

  return findUser(id)!
}

/**
 * Redeem an invite code.
 *
 * Done as a single conditional UPDATE rather than SELECT-then-UPDATE: the
 * two-step version lets two simultaneous registrations both pass the check
 * and both consume a one-use code.
 */
export function consumeInvite(code: string): boolean {
  const result = db
    .prepare(
      `UPDATE invites
          SET uses_left = uses_left - 1
        WHERE code = ?
          AND uses_left > 0
          AND (expires_at IS NULL OR expires_at > ?)`
    )
    .run(code, Date.now())

  return Number(result.changes) === 1
}
