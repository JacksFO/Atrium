/*
 * What the sign-in channel query costs at a size nobody has reached yet.
 *
 * The frame a client gets when it connects contains the channels that person
 * can see. Working those out is the single most-run query on the instance -
 * every connection, every reconnect - so its shape is worth measuring rather
 * than reasoning about.
 *
 * Builds a throwaway database with the real schema, read out of the live one
 * so it cannot drift from it, fills it with a plausible 2,000 servers, and
 * times the two ways of asking. It never writes to the live database; it only
 * reads the shape.
 *
 *   node scripts/bench-signin.mjs
 *
 * Written because "would this hurt later" is a question with an answer.
 */
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const LIVE = 'E:/FuckDiscord/data/atrium.db'
const OUT = process.env.BENCH_DB
  ?? 'C:/Users/JackJ/AppData/Local/Temp/claude/e--FuckDiscord/cec5060f-5160-428c-8370-227938929632/scratchpad/bench-signin.db'
for (const f of [OUT, OUT + '-wal', OUT + '-shm']) { try { rmSync(f) } catch { /* not there */ } }

const SPACES = Number(process.env.SPACES ?? 2000)
const CHANNELS_EACH = Number(process.env.CHANNELS_EACH ?? 8)
const MINE = Number(process.env.MINE ?? 20)      // servers the person is in
const TALKS = Number(process.env.TALKS ?? 30)    // conversations they are in

/* The real schema, so this measures the database that exists. */
const live = new DatabaseSync(LIVE, { readOnly: true })
const schema = live.prepare(
  `SELECT sql FROM sqlite_master
    WHERE sql IS NOT NULL AND type IN ('table', 'index')
      AND name IN ('users', 'spaces', 'channels', 'containers', 'container_members',
                   'space_members', 'dm_members', 'idx_channels_space',
                   'idx_container_members_user')`
).all().map((r) => r.sql)
live.close()

const db = new DatabaseSync(OUT)
db.exec('PRAGMA journal_mode = WAL')
for (const sql of schema) db.exec(sql)

const me = randomUUID()
db.prepare(
  `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
   VALUES (?, 'me', 'Me', '0001', 'x', 'y', ?)`
).run(me, Date.now())

const now = Date.now()
const addSpace = db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
const addChannel = db.prepare(
  `INSERT INTO channels (id, name, topic, kind, position, created_at, space_id)
   VALUES (?, ?, '', ?, ?, ?, ?)`)
const addContainer = db.prepare('INSERT INTO containers (id, kind, made) VALUES (?, ?, ?)')
const addMember = db.prepare(
  'INSERT INTO container_members (container_id, user_id, joined_at) VALUES (?, ?, ?)')

db.exec('BEGIN')
for (let s = 0; s < SPACES; s++) {
  const id = `space-${s}`
  addSpace.run(id, `Server ${s}`, me, now)
  addContainer.run(id, 'space', now)
  if (s < MINE) addMember.run(id, me, now)
  for (let c = 0; c < CHANNELS_EACH; c++) {
    addChannel.run(`ch-${s}-${c}`, `room-${c}`, c === 0 ? 'voice' : 'text', c, now, id)
  }
}
for (let t = 0; t < TALKS; t++) {
  const id = `talk-${t}`
  addChannel.run(id, '', 'dm', 0, now, null)
  addContainer.run(id, 'dm', now)
  addMember.run(id, me, now)
}
db.exec('COMMIT')
db.exec('ANALYZE')

const rows = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
console.log(`\n  ${rows('spaces')} servers, ${rows('channels')} channels, ` +
  `${MINE} of them mine plus ${TALKS} conversations`)

const OLD = `SELECT c.* FROM channels c
   JOIN containers k ON k.id = COALESCE(c.space_id, c.id)
   JOIN container_members m ON m.container_id = k.id AND m.user_id = ?
  ORDER BY c.kind DESC, c.position ASC`

const NEW = `SELECT c.* FROM container_members m
   JOIN channels c ON c.space_id = m.container_id
  WHERE m.user_id = ?
 UNION ALL
 SELECT c.* FROM container_members m
   JOIN channels c ON c.id = m.container_id
  WHERE m.user_id = ?
  ORDER BY kind DESC, position ASC`

function time(sql, args, runs = 40) {
  const st = db.prepare(sql)
  const first = st.all(...args)
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < runs; i++) st.all(...args)
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6 / runs, rows: first.length }
}

const scans = (sql, args) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args)
  .filter((r) => /SCAN/.test(r.detail) && !/USING (COVERING )?INDEX/.test(r.detail)).length

const a = time(OLD, [me])
const b = time(NEW, [me, me])

console.log(`\n  ${a.ms.toFixed(2).padStart(8)} ms   one COALESCE join   ` +
  `(${a.rows} rows back, ${scans(OLD, [me])} table scans)`)
console.log(`  ${b.ms.toFixed(2).padStart(8)} ms   two indexed arms    ` +
  `(${b.rows} rows back, ${scans(NEW, [me, me])} table scans)`)

const sameRows = a.rows === b.rows
console.log(`\n  ${sameRows ? 'the same rows either way' : 'DIFFERENT ROW COUNTS - not the same question'}`)
console.log(`  ${(a.ms / b.ms).toFixed(0)}x faster\n`)
db.close()
process.exit(sameRows ? 0 : 1)
