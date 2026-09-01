import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { db, forgetUpload } from './db.js'
import { config } from './config.js'

/**
 * Files nobody points at any more.
 *
 * Deleting a message removes its row and cascades the attachment row, but the
 * file itself stayed on disk for good. Nothing ever looked at it again and
 * nothing ever removed it, so the folder only grew - and every nightly backup
 * carried the whole lot offsite again.
 */

/** Every path the database still refers to, as bare filenames. */
function referenced(): Set<string> {
  const out = new Set<string>()
  /*
   * The stored name, without whatever is attached to the link.
   *
   * A signed path carries ?e=...&s=..., and basename kept it - so the name
   * this collected could never match a file on disk, and the sweep below
   * happily deleted something the database was still pointing at.
   */
  const add = (p: unknown) => {
    if (typeof p === 'string' && p) out.add(basename(p.split('?')[0]!))
  }
  for (const r of db.prepare('SELECT path FROM attachments').all() as unknown as Array<{ path: string }>) {
    add(r.path)
  }
  for (const r of db.prepare('SELECT avatar_path, banner_path FROM users').all() as unknown as
    Array<{ avatar_path: string | null; banner_path: string | null }>) {
    add(r.avatar_path)
    add(r.banner_path)
  }
  /*
   * And the picture on a server.
   *
   * Missing from this list entirely, so the first sweep after somebody set
   * one deleted it - the database went on pointing at a file that was no
   * longer there, and the rail fell back to showing the alt text. Reported
   * as "he has a custom icon and I just see this".
   */
  for (const r of db.prepare('SELECT icon_path FROM spaces').all() as unknown as
    Array<{ icon_path: string | null }>) {
    add(r.icon_path)
  }
  /*
   * And anything somebody uploaded, whether or not it ever became anything.
   *
   * This list was attachments, avatars, banners and icons - so a file that
   * was uploaded and never sent, or whose message was removed, matched
   * nothing here and counted as an orphan. It is not an orphan; it is
   * somebody's file that has not been used yet. Eight of the upload records
   * on this machine point at files that are no longer there, which is what
   * that looked like from the other side.
   */
  for (const r of db.prepare('SELECT name FROM uploads').all() as unknown as
    Array<{ name: string }>) {
    add(r.name)
  }
  return out
}

/**
 * What is on disk, and what the database thinks is on disk.
 *
 * This used to delete: every file the database did not mention went, after an
 * hour's grace. It is a report now and removes nothing, because a sweep that
 * deletes is a sweep that can be wrong about something irreplaceable - and
 * this one already was. On 2026-08-29 it ran against a mismatched DATA_DIR
 * and emptied the real uploads folder: every avatar, every server icon,
 * every banner. Most came back from the offsite copy. The two uploaded since
 * the last nightly run did not.
 *
 * The guards below were added after that and are good ones. They are also
 * guesses about how wrong the database looks, and the thing they are
 * protecting cannot be regenerated. Nothing anybody uploads is now removed
 * except by the person who put it there - deleting their message, or
 * replacing their own picture.
 *
 * So this counts, names and reports. Somebody reading the log can decide.
 */
export function reconcileUploads(): {
  /** On disk, and nothing in the database points at it. */
  unreferenced: string[]
  /** The database points at it, and it is not there. */
  missing: string[]
  /** How much the unreferenced files take up. */
  bytes: number
} {
  const keep = referenced()

  let names: string[]
  try {
    names = readdirSync(config.uploadDir)
  } catch {
    return { unreferenced: [], missing: [], bytes: 0 }
  }

  const unreferenced: string[] = []
  let bytes = 0
  for (const name of names) {
    if (keep.has(name)) continue
    try {
      const st = statSync(resolve(config.uploadDir, name))
      if (!st.isFile()) continue
      unreferenced.push(name)
      bytes += st.size
    } catch {
      /* Vanished underneath us while we were looking. */
    }
  }

  /*
   * And the other direction, which nothing used to ask about.
   *
   * A record pointing at a file that is not there is the more troubling of
   * the two: the first is wasted disk, the second is somebody being told
   * they still have something they do not.
   */
  const here = new Set(names)
  const missing = [...keep].filter((n) => !here.has(n))

  return { unreferenced, missing, bytes }
}

