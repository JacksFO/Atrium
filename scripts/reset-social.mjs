#!/usr/bin/env node
/**
 * Put the five original accounts on the footing everybody new will start from.
 *
 * The oldest server predates all of this. Its five accounts hold bare names because
 * they were made when a name could only belong to one person, they are all in
 * one space because that was the only space, and there is no friend graph at
 * all because there was nothing to be a friend of - being registered was
 * being in.
 *
 * This makes them look like accounts that arrived the new way:
 *
 *   - four random digits each, so nobody is holding a bare name they did not
 *     earn. The owner keeps theirs, which is what being verified means.
 *   - everybody stays where they are, because that is where they are.
 *   - everybody is a friend of the owner and of nobody else. That is the
 *     honest starting graph: they know whoever invited them, and they can
 *     add each other themselves if they want to.
 *   - DMs that do not involve the owner are removed, so nobody starts with a
 *     conversation they never opened.
 *
 * Run with --apply. Without it, it says what it would do and changes nothing.
 *
 *   node scripts/reset-social.mjs            # look
 *   node scripts/reset-social.mjs --apply    # do it
 */

import { DatabaseSync } from 'node:sqlite'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function env(key, fallback) {
  if (process.env[key]) return process.env[key]
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq !== -1 && t.slice(0, eq).trim() === key) return t.slice(eq + 1).trim()
    }
  } catch { /* no .env; the fallback is the answer */ }
  return fallback
}

const APPLY = process.argv.includes('--apply')
const dataDir = resolve(root, env('DATA_DIR', './data'))
const db = new DatabaseSync(join(dataDir, 'atrium.db'))
db.exec('PRAGMA foreign_keys = ON')

const say = (...a) => console.log(' ', ...a)
const plan = []

const owner = db.prepare("SELECT id, username FROM users WHERE role = 'owner'").get()
if (!owner) { say('no owner on this server - nothing to do'); process.exit(0) }
say(`owner: ${owner.username}`)

/* ---- four digits each, except the owner ------------------------------- */
const others = db.prepare("SELECT id, username, discriminator FROM users WHERE role != 'owner'").all()

/** A set of digits nobody with this name is using, avoiding ones we just gave out. */
function freeDigits(username, alsoTaken) {
  const taken = new Set(
    db.prepare('SELECT discriminator FROM users WHERE username = ? COLLATE NOCASE')
      .all(username).map((r) => r.discriminator)
  )
  for (const d of alsoTaken) taken.add(d)
  for (let i = 0; i < 500; i += 1) {
    const c = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    if (!taken.has(c)) return c
  }
  return null
}

const handed = new Map()
for (const u of others) {
  if (u.discriminator !== '') { say(`${u.username}#${u.discriminator} already has digits`); continue }
  const seen = handed.get(u.username.toLowerCase()) ?? []
  const digits = freeDigits(u.username, seen)
  if (!digits) { say(`could not find digits for ${u.username}`); continue }
  seen.push(digits)
  handed.set(u.username.toLowerCase(), seen)
  plan.push({ what: `${u.username} -> ${u.username}#${digits}`, run: () =>
    db.prepare('UPDATE users SET discriminator = ? WHERE id = ?').run(digits, u.id) })
}

/* ---- friends with the owner, and nobody else -------------------------- */
const existing = db.prepare('SELECT low, high FROM friendships').all()
if (existing.length) plan.push({ what: `forget ${existing.length} existing friendship(s)`, run: () =>
  db.prepare('DELETE FROM friendships').run() })

for (const u of others) {
  const [low, high] = owner.id < u.id ? [owner.id, u.id] : [u.id, owner.id]
  plan.push({ what: `${u.username} is a friend of ${owner.username}`, run: () =>
    db.prepare('INSERT OR IGNORE INTO friendships (low, high, created_at) VALUES (?, ?, ?)')
      .run(low, high, Date.now()) })
}

/* ---- DMs that do not involve the owner -------------------------------- */
const dms = db.prepare("SELECT id, kind FROM channels WHERE kind IN ('dm','group')").all()
for (const c of dms) {
  const members = db.prepare('SELECT user_id FROM dm_members WHERE channel_id = ?').all(c.id)
    .map((r) => r.user_id)
  if (members.includes(owner.id)) continue

  const names = members.map((id) =>
    db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? '?').join(' + ')
  const msgs = db.prepare('SELECT COUNT(*) c FROM messages WHERE channel_id = ?').get(c.id).c
  /*
   * A conversation somebody actually had is not this script's to delete. The
   * point is to remove channels nobody opened, and anything with messages in
   * it was opened by somebody - so it is reported and left alone.
   */
  if (msgs > 0) { say(`LEAVING ${names} alone - it has ${msgs} message(s) in it`); continue }
  plan.push({ what: `remove the empty DM between ${names}`, run: () =>
    db.prepare('DELETE FROM channels WHERE id = ?').run(c.id) })
}

/* ---- and everybody stays where they are ------------------------------ */
const space = db.prepare('SELECT id, name FROM spaces ORDER BY created_at LIMIT 1').get()
if (space) {
  const missing = db.prepare(
    'SELECT u.id, u.username FROM users u WHERE NOT EXISTS (SELECT 1 FROM space_members sm WHERE sm.user_id = u.id AND sm.space_id = ?)'
  ).all(space.id)
  for (const u of missing) {
    plan.push({ what: `put ${u.username} back in ${space.name}`, run: () =>
      db.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, joined_at) VALUES (?, ?, ?)')
        .run(space.id, u.id, Date.now()) })
  }
}

console.log()
for (const step of plan) say((APPLY ? 'doing:  ' : 'would:  ') + step.what)
if (!plan.length) say('nothing to change')

if (!APPLY) {
  console.log()
  say('nothing was changed. pass --apply to do it.')
  process.exit(0)
}

db.exec('BEGIN')
try {
  for (const step of plan) step.run()
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('  failed, nothing was changed:', err)
  process.exit(1)
}

console.log()
say('done. handles now:')
for (const u of db.prepare('SELECT username, discriminator, verified, role FROM users ORDER BY role DESC, username').all()) {
  say(`  ${u.username}${u.discriminator ? '#' + u.discriminator : ''}` +
      `${u.verified ? '  verified' : ''}${u.role === 'owner' ? '  (owner)' : ''}`)
}
