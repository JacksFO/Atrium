#!/usr/bin/env node
/**
 * Get a backup back.
 *
 * The nightly job encrypts a database snapshot and an archive of the uploads
 * and puts both in Cloudflare R2. Until this existed there was no way to
 * bring one back: r2.mjs could put and list, restore.mjs could decrypt a file
 * already on disk, and the step between them - fetching it - was missing. So
 * the backups looked complete from every angle except the only one that
 * counts.
 *
 *   node scripts/recover.mjs                 list what is in the bucket
 *   node scripts/recover.mjs latest <dir>    fetch and decrypt the newest set
 *   node scripts/recover.mjs <key> <dir>     fetch and decrypt one file
 *
 * Nothing here writes anywhere near the live database or uploads. It fetches
 * into a directory you name, and refuses if the file is already there -
 * recovering is a decision, and mid-disaster is the worst moment for a script
 * to be helpful with somebody's only remaining copy.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { get, list, r2Config } from './r2.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Load .env, the same way the other scripts do, without a dependency. */
function loadEnv() {
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq !== -1 && !process.env[t.slice(0, eq).trim()]) {
        process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
      }
    }
  } catch {
    // No .env. The config check below gives a better message than a crash.
  }
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'

loadEnv()
const cfg = r2Config(process.env)
if (!cfg) {
  console.log('R2 is not configured - set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,')
  console.log('R2_SECRET_ACCESS_KEY and R2_BUCKET in .env')
  process.exit(1)
}

const [, , what, outDir] = process.argv

const keys = await list(cfg)
if (keys.length === 0) {
  console.log('the bucket is empty - nothing has ever been uploaded')
  process.exit(1)
}

const uploadKeys = keys.filter((k) => k.startsWith('uploads/'))

if (!what) {
  console.log(`${keys.length} object(s) in ${cfg.bucket}:\n`)
  // Uploads are one object per file and there can be thousands. Listing every
  // one turns "what have I got" into a wall nobody reads.
  for (const k of keys) if (!k.startsWith('uploads/')) console.log('  ' + k)
  if (uploadKeys.length) console.log(`  uploads/ ... ${uploadKeys.length} file(s)`)
  console.log('\nfetch the newest set with:  node scripts/recover.mjs latest <directory>')
  process.exit(0)
}

if (!outDir) {
  console.log('say where to put it:  node scripts/recover.mjs ' + what + ' <directory>')
  process.exit(1)
}

const dest = resolve(outDir)
mkdirSync(dest, { recursive: true })

/**
 * The newest snapshot and the newest uploads archive.
 *
 * Picked independently: a run that snapshots the database and then fails
 * archiving the uploads leaves a bucket where the newest of each are from
 * different nights, and the newest database is still the right one to want.
 */
function newestOfEach() {
  const newest = (prefix) => keys.filter((k) => k.startsWith(prefix)).sort().pop()
  /*
   * Uploads are stored one object per file, so "the newest" is all of them -
   * there is no single archive to pick any more. The old whole-folder zips
   * are only worth fetching on a bucket that predates the change, where they
   * are the only copy of the uploads there is.
   */
  if (uploadKeys.length) return [newest('snapshot-'), ...uploadKeys].filter(Boolean)
  return [newest('snapshot-'), newest('uploads-')].filter(Boolean)
}

const wanted = what === 'latest' ? newestOfEach() : [what]
if (what !== 'latest' && !keys.includes(what)) {
  console.log('no such file in the bucket:', what)
  process.exit(1)
}

let failed = 0
for (const key of wanted) {
  const encrypted = join(dest, key)
  // "uploads/name.enc" is a path, not just a name: the folder has to exist
  // before anything can be written into it.
  mkdirSync(dirname(encrypted), { recursive: true })
  if (existsSync(encrypted)) {
    console.log(`already here, not re-fetching: ${key}`)
  } else {
    const bytes = await get(cfg, key, encrypted)
    console.log(`fetched   ${key}  ${mb(bytes)}`)
  }

  // Decrypting is the half that proves the backup is worth having. A file
  // that downloads and will not open is not better than no file.
  const plain = join(dest, key.replace(/\.enc$/, ''))
  if (existsSync(plain)) {
    console.log(`          already decrypted: ${plain}`)
    continue
  }
  try {
    execFileSync(process.execPath, [join(root, 'scripts', 'restore.mjs'), encrypted, plain], {
      stdio: 'pipe',
    })
    console.log(`decrypted ${plain}  ${mb(statSync(plain).size)}`)
  } catch (err) {
    failed++
    const detail = (err.stdout?.toString() || '') + (err.stderr?.toString() || '') || err.message
    console.log(`FAILED to decrypt ${key}: ${detail.trim().slice(0, 300)}`)
  }
}

if (failed) {
  console.log(`\n${failed} file(s) could not be decrypted. Check BACKUP_PASSPHRASE matches`)
  console.log('the one that was set when the backup was taken.')
  process.exit(1)
}

console.log(`\nrecovered into ${dest}`)
console.log('the .db is a database you can open; uploads/ holds the files, one per upload')
console.log('(an older bucket may have a .zip of the whole uploads folder instead)')