/**
 * Remove the files belonging to one message, before its rows go.
 *
 * Called while the attachment rows still exist - afterwards the cascade has
 * taken them and there is nothing left to say which files were involved.
 */
/**
 * Finish deletions whose undo window has closed.
 *
 * The row is kept for a few seconds so it can be put back, which means
 * something has to come along afterwards and actually remove it - together
 * with the files nothing points at any more.
 *
 * Returns how many it finished, for the log.
 */
export function sweepDeleted(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs
  const rows = db
    .prepare('SELECT id FROM messages WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .all(cutoff) as unknown as Array<{ id: string }>

  for (const r of rows) {
    // Before the row goes: the cascade takes the attachment rows with it, and
    // then nothing knows which files belonged to this message.
    removeAttachmentsOf(r.id)
    db.prepare('DELETE FROM messages WHERE id = ?').run(r.id)
  }
  return rows.length
}

export function removeAttachmentsOf(messageId: string): void {
  const rows = db
    .prepare('SELECT path FROM attachments WHERE message_id = ?')
    .all(messageId) as unknown as Array<{ path: string }>

  for (const r of rows) {
    /*
     * Not if anybody else is still pointing at it.
     *
     * Two messages can share a file now that an imported GIF is stored under
     * a name taken from its own contents - send the same one twice and the
     * second send costs nothing. Which makes this the dangerous line in the
     * program: deleting one of those messages used to take the file with it
     * and leave the other one showing a hole, with no way back short of the
     * nightly backup.
     */
    const shared = db
      .prepare('SELECT 1 AS x FROM attachments WHERE path = ? AND message_id != ? LIMIT 1')
      .get(r.path, messageId) as unknown as { x: number } | undefined
    if (shared) continue

    // Only ever a name we generated ourselves, but resolve and check anyway:
    // this deletes files, and a path from a table is still a path.
    const name = basename(r.path)
    const full = resolve(config.uploadDir, name)
    if (!full.startsWith(resolve(config.uploadDir))) continue
    try { unlinkSync(full) } catch { /* already gone */ }
    forgetUpload(name)
  }
}

/**
 * Which missing files this machine has already been told about.
 *
 * The count on its own is a warning in a log nobody reads, and it has been
 * seven for days - so the line that matters is not "seven are missing" but
 * "one that was here yesterday is not here today". Nothing removes a file
 * now except the person who put it there, so a name appearing in this list
 * that was not in it before means something is deleting again.
 *
 * Null rather than an empty list when there is no record yet: those are
 * different, and treating the first as the second turns the very first run
 * on any machine into an alarm about every file it has ever lost.
 */
export function knownMissing(dataDir: string): string[] | null {
  try {
    const raw = JSON.parse(readFileSync(resolve(dataDir, 'uploads-missing.json'), 'utf8'))
    /* Anything but a list of strings is not a record, it is damage. Being
       told nothing is known is the safe reading of it. */
    if (!Array.isArray(raw)) return null
    return raw.filter((n): n is string => typeof n === 'string')
  } catch {
    return null
  }
}

export function rememberMissing(dataDir: string, names: string[]): void {
  try {
    writeFileSync(resolve(dataDir, 'uploads-missing.json'), JSON.stringify([...names].sort(), null, 1))
  } catch {
    /* A note about missing files is not worth failing a boot over. */
  }
}

/** In the second list and not the first - the only part worth waking up for. */
export function newlyMissing(known: string[], now: string[]): string[] {
  const seen = new Set(known)
  return now.filter((n) => !seen.has(n))
}
