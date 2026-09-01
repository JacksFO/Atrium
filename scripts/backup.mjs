#!/usr/bin/env node
/**
 * Nightly backup.
 *
 * Everything Atrium holds lives in one folder on one machine: a SQLite
 * database and whatever people have uploaded. A failed disk loses every
 * message, every account and every photo anybody has ever posted, with no
 * second copy anywhere. That is the single largest risk this project has.
 *
 * Run it with:  node scripts/backup.mjs
 * Nightly with: scripts/install-backup-task.cmd
 *
 * Two things worth knowing about backing up SQLite:
 *
 * Copying the file while the server is running can capture a torn database -
 * a write half applied, with the rest sitting in the write-ahead log. The
 * VACUUM INTO statement asks SQLite for a consistent snapshot instead, which
 * is safe to take while the server is serving.
 *
 * And the backup is encrypted, because it is meant to be copied somewhere
 * else. A backup you cannot put in cloud storage without worrying is a backup
 * that quietly stops being made.
 */

import { DatabaseSync } from 'node:sqlite'
import {
  createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash,
} from 'node:crypto'
import {
  createReadStream, createWriteStream, existsSync, mkdirSync,
  readdirSync, readFileSync, statSync, rmSync, unlinkSync, copyFileSync,
} from 'node:fs'
import { createGzip, createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { resolve, dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { r2Config, put as r2Put, list as r2List, remove as r2Remove } from './r2.mjs'
import { verifyBackup, countsIn } from './verifybackup.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Read .env without a dependency, the same way the server does. */
function env(key, fallback = '') {
  if (process.env[key]) return process.env[key]
  try {
    for (const line of readFileSyncSafe(join(root, '.env')).split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      if (t.slice(0, eq).trim() === key) return t.slice(eq + 1).trim()
    }
  } catch {
    // No .env. The fallback below is the answer.
  }
  return fallback
}

function readFileSyncSafe(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const DATA = resolve(root, env('DATA_DIR', './data'))
const UPLOADS = resolve(root, env('UPLOAD_DIR', './uploads'))
const OUT = resolve(root, env('BACKUP_DIR', './backups'))
/*
 * How many database snapshots to keep.
 *
 * This used to govern the uploads too, which was the wrong shape: the two
 * differ by four orders of magnitude and by risk. A snapshot is a couple of
 * hundred kilobytes and is genuinely different every night, so keeping a
 * month of them costs about six megabytes and buys a month of "put it back
 * how it was on Tuesday". Uploads are megabytes each and never change once
 * written, so keeping fourteen copies of them bought nothing and multiplied
 * the bill by fourteen.
 */
const KEEP = Number(env('BACKUP_KEEP', '30'))
const PASSPHRASE = env('BACKUP_PASSPHRASE', '')

// Read before the uploads run, because whether there is somewhere offsite to
// put them decides how they are backed up at all.
const r2 = r2Config({
  R2_ACCOUNT_ID: env('R2_ACCOUNT_ID'),
  R2_ACCESS_KEY_ID: env('R2_ACCESS_KEY_ID'),
  R2_SECRET_ACCESS_KEY: env('R2_SECRET_ACCESS_KEY'),
  R2_BUCKET: env('R2_BUCKET'),
})

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function log(...args) {
  console.log(`[backup ${new Date().toISOString()}]`, ...args)
}

/*
 * One file, now, rather than at three in the morning.
 *
 *   node scripts/backup.mjs --upload <stored-name>
 *
 * The nightly run copies whatever is on disk when it runs, which leaves an
 * upload with no second copy for up to a day. That gap is not theoretical:
 * of the eight files this machine lost to the old orphan sweep, seven were
 * uploaded and gone again inside the same day, so no nightly run ever saw
 * them - and only the one that had survived a night could be brought back.
 *
 * This is called by the server the moment it stores a file. It is
 * deliberately the same code the nightly run uses, down to the key and the
 * encryption, because a copy the recovery script cannot read is not a copy.
 * Failure is fine and silent-ish: the nightly run still sweeps up anything
 * that did not make it, which is what makes this safe to treat as best
 * effort rather than something the upload has to wait for.
 */
const one = process.argv.indexOf('--upload')
if (one !== -1) {
  const name = process.argv[one + 1] ?? ''
  /* A name this server generated: a UUID and an extension, nothing else.
     It becomes a key and a path, so it is checked rather than trusted. */
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name.includes('..')) {
    log(`refusing to copy a name that is not one of ours: ${name}`)
    process.exit(2)
  }
  if (!r2) {
    log('offsite is not configured - nothing to do')
    process.exit(0)
  }
  const source = join(UPLOADS, name)
  if (!existsSync(source)) {
    log(`${name} is not on disk - nothing to copy`)
    process.exit(0)
  }

  const key = `uploads/${name}${PASSPHRASE ? '.enc' : ''}`
  let sending = source
  /*
   * Tidied by hand rather than in a finally.
   *
   * process.exit() ends the process there and then: a finally after it never
   * runs. Written that way first, this left a full-size encrypted copy of
   * every upload in the backups folder for ever - the exact thing the nightly
   * run's own staging cleanup carries a comment about, reintroduced two
   * hundred lines above it.
   */
  const tidy = () => { if (sending !== source) rmSync(sending, { force: true }) }

  try {
    if (PASSPHRASE) {
      mkdirSync(OUT, { recursive: true })
      sending = join(OUT, `.one-${process.pid}-${name}.enc`)
      await encrypt(source, sending, PASSPHRASE)
    }
    const sent = await r2Put(r2, key, sending)
    tidy()
    log(`offsite: ${name} copied on arrival (${(sent / 1024).toFixed(0)} KB)`)
    process.exit(0)
  } catch (err) {
    tidy()
    /* Tomorrow's run will find it. Say so plainly rather than looking like
       a loss, and exit non-zero so the caller can log the difference. */
    log(`offsite: ${name} could not be copied now - ${err instanceof Error ? err.message : err}`)
    log('offsite: the nightly run will pick it up')
    process.exit(1)
  }
}

mkdirSync(OUT, { recursive: true })

// ---------------------------------------------------------------- database --
const dbFile = join(DATA, 'atrium.db')
if (!existsSync(dbFile)) {
  log('no database at', dbFile, '- nothing to back up')
  process.exit(0)
}

const snapshot = join(OUT, `snapshot-${stamp}.db`)
try {
  // Read only: this must never be able to change what it is protecting.
  const db = new DatabaseSync(dbFile, { readOnly: true })
  // VACUUM INTO is atomic and consistent even while the server is writing.
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`)
  db.close()
} catch (err) {
  /*
   * The database itself will not open or will not copy.
   *
   * This used to throw a raw stack trace out of a scheduled task nobody
   * watches - which is the one moment a backup script has to be clear. Say
   * what happened, leave every existing backup exactly where it is, and exit
   * non-zero so the task shows as failed rather than as a quiet success.
   */
  log('*********************************************************')
  log('*  COULD NOT READ THE DATABASE - nothing was backed up')
  log(`*  ${err instanceof Error ? err.message : err}`)
  log('*  Every existing backup has been left alone.')
  log('*********************************************************')
  try { unlinkSync(snapshot) } catch { /* never made */ }
  process.exit(1)
}
log('database snapshot taken')

// ----------------------------------------------------------------- uploads --
/*
 * Uploads are copied once each, not re-archived every night.
 *
 * This used to zip the whole uploads folder nightly and keep fourteen of the
 * zips. Since an upload is named for a UUID and is never modified, every one
 * of those fourteen copies held the same bytes as the last - so the bucket
 * carried fourteen times the data it needed, and each night pushed the entire
 * folder back out of the house to say that nothing had changed. At the point
 * where that folder reached a gigabyte it would have been a gigabyte a night,
 * uploaded to store a duplicate of what was already there.
 *
 * One object per file instead. A file that is already offsite is skipped, so
 * a normal night uploads only what was actually posted that day, and usually
 * nothing at all.
 *
 * The zip stays as the fallback for a machine with nowhere offsite
 * configured: there, a second local copy is the only protection against
 * somebody deleting a file, and it is better than none.
 */
const uploadsZip = join(OUT, `uploads-${stamp}.zip`)
let localFiles = []
if (existsSync(UPLOADS)) {
  localFiles = readdirSync(UPLOADS).filter((f) => statSync(join(UPLOADS, f)).isFile())
}

if (!r2 && localFiles.length > 0) {
  try {
    execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${UPLOADS}\\*' -DestinationPath '${uploadsZip}' -CompressionLevel NoCompression -Force`,
    ], { stdio: 'ignore' })
    log(`uploads archived locally (${localFiles.length} files) - nowhere offsite is configured`)
  } catch {
    log('could not archive uploads; the database snapshot is still good')
  }
}

