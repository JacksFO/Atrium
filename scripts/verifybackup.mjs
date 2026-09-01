/*
 * Open a backup and prove it could be restored.
 *
 * Its own file so it can be handed a broken one. Left inside backup.mjs it
 * could only ever be exercised on files that script had just written, which
 * are the ones that are fine - and a check whose failure path has never run
 * is not a check, it is a comment.
 *
 * The failures this is for all produce a file of about the right size with
 * the right name:
 *
 *   a truncated write        the disk took the bytes and lost the end
 *   a flipped bit            the disk took them and changed one
 *   a changed passphrase     everything since is unreadable with the old one
 *   a snapshot of nothing    intact, consistent, and worth nothing
 *
 * Each of those sits there looking healthy until the night somebody needs it.
 */
import { createDecipheriv, scryptSync } from 'node:crypto'
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/** The header every encrypted backup starts with. */
const MAGIC = 'JCBK1'

/**
 * Look inside a backup.
 *
 * `expected` is what the live database held when the snapshot was taken. A
 * backup with fewer rows than the thing it copied is a backup of a moment
 * that never happened, and passing zeroes still catches a file that will not
 * open at all.
 *
 * Never throws, and never touches the file it is given. The scratch copy is
 * removed whatever happens.
 */
export async function verifyBackup(file, passphrase, expected = {}, scratch = `${file}.checking`) {
  const want = { messages: 0, users: 0, ...expected }

  try {
    if (passphrase) {
      const whole = readFileSync(file)
      if (whole.length < 34) return { ok: false, why: 'too short to be a backup at all' }
      if (whole.subarray(0, MAGIC.length).toString() !== MAGIC) {
        return { ok: false, why: 'wrong header - not an Atrium backup' }
      }
      // magic(5) + salt(16) + iv(12), and the auth tag is the last 16 bytes.
      const key = scryptSync(passphrase, whole.subarray(5, 21), 32)
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
      const state = Object.values(db.prepare('PRAGMA integrity_check').get())[0]
      if (state !== 'ok') return { ok: false, why: `sqlite says: ${state}` }

      const messages = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
      const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
      if (messages < want.messages) {
        return { ok: false, why: `${messages} messages, against ${want.messages} live` }
      }
      if (users < want.users) {
        return { ok: false, why: `${users} people, against ${want.users} live` }
      }
      return { ok: true, messages, users }
    } finally {
      db.close()
    }
  } catch (err) {
    /*
     * A wrong passphrase and a flipped bit both land here, at the
     * authentication tag - which is the point of using GCM. Neither produces
     * a plausible-looking file that gets as far as SQLite.
     */
    return { ok: false, why: err instanceof Error ? err.message : String(err) }
  } finally {
    try { unlinkSync(scratch) } catch { /* never made */ }
  }
}

/** What the live database holds, to compare a snapshot against. */
export function countsIn(dbFile) {
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true })
    try {
      return {
        messages: db.prepare('SELECT COUNT(*) AS n FROM messages').get().n,
        users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      }
    } finally {
      db.close()
    }
  } catch {
    // Comparing against zero still catches a backup that will not open.
    return { messages: 0, users: 0 }
  }
}

export { writeFileSync }
