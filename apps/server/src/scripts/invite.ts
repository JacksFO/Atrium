/**
 * Mint an invite code.
 *   pnpm --filter @atrium/server invite            one use, 7 days
 *   pnpm --filter @atrium/server invite 5 30       five uses, 30 days
 */
import { randomBytes } from 'node:crypto'
import { db } from '../db.js'

const uses = Number(process.argv[2] ?? 1)
const days = Number(process.argv[3] ?? 7)

const code = `at-${randomBytes(9).toString('hex')}`
const expires = days > 0 ? Date.now() + days * 86_400_000 : null

db.prepare(
  'INSERT INTO invites (code, created_by, uses_left, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
).run(code, null, uses, expires, Date.now())

console.log(`\n  Invite code: ${code}`)
console.log(`  Uses: ${uses}`)
console.log(`  Expires: ${expires ? new Date(expires).toLocaleString() : 'never'}\n`)