// -------------------------------------------------------------- encryption --
async function encrypt(src, dest, passphrase) {
  // scrypt turns a passphrase people can remember into a key, and the salt
  // makes two backups of the same file look completely different.
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const out = createWriteStream(dest)
  // Header: magic, salt, iv. The tag is appended once the stream ends.
  out.write(Buffer.concat([Buffer.from('JCBK1'), salt, iv]))

  await pipeline(createReadStream(src), createGzip(), cipher, out, { end: false })
  out.end(cipher.getAuthTag())
  await new Promise((res, rej) => { out.on('close', res); out.on('error', rej) })
}

function sha256(file) {
  const h = createHash('sha256')
  h.update(readFileSync(file))
  return h.digest('hex').slice(0, 16)
}

const made = []
for (const file of [snapshot, existsSync(uploadsZip) ? uploadsZip : null].filter(Boolean)) {
  if (PASSPHRASE) {
    const enc = `${file}.enc`
    await encrypt(file, enc, PASSPHRASE)
    unlinkSync(file)
    made.push(enc)
  } else {
    made.push(file)
  }
}

if (!PASSPHRASE) {
  log('WARNING: BACKUP_PASSPHRASE is not set, so these are in the clear.')
  log('         Set one in .env before copying them anywhere off this machine.')
}

