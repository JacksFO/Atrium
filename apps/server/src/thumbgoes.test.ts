import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'
import { config } from './config.js'
import { removeAttachmentsOf, reconcileUploads } from './uploads.js'

/**
 * A picture and its thumbnail are one thing, and they go together.
 *
 * Sending a picture stores two files: the picture, shrunk to 2048px, and a
 * 512px copy for the size it is actually drawn at. That is worth it - the
 * thumbnail costs 23% more disk once and saves 77% of the download every
 * time anybody scrolls past it - but it is two files, and only one of them
 * was ever deleted.
 *
 * So every deleted picture left its thumbnail behind for good. The sweep
 * could not collect it either: an upload row counts as a reason to keep a
 * file, and a thumbnail has one. Measured on the live database before this
 * was fixed: thirteen upload rows, 4.67MB, that nothing pointed at at all.
 */

function file(name: string): string {
  mkdirSync(config.uploadDir, { recursive: true })
  const full = join(config.uploadDir, name)
  writeFileSync(full, 'not really a picture')
  return full
}

/** Somebody to have sent it - messages point at a real account. */
function person(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U', Date.now())
  return id
}

/** A message with a picture and a thumbnail, and the files behind them. */
function sent(): { messageId: string; picture: string; thumb: string } {
  const messageId = randomUUID()
  const channelId = randomUUID()
  db.prepare("INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, 'c', '', 'text', 0, ?)")
    .run(channelId, Date.now())
  db.prepare('INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(messageId, channelId, person(), '', Date.now())

  const picture = `${randomUUID()}.webp`
  const thumb = `${randomUUID()}.webp`
  file(picture)
  file(thumb)
  for (const name of [picture, thumb]) {
    db.prepare('INSERT INTO uploads (name, user_id, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, person(), 'image/webp', 10, Date.now())
  }
  db.prepare(
    `INSERT INTO attachments (id, message_id, filename, mime, bytes, path, thumb_path)
     VALUES (?, ?, 'shot.webp', 'image/webp', 10, ?, ?)`
  ).run(randomUUID(), messageId, `/uploads/${picture}`, `/uploads/${thumb}`)

  return { messageId, picture, thumb }
}

const onDisk = (name: string) => existsSync(join(config.uploadDir, name))
const known = (name: string) => Boolean(
  db.prepare('SELECT 1 FROM uploads WHERE name = ?').get(name)
)

describe('deleting a picture', () => {
  it('takes its thumbnail with it', () => {
    const { messageId, picture, thumb } = sent()

    /* Both there to begin with, asserted rather than assumed - on a run where
       the fixture failed to write, "the file is gone" would pass by itself. */
    expect(onDisk(picture), 'the picture was written').toBe(true)
    expect(onDisk(thumb), 'the thumbnail was written').toBe(true)

    removeAttachmentsOf(messageId)

    expect(onDisk(picture)).toBe(false)
    expect(onDisk(thumb)).toBe(false)
  })

  /* And forgets both, or the row outlives the file and the sweep spends the
     rest of its life reporting a file that is missing. */
  it('and forgets both of them', () => {
    const { messageId, picture, thumb } = sent()
    expect(known(picture) && known(thumb)).toBe(true)

    removeAttachmentsOf(messageId)

    expect(known(picture)).toBe(false)
    expect(known(thumb)).toBe(false)
  })
})

describe('but not one somebody else is still using', () => {
  /*
   * Two messages can share a file - an imported GIF is stored under a name
   * taken from its own contents, so sending the same one twice costs nothing
   * the second time. Deleting one of those used to take the file and leave
   * the other showing a hole.
   *
   * The same bytes can be a picture in one message and a thumbnail in
   * another, which is why both columns are asked.
   */
  it('when the same file is somebody else’s picture', () => {
    const mine = sent()
    const otherMessage = randomUUID()
    const otherChannel = randomUUID()
    db.prepare("INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, 'c', '', 'text', 0, ?)")
      .run(otherChannel, Date.now())
    db.prepare('INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(otherMessage, otherChannel, person(), '', Date.now())
    db.prepare(
      `INSERT INTO attachments (id, message_id, filename, mime, bytes, path)
       VALUES (?, ?, 'same.webp', 'image/webp', 10, ?)`
    ).run(randomUUID(), otherMessage, `/uploads/${mine.thumb}`)

    removeAttachmentsOf(mine.messageId)

    expect(onDisk(mine.picture), 'the picture still goes').toBe(false)
    expect(onDisk(mine.thumb), 'the shared one stays').toBe(true)
  })
})

describe('and the question it asks before deleting', () => {
  /*
   * "Is anybody else using this file" is asked once per file, and the common
   * answer is no - which is a miss, and a miss reads the whole table unless
   * an index can answer it.
   *
   * Both columns need one. path had one already; thumb_path did not, so
   * adding it to the question turned an indexed lookup into a scan of every
   * attachment. Measured on a hundred thousand: 9.2ms a file against 43us,
   * which is 73ms of blocked event loop to delete one message with four
   * pictures - and the sweep does that for every deleted message in a row.
   */
  it('can be answered from an index rather than by reading everything', () => {
    const plan = db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT 1 AS x FROM attachments
        WHERE (path = ? OR thumb_path = ?) AND message_id != ? LIMIT 1`
    ).all('a', 'a', 'm') as Array<{ detail: string }>
    const how = plan.map((r) => r.detail).join(' | ')
    expect(how, `it reads the whole table: ${how}`).not.toMatch(/SCAN attachments/)
  })
})

describe('and the sweep', () => {
  /*
   * A thumbnail is a file the database points at, and this list is what the
   * sweep keeps. thumb_path was missing from it - the same fault two comments
   * in that function already describe, each written after it deleted
   * something in use. It did not bite only because an upload row also counts,
   * and every thumbnail has one; the day anything forgets an upload row, the
   * thumbnails would have gone with it.
   */
  it('never counts a thumbnail in use as rubbish', () => {
    const { thumb } = sent()
    /* The belt taken off, so the braces are what is being tested. */
    db.prepare('DELETE FROM uploads WHERE name = ?').run(thumb)

    expect(reconcileUploads().unreferenced).not.toContain(thumb)
  })
})
