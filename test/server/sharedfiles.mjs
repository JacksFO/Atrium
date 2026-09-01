/*
 * A file two messages are showing is only deleted by the last of them.
 *
 * An imported GIF is stored under a name taken from its own contents now, so
 * sending the same one twice writes it once and both messages point at the
 * same file. That saves a copy every repeat - and it makes deletion the
 * dangerous operation in the program, because the obvious way to clean up
 * after a deleted message is to delete the files it pointed at.
 *
 * Which is what it did. This is the check that it no longer does, and it is
 * worth having as a test rather than a careful reading: the failure is
 * somebody else's message quietly losing its picture, days later, with the
 * only copy in a backup nobody has needed yet.
 *
 * Its own database and its own upload directory. Nothing here can see the
 * real ones.
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const work = mkdtempSync(join(tmpdir(), 'jc-shared-'))
mkdirSync(join(work, 'data'), { recursive: true })
mkdirSync(join(work, 'uploads'), { recursive: true })
process.env.DATA_DIR = join(work, 'data')
process.env.UPLOAD_DIR = join(work, 'uploads')

const { db } = await import('../../apps/server/dist/db.js')
const { removeAttachmentsOf } = await import('../../apps/server/dist/uploads.js')

let bad = 0
const check = (what, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${got === undefined ? '' : '  ' + JSON.stringify(got)}`)
  if (!ok) bad++
}

const now = Date.now()
db.prepare(`INSERT INTO users (id, username, display_name, pass_hash, pass_salt, created_at)
            VALUES (?,?,?,?,?,?)`).run('u1', 'someone', 'Someone', 'x', 'y', now)
db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?,?,?,?)')
  .run('s1', 'Somewhere', 'u1', now)
db.prepare(`INSERT INTO channels (id, space_id, name, kind, position, created_at)
            VALUES (?,?,?,?,?,?)`).run('c1', 's1', 'general', 'text', 0, now)

const shared = 'the-same-gif.mp4'
writeFileSync(join(work, 'uploads', shared), 'pretend this is a gif')
const own = 'only-mine.mp4'
writeFileSync(join(work, 'uploads', own), 'a file nobody else has')

/* Two messages showing the same GIF, and one of them with a file of its own. */
for (const [id, body] of [['m1', 'first'], ['m2', 'second']]) {
  db.prepare('INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?,?,?,?,?)')
    .run(id, 'c1', 'u1', body, now)
}
db.prepare(`INSERT INTO attachments (id, message_id, filename, mime, bytes, path, is_gif)
            VALUES (?,?,?,?,?,?,1)`).run('a1', 'm1', 'gif.mp4', 'video/mp4', 21, `/uploads/${shared}`)
db.prepare(`INSERT INTO attachments (id, message_id, filename, mime, bytes, path, is_gif)
            VALUES (?,?,?,?,?,?,1)`).run('a2', 'm2', 'gif.mp4', 'video/mp4', 21, `/uploads/${shared}`)
db.prepare(`INSERT INTO attachments (id, message_id, filename, mime, bytes, path, is_gif)
            VALUES (?,?,?,?,?,?,0)`).run('a3', 'm1', 'own.mp4', 'video/mp4', 22, `/uploads/${own}`)

const there = (name) => existsSync(join(work, 'uploads', name))

check('both files start out on disk', there(shared) && there(own))

// ---- the first message goes ----
removeAttachmentsOf('m1')
db.prepare('DELETE FROM messages WHERE id = ?').run('m1')

/* The whole point. The other message is still there and still showing it. */
check('a file the other message is still showing survives', there(shared) === true)
check('while the one only this message had is gone', there(own) === false)

// ---- and then the second ----
removeAttachmentsOf('m2')
db.prepare('DELETE FROM messages WHERE id = ?').run('m2')

/* And it must not be kept for ever either, or the saving becomes a leak. */
check('once nobody is showing it, it goes', there(shared) === false)

db.close()
rmSync(work, { recursive: true, force: true })
console.log('\n  ' + (bad === 0 ? 'a shared file outlives the first message to go' : bad + ' wrong'))
process.exitCode = bad === 0 ? 0 : 1