for (const f of made) {
  log(`${basename(f)}  ${(statSync(f).size / 1024 / 1024).toFixed(1)} MB  sha256:${sha256(f)}`)
}

// ------------------------------------------------------------------ check --
/*
 * Read it back, and prove it could actually be restored.
 *
 * A backup nobody has ever opened is a hope, not a backup. Everything here
 * succeeded quietly whatever it wrote: a truncated snapshot, a passphrase
 * that had changed since the last run, a disk that accepted the bytes and
 * lost them - each of those produces a file of about the right size that sits
 * there looking fine until the night somebody needs it.
 *
 * So the last thing this does is the first thing a restore would do. Decrypt
 * it, unzip it, open it as a database, and ask SQLite whether it is whole -
 * then check it holds roughly what the live one holds, because a valid empty
 * database would pass every other test in this file.
 *
 * The temporary copy is deleted whatever happens. The check is read-only and
 * never touches the backup itself.
 */
async function verify(file, live) {
  const scratch = join(OUT, `.verify-${process.pid}.db`)

  const clean = () => { try { unlinkSync(scratch) } catch { /* never made */ } }

  try {
    if (PASSPHRASE) {
      const whole = readFileSync(file)
      if (whole.subarray(0, 5).toString() !== 'JCBK1') {
        return { ok: false, why: 'not an Atrium backup - wrong header' }
      }
      // magic(5) + salt(16) + iv(12), and the auth tag is the last 16 bytes.
      const key = scryptSync(PASSPHRASE, whole.subarray(5, 21), 32)
      const decipher = createDecipheriv('aes-256-gcm', key, whole.subarray(21, 33))
      decipher.setAuthTag(whole.subarray(whole.length - 16))
      await pipeline(
        (async function* () { yield whole.subarray(33, whole.length - 16) })(),
        decipher,
        createGunzip(),
        createWriteStream(scratch),
      )
    } else {
      copyFileSync(file, scratch)
    }

    const db = new DatabaseSync(scratch, { readOnly: true })
    try {
      const whole = Object.values(db.prepare('PRAGMA integrity_check').get())[0]
      if (whole !== 'ok') return { ok: false, why: `sqlite says: ${whole}` }

      /*
       * And that it is this database rather than merely a database. A backup
       * of an empty file is intact, consistent, and worth nothing.
       */
      const rows = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
      if (rows < live.messages) {
        return { ok: false, why: `only ${rows} messages, against ${live.messages} live` }
      }
      const people = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
      if (people < live.users) {
        return { ok: false, why: `only ${people} people, against ${live.users} live` }
      }
      return { ok: true, messages: rows, users: people }
    } finally {
      db.close()
    }
  } catch (err) {
    // A wrong passphrase fails at the authentication tag, which is exactly
    // the failure worth catching here rather than in a year.
    return { ok: false, why: err instanceof Error ? err.message : String(err) }
  } finally {
    clean()
  }
}

/* What the live one held when the snapshot was taken, to compare against. */
const liveCounts = countsIn(dbFile)

