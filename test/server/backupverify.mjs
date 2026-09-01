/*
 * A backup is opened before it is trusted - and says no when it should.
 *
 * A backup nobody has ever opened is a hope rather than a backup. Every way
 * of failing produces a file of about the right size with the right name,
 * sitting there looking healthy until the night somebody needs it.
 *
 * Both halves are here, and the second is the one that matters. Confirming
 * that a good backup verifies proves nothing about the day something is
 * wrong, which is the day nobody is watching - so most of this hands the
 * check files that are broken on purpose, in each of the ways a backup
 * actually breaks.
 *
 * Its own directory throughout. Nothing here reads or writes the real
 * backups, the real database, or anything the live server can see.
 */
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { verifyBackup, countsIn } from '../../scripts/verifybackup.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const PHRASE = 'a-passphrase-for-the-test'

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

function makeDatabase(file, messages = 40) {
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)')
  db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, body TEXT)')
  for (let i = 0; i < 5; i++) db.prepare('INSERT INTO users VALUES (?, ?)').run(`u${i}`, `person${i}`)
  for (let i = 0; i < messages; i++) db.prepare('INSERT INTO messages VALUES (?, ?)').run(`m${i}`, `x${i}`)
  db.close()
}

function freshWorld(messages = 40) {
  const work = mkdtempSync(join(tmpdir(), 'jc-backup-'))
  mkdirSync(join(work, 'data'), { recursive: true })
  mkdirSync(join(work, 'uploads'), { recursive: true })
  makeDatabase(join(work, 'data', 'atrium.db'), messages)
  return work
}

function runBackup(work, passphrase = PHRASE) {
  const env = {
    ...process.env,
    DATA_DIR: join(work, 'data'),
    UPLOAD_DIR: join(work, 'uploads'),
    BACKUP_DIR: join(work, 'backups'),
    BACKUP_PASSPHRASE: passphrase,
    BACKUP_KEEP: '3',
    // Never the real bucket.
    R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET: '',
  }
  try {
    return execFileSync(process.execPath, [join(ROOT, 'scripts/backup.mjs')],
      { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    return String(err.stdout ?? '') + String(err.stderr ?? '')
  }
}

const snapshotIn = (work) => {
  const dir = join(work, 'backups')
  const name = readdirSync(dir).find((f) => f.startsWith('snapshot-'))
  return join(dir, name)
}

// ---------------------------------------------------------------------------
console.log('\n  --- the whole thing, end to end ---')
{
  const work = freshWorld()
  const out = runBackup(work)
  check('a real run says it verified', /verified snapshot-/.test(out),
    out.match(/verified[^\n]*/)?.[0])
  check('and reports what it found in there', /40 messages and 5 people/.test(out))
  check('and warns about nothing', !/DID NOT VERIFY/.test(out))
  rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
console.log('\n  --- and now the half that matters: it says no ---')
{
  const work = freshWorld()
  runBackup(work)
  const file = snapshotIn(work)
  const good = readFileSync(file)
  const live = countsIn(join(work, 'data', 'atrium.db'))

  /* A disk that took the bytes and changed one. The file is the right size
     and the right name, and nothing else in the script would ever notice. */
  {
    const bytes = Buffer.from(good)
    bytes[Math.floor(bytes.length / 2)] ^= 0xff
    writeFileSync(file, bytes)
    const r = await verifyBackup(file, PHRASE, live)
    check('a flipped bit is caught', r.ok === false, r.why)
  }

  /* A disk that took the bytes and lost the end. */
  {
    writeFileSync(file, good.subarray(0, Math.floor(good.length * 0.6)))
    const r = await verifyBackup(file, PHRASE, live)
    check('a truncated file is caught', r.ok === false, r.why)
  }

  /*
   * The quiet killer: somebody changes BACKUP_PASSPHRASE, and every backup
   * afterwards is unreadable with the old one. Nobody finds out until a
   * restore, which is years of backups that were never going to work.
   */
  {
    writeFileSync(file, good)
    const r = await verifyBackup(file, 'a-completely-different-passphrase', live)
    check('a passphrase that no longer matches is caught', r.ok === false, r.why)
  }

  /* Something that is not a backup at all. */
  {
    writeFileSync(file, Buffer.from('this is not a backup, it is a text file'))
    const r = await verifyBackup(file, PHRASE, live)
    check('a file that is not a backup is caught', r.ok === false, r.why)
  }

  /* Empty. Some failures write nothing at all and leave the name behind. */
  {
    writeFileSync(file, Buffer.alloc(0))
    const r = await verifyBackup(file, PHRASE, live)
    check('an empty file is caught', r.ok === false, r.why)
  }

  rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
console.log('\n  --- intact, and still not a backup ---')
{
  /*
   * The case a plain integrity check would wave through. A snapshot of an
   * emptied database is whole, consistent, openable, and worth nothing - so
   * the check compares against what the live one held rather than only asking
   * SQLite whether the file is damaged.
   */
  const work = freshWorld()
  runBackup(work)
  const file = snapshotIn(work)
  const r = await verifyBackup(file, PHRASE, { messages: 5000, users: 900 })
  check('a snapshot short of what was live is caught', r.ok === false, r.why)
  check('and it says how short', /against 5000 live/.test(r.why ?? ''), r.why)
  rmSync(work, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
console.log('\n  --- a bad backup never retires a good one ---')
{
  /*
   * Pruning is the one irreversible thing the script does. Deleting the
   * oldest good backup to make room for one that has just been shown not to
   * open is precisely how a backup system destroys what it exists to protect:
   * quietly, on an ordinary night, months before anybody looks.
   */
  const work = freshWorld()
  for (let i = 0; i < 4; i++) {
    runBackup(work)
    // The names carry a timestamp to the second, so give each one its own.
    await new Promise((r) => setTimeout(r, 1100))
  }
  const dir = join(work, 'backups')
  const kept = readdirSync(dir).filter((f) => f.startsWith('snapshot-'))
  check('four runs, keeping three, leaves three', kept.length === 3, kept.length)

  /* Now make the source unreadable so tonight's snapshot cannot be good. */
  writeFileSync(join(work, 'data', 'atrium.db'), Buffer.from('not a database'))
  const before = readdirSync(dir).filter((f) => f.startsWith('snapshot-')).length
  const out = runBackup(work)
  const after = readdirSync(dir).filter((f) => f.startsWith('snapshot-')).length
  check('a run that cannot read the database deletes nothing',
    after >= before, { before, after })
  check('and says plainly what went wrong',
    /COULD NOT READ THE DATABASE/.test(out))
  check('and that the existing backups were left alone',
    /left alone/.test(out))
  rmSync(work, { recursive: true, force: true })
}

console.log('\n  ' + (bad === 0 ? 'a backup is opened before it is trusted' : bad + ' wrong'))
process.exitCode = bad === 0 ? 0 : 1
