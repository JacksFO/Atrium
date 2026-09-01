import { mkdirSync, writeFileSync, utimesSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { config } from './config.js'
import { db } from './db.js'
import { reconcileUploads } from './uploads.js'

/**
 * Nothing removes somebody's file except the person who put it there.
 *
 * There used to be a sweep here that deleted every file the database did not
 * mention. That is right when the database is the one those files belong to,
 * and catastrophic when it is not - a server started with DATA_DIR pointing at
 * a test copy has an empty database, so every real upload is an orphan and
 * every one goes.
 *
 * On 2026-08-29 that emptied the live uploads folder: every avatar, server
 * icon and banner. They came back from the offsite copy; the two uploaded
 * after the last nightly run did not. Nothing warned, because from inside the
 * function it looked like an ordinary tidy-up of forty-four stale files.
 *
 * Guards were added for that, and they were good guards. They were also
 * guesses about how wrong a database looks, standing between a scheduled job
 * and something nobody can regenerate. So the job does not delete any more.
 * It counts and it says what it found, and a person decides.
 *
 * Which makes the test simpler than the guards were: whatever the state, the
 * files are still there afterwards.
 */

/** A file old enough that the old sweep would have taken it. */
function stale(name: string) {
  const full = join(config.uploadDir, name)
  writeFileSync(full, 'x')
  const old = new Date(Date.now() - 3 * 60 * 60_000)
  utimesSync(full, old, old)
  return full
}

const clear = () => {
  mkdirSync(config.uploadDir, { recursive: true })
  for (const n of readdirSync(config.uploadDir)) {
    rmSync(join(config.uploadDir, n), { force: true })
  }
}

describe('looking at the uploads folder', () => {
  it('reports what nothing points at, and removes none of it', () => {
    clear()
    for (let i = 0; i < 12; i++) stale(`mismatch-${i}.png`)

    /* The precondition, asserted rather than assumed: this database really
       does reference none of them. */
    const referenced = db.prepare(
      'SELECT COUNT(*) c FROM users WHERE avatar_path IS NOT NULL OR banner_path IS NOT NULL',
    ).get() as { c: number }
    expect(referenced.c).toBe(0)

    const out = reconcileUploads()
    expect(out.unreferenced).toHaveLength(12)
    expect(out.bytes).toBeGreaterThan(0)

    /* The whole point. Twelve files it could not account for, and twelve
       files still on the disk. */
    expect(readdirSync(config.uploadDir)).toHaveLength(12)
  })

  /*
   * The case that used to be silent data loss and is now not even a report.
   *
   * A file is saved before the message carrying it is sent, and a message can
   * be removed while its upload record stays. Neither is an orphan - both are
   * somebody's file. The old list of what counts as referenced was
   * attachments, avatars, banners and icons, so both looked like rubbish.
   */
  it('and counts an uploaded file as somebody\'s, attached or not', () => {
    clear()
    stale('kept-by-its-record.png')
    db.prepare(
      `INSERT OR REPLACE INTO uploads (name, user_id, mime, bytes, created_at)
       VALUES ('kept-by-its-record.png', 'someone', 'image/png', 1, ?)`,
    ).run(Date.now())

    expect(reconcileUploads().unreferenced).not.toContain('kept-by-its-record.png')
    db.prepare("DELETE FROM uploads WHERE name = 'kept-by-its-record.png'").run()
  })

  /*
   * And the other direction, which nothing used to ask about: a record
   * pointing at a file that is not there. That is the more troubling of the
   * two - the first is wasted disk, the second is somebody being told they
   * still have something they do not.
   */
  it('and says when a record points at a file that is gone', () => {
    clear()
    db.prepare(
      `INSERT OR REPLACE INTO uploads (name, user_id, mime, bytes, created_at)
       VALUES ('never-written.png', 'someone', 'image/png', 1, ?)`,
    ).run(Date.now())

    expect(reconcileUploads().missing).toContain('never-written.png')
    db.prepare("DELETE FROM uploads WHERE name = 'never-written.png'").run()
  })

  /* A file written moments ago was a special case when this deleted things.
     It is not one now: nothing is deleted, so nothing needs protecting. */
  it('and leaves a file that has just arrived exactly where it is', () => {
    clear()
    writeFileSync(join(config.uploadDir, 'just-now.png'), 'x')

    reconcileUploads()
    expect(readdirSync(config.uploadDir)).toHaveLength(1)
  })
})