let allGood = true
for (const f of made) {
  if (!basename(f).startsWith('snapshot-')) continue
  const result = await verifyBackup(f, PASSPHRASE, liveCounts, join(OUT, `.checking-${process.pid}.db`))
  if (result.ok) {
    log(`verified ${basename(f)} - opens, intact, ${result.messages} messages and ${result.users} people`)
  } else {
    allGood = false
    log('*********************************************************')
    log(`*  ${basename(f)} DID NOT VERIFY`)
    log(`*  ${result.why}`)
    log('*  This file should not be relied on. The previous ones')
    log('*  are still here and have not been pruned.')
    log('*********************************************************')
  }
}

// ------------------------------------------------------------------ prune --
// Keep the last N of each kind. Without this the disk fills up silently and
// the backup that fills it is the one that stops the server.
/*
 * Snapshots only.
 *
 * The uploads-*.zip archives are from before uploads were stored one object
 * per file, and they are deliberately never deleted. They are the only record
 * of anything that was posted and then deleted before the switch: those files
 * are not in the uploads folder any more, so they were never copied out
 * individually and exist nowhere else. Nothing creates new ones, so the set
 * is fixed and small - which is the whole reason it can simply be left.
 */
/*
 * And not at all if tonight's did not verify.
 *
 * Pruning is the one irreversible thing this script does. Deleting the oldest
 * good backup to make room for one that has just been shown not to open is
 * the precise way a backup system destroys the thing it exists to protect -
 * quietly, on an ordinary night, months before anybody looks.
 */
if (!allGood) {
  log("not pruning: tonight's snapshot did not verify, so nothing old is being removed")
} else {
  const mine = readdirSync(OUT)
    .filter((f) => f.startsWith('snapshot-'))
    .sort()
    .reverse()
  for (const old of mine.slice(KEEP)) {
    rmSync(join(OUT, old), { force: true })
    log('pruned', old)
  }
}

// --------------------------------------------------------------- logs --
/*
 * The logs, which nothing has ever removed.
 *
 * They are written one file per day by the launcher and kept for ever. That
 * was harmless while a day was small; it stopped being small when the server
 * started logging every request twice, and a single day reached thirteen
 * megabytes. That is fixed at the source now - only failed and slow requests
 * are written - but nothing was ever going to remove the files themselves.
 *
 * Here rather than in the server, because the server does not own them: the
 * launcher redirects into them and only this script runs on a schedule with
 * the job of keeping the disk from filling.
 *
 * Two rules, both of them about not deleting something somebody needs:
 * today's log is never touched, whatever its date says, because the server
 * is writing to it right now; and nothing is removed on a night when the
 * snapshot did not verify, for the same reason the snapshots are not.
 */
const LOG_DIR = resolve(root, 'logs')
const LOG_DAYS = Number(env('LOG_KEEP_DAYS', '21'))

if (!allGood) {
  log('not pruning logs either: nothing old is being removed tonight')
} else if (!existsSync(LOG_DIR)) {
  log('no logs folder; nothing to prune')
} else {
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = Date.now() - LOG_DAYS * 24 * 60 * 60 * 1000
  let gone = 0
  let freed = 0
  for (const name of readdirSync(LOG_DIR)) {
    if (!name.endsWith('.log')) continue
    /* Named by the day they cover. The name is what decides, not the
       modified time - a file touched by a restart is still last week's. */
    const day = (/(\d{4}-\d{2}-\d{2})/.exec(name) ?? [])[1]
    if (!day || day === today) continue
    if (Date.parse(day + 'T00:00:00Z') >= cutoff) continue
    const full = join(LOG_DIR, name)
    try {
      freed += statSync(full).size
      rmSync(full, { force: true })
      gone++
    } catch (err) {
      log(`could not remove ${name} - ${err instanceof Error ? err.message : err}`)
    }
  }
  log(gone > 0
    ? `pruned ${gone} log file(s) older than ${LOG_DAYS} days, freeing ${(freed / 1048576).toFixed(1)} MB`
    : `no logs older than ${LOG_DAYS} days`)
}

