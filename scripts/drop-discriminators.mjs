#!/usr/bin/env node
/**
 * Give everybody their plain name back.
 *
 * Four digits after a name is how a service with millions of people lets two
 * of them both be Keeko. This one has six. Registration refuses a name
 * somebody already holds now, so the digits have nothing left to tell apart.
 *
 * The column stays behind. Dropping it means rebuilding the users table for a
 * second time to remove something that costs nothing to keep, and keeping it
 * means this is reversible if the server ever has enough people to want it.
 *
 * Refuses to touch anything if two accounts share a name, because then the
 * digits are the only thing keeping them apart and clearing them would either
 * fail on the unique index or, worse, merge two people in the reader's head.
 *
 *   node scripts/drop-discriminators.mjs            # look
 *   node scripts/drop-discriminators.mjs --apply    # do it
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
  } catch { /* no .env */ }
  return fallback
}

const APPLY = process.argv.includes('--apply')
const db = new DatabaseSync(join(resolve(root, env('DATA_DIR', './data')), 'atrium.db'))
const say = (...a) => console.log(' ', ...a)

const shared = db.prepare(
  'SELECT username, COUNT(*) n FROM users GROUP BY lower(username) HAVING n > 1'
).all()
if (shared.length) {
  say('these names belong to more than one account, so the digits are load-bearing:')
  for (const s of shared) say(`  ${s.username}  (${s.n} accounts)`)
  say('nothing changed. sort those out first.')
  process.exit(1)
}

const withDigits = db.prepare("SELECT id, username, discriminator FROM users WHERE discriminator != ''").all()
if (!withDigits.length) { say('nobody has digits - nothing to do'); process.exit(0) }

for (const u of withDigits) say((APPLY ? 'doing:  ' : 'would:  ') + `${u.username}#${u.discriminator} -> ${u.username}`)

if (!APPLY) { console.log(); say('nothing was changed. pass --apply to do it.'); process.exit(0) }

db.exec('BEGIN')
try {
  const clear = db.prepare("UPDATE users SET discriminator = '' WHERE id = ?")
  for (const u of withDigits) clear.run(u.id)
  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error('  failed, nothing was changed:', err)
  process.exit(1)
}

console.log()
say('names now:')
for (const u of db.prepare('SELECT username, verified, role FROM users ORDER BY role DESC, username').all()) {
  say(`  ${u.username}${u.verified ? '  verified' : ''}${u.role === 'owner' ? '  (owner)' : ''}`)
}
