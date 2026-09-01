#!/usr/bin/env node
/**
 * Restore a backup.
 *
 * This exists because a backup nobody has ever restored is not a backup, it
 * is a folder of files you hope are useful. Run it against a real backup at
 * least once so you know it works before the day you need it.
 *
 *   node scripts/restore.mjs backups/snapshot-....db.enc out.db
 *
 * It never writes over the live database. Restoring is a decision, and the
 * last thing anybody needs mid-disaster is a script that helpfully overwrites
 * the thing they were about to inspect.
 */

import { createDecipheriv, scryptSync } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync, unlinkSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function env(key, fallback = '') {
  if (process.env[key]) return process.env[key]
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq !== -1 && t.slice(0, eq).trim() === key) return t.slice(eq + 1).trim()
    }
  } catch {
    // No .env; fall through.
  }
  return fallback
}

const [, , source, target] = process.argv
if (!source || !target) {
  console.log('usage: node scripts/restore.mjs <backup file> <output file>')
  process.exit(1)
}
if (!existsSync(source)) {
  console.log('no such backup:', source)
  process.exit(1)
}
if (existsSync(target)) {
  console.log('refusing to overwrite', target)
  process.exit(1)
}

if (!source.endsWith('.enc')) {
  await pipeline(createReadStream(source), createWriteStream(target))
  console.log('copied (this backup was not encrypted):', target)
  process.exit(0)
}

const passphrase = env('BACKUP_PASSPHRASE', '')
if (!passphrase) {
  console.log('BACKUP_PASSPHRASE is not set, and this backup is encrypted.')
  process.exit(1)
}

const whole = readFileSync(source)
if (whole.subarray(0, 5).toString() !== 'JCBK1') {
  console.log('that does not look like an Atrium backup')
  process.exit(1)
}

// Header is magic(5) + salt(16) + iv(12); the auth tag is the last 16 bytes.
const salt = whole.subarray(5, 21)
const iv = whole.subarray(21, 33)
const tag = whole.subarray(whole.length - 16)
const payload = whole.subarray(33, whole.length - 16)

const key = scryptSync(passphrase, salt, 32)
const decipher = createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)

try {
  await pipeline(
    // A single chunk: backups are small enough, and streaming a Buffer adds
    // nothing but ceremony.
    (async function* () { yield payload })(),
    decipher,
    createGunzip(),
    createWriteStream(target),
  )
} catch (err) {
  // A wrong passphrase fails here, at the authentication tag, rather than
  // producing a plausible-looking corrupt file.
  console.log('could not decrypt:', err instanceof Error ? err.message : err)
  console.log('the passphrase is probably wrong, or the file is damaged')
  // The stream created the destination before it failed. An empty file left
  // sitting there invites somebody to point a server at it and conclude they
  // have lost everything. Safe to remove unconditionally: the run refuses to
  // start at all if the target already exists.
  try { unlinkSync(target) } catch {}
  process.exit(1)
}

console.log('restored to', target)
console.log('check it with:  node -e "const {DatabaseSync}=require(\'node:sqlite\');' +
            'const d=new DatabaseSync(\'' + target.replace(/\\/g, '/') + "','r');" +
            'console.log(d.prepare(\'SELECT COUNT(*) AS n FROM messages\').get())"')