// ------------------------------------------------------------- offsite --
// A backup on the same disk as the thing it protects is not a backup: one
// failure takes both. Best effort - if the network is down the local copy
// still happened, and saying so is more useful than failing the run.
// Built from this script's own reader, not process.env: the settings live in
// .env and nothing here loads them into the environment.
if (!r2) {
  log('offsite: not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)')
} else {
  let sent = 0
  for (const file of made) {
    try {
      const bytes = await r2Put(r2, basename(file), file)
      sent += 1
      log(`offsite: ${basename(file)} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    } catch (err) {
      log(`offsite: ${basename(file)} FAILED - ${err instanceof Error ? err.message : err}`)
    }
  }
  /*
   * The same rule as locally: a snapshot that did not verify must not retire
   * one that would have opened. Offsite is the copy that survives the house
   * burning down, and it is the last place to be clever about disk.
   */
  if (sent && !allGood) {
    log("offsite: not pruning - the snapshot did not verify")
  } else if (sent) {
    // Snapshots are the only thing here with copies to retire. Uploads are
    // held one per file, and the old whole-folder zips are kept for the same
    // reason as locally - they hold anything deleted before the switch.
    try {
      const remote = (await r2List(r2, 'snapshot-')).sort().reverse()
      for (const old of remote.slice(KEEP)) {
        await r2Remove(r2, old)
        log('offsite: pruned', old)
      }
    } catch (err) {
      log(`offsite: could not prune snapshots - ${err instanceof Error ? err.message : err}`)
    }
  }

  // -------------------------------------------------------- uploads, once --
  /*
   * Each file goes up under its own key, and only if it is not there already.
   *
   * Nothing is ever removed from here automatically. A file missing locally
   * is either a message somebody deleted or a mistake, and a backup that
   * deletes its only copy the moment the original goes is not protecting
   * against the thing people actually need protecting from. Orphans are
   * reported instead, so removing one stays a decision somebody makes.
   *
   * The key is the filename, and the filename is a UUID the server generated
   * plus an extension - nothing in it needs escaping in a URL. That is worth
   * knowing rather than assuming: keys are sent to R2 unencoded, because the
   * request signer is the one place that encodes the path and doing it twice
   * is what made the first attempt at this fail.
   *
   * A key also carries .enc only while a passphrase is set. Setting or
   * clearing one later changes every key, so everything would upload again
   * and the previous copies would show up as orphans - correctly, since
   * nothing can read them without the old passphrase anyway.
   */
  try {
    const already = new Set(await r2List(r2, 'uploads/'))
    const tmp = join(OUT, '.staging')
    mkdirSync(tmp, { recursive: true })

    let fresh = 0
    let bytes = 0
    let failed = 0
    try {
      for (const name of localFiles) {
        const key = `uploads/${name}${PASSPHRASE ? '.enc' : ''}`
        if (already.has(key)) continue

        const source = join(UPLOADS, name)
        let toSend = source
        /*
         * One file failing must not take the rest of the night with it.
         *
         * Without this a single unreadable file, or one refused by the far
         * end, threw straight out of the loop - so everything after it was
         * never attempted, the staging folder was left behind, and the run
         * reported a bare failure with no count of what had got through.
         * Every file is independent here, so treat them that way and say at
         * the end how many did not make it.
         */
        try {
          if (PASSPHRASE) {
            toSend = join(tmp, `${name}.enc`)
            await encrypt(source, toSend, PASSPHRASE)
          }
          bytes += await r2Put(r2, key, toSend)
          fresh += 1
        } catch (err) {
          failed += 1
          log(`offsite: ${name} FAILED - ${err instanceof Error ? err.message : err}`)
        } finally {
          if (PASSPHRASE && toSend !== source) rmSync(toSend, { force: true })
        }
      }
    } finally {
      // Left behind on any exit, this quietly fills the disk with encrypted
      // copies of files that are already backed up.
      rmSync(tmp, { recursive: true, force: true })
    }

    const held = already.size + fresh
    if (fresh) log(`offsite: ${fresh} new upload(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`)
    else log(`offsite: uploads unchanged, nothing to send`)
    if (failed) log(`offsite: ${failed} upload(s) could not be sent - they will be retried tomorrow`)

    // Anything offsite whose original is gone. Kept, and said out loud.
    const wanted = new Set(localFiles.map((n) => `uploads/${n}${PASSPHRASE ? '.enc' : ''}`))
    const orphans = [...already].filter((k) => !wanted.has(k))
    log(`offsite: holding ${held} upload(s)${orphans.length ? `, ${orphans.length} no longer on the server` : ''}`)
  } catch (err) {
    log(`offsite: uploads FAILED - ${err instanceof Error ? err.message : err}`)
  }
}

log(`done. ${made.length} file(s) in ${OUT}`)
