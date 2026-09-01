/*
 * What this schema costs at a size nobody has reached yet.
 *
 * Builds a throwaway database with the real schema - read out of the live one
 * so it cannot drift from it - fills it with a plausible 2,000 servers, and
 * times the queries that sit on the path every connection takes. It never
 * writes to the live database; it only reads the shape.
 *
 *   node scripts/bench-scale.mjs
 *
 * Written because "would this hurt later" is a question with an answer, and
 * the answer was 56ms and 40,002 rows per sign-in. Keep it runnable: the
 * numbers in the commit messages and in the review are from here, and a claim
 * about performance that cannot be re-checked is just a claim.
 */
import { DatabaseSync } from 'node:sqlite'
import { rmSync } from 'node:fs'

const OUT = 'C:/Users/JackJ/AppData/Local/Temp/claude/e--FuckDiscord/cec5060f-5160-428c-8370-227938929632/scratchpad/bench.db'
try { rmSync(OUT); rmSync(OUT + '-wal'); rmSync(OUT + '-shm') } catch {}

/* The real schema, lifted from the live database and rebuilt empty. */
const live = new DatabaseSync('./data/atrium.db', { readOnly: true })
const ddl = live.prepare(
  "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'messages_fts%'"
).all().map((r) => r.sql)
live.close()

const db = new DatabaseSync(OUT)
db.exec('PRAGMA journal_mode=WAL')
for (const s of ddl) { try { db.exec(s) } catch {} }

/* A plausible shape at the size being asked about. */
const SPACES = 2000, CHANNELS_PER = 20, USERS = 5000, MEMBERSHIPS_PER_USER = 10, ROLES_PER = 5
const id = (p, n) => p + '-' + n

console.log(`building: ${SPACES} servers, ${SPACES * CHANNELS_PER} channels, ${USERS} users, ` +
  `${USERS * MEMBERSHIPS_PER_USER} memberships, ${SPACES * ROLES_PER} roles`)

db.exec('BEGIN')
const insUser = db.prepare('INSERT INTO users (id,username,display_name,pass_hash,pass_salt,discriminator,created_at) VALUES (?,?,?,?,?,?,?)')
for (let u = 0; u < USERS; u++) insUser.run(id('u', u), 'user' + u, 'User ' + u, 'x', 'y', '0001', Date.now())

const insSpace = db.prepare('INSERT INTO spaces (id,name,owner_id,created_at) VALUES (?,?,?,?)')
const insChan = db.prepare("INSERT INTO channels (id,name,kind,position,created_at,space_id) VALUES (?,?,'text',?,?,?)")
const insRole = db.prepare("INSERT INTO roles (id,name,permissions,position,created_at,space_id,kind) VALUES (?,?,?,?,?,?,?)")
for (let s = 0; s < SPACES; s++) {
  insSpace.run(id('s', s), 'Server ' + s, id('u', s % USERS), Date.now())
  for (let c = 0; c < CHANNELS_PER; c++) insChan.run(id('c', s + '-' + c), 'chan' + c, c, Date.now(), id('s', s))
  for (let r = 0; r < ROLES_PER; r++) {
    insRole.run(id('r', s + '-' + r), 'role' + r, '["view_channels","send_messages"]', r, Date.now(), id('s', s),
      r === 0 ? 'everyone' : 'custom')
  }
}

/*
 * Membership is a container now, not a table of its own.
 *
 * space_members and dm_members were how this worked when a server and a
 * conversation were two different things; both are containers today - a row
 * in `containers` with a kind, and its people in `container_members`, keyed
 * by the same id as the space or the channel. This file went on writing to
 * the old names and stopped running at all, which is worse than a stale
 * benchmark: the comment at the top says the numbers in the commit messages
 * come from here, and for some weeks they could not have.
 */
const insContainer = db.prepare("INSERT OR IGNORE INTO containers (id,kind,made) VALUES (?,?,?)")
const insMember = db.prepare('INSERT OR IGNORE INTO container_members (container_id,user_id,joined_at) VALUES (?,?,?)')
const insMR = db.prepare('INSERT OR IGNORE INTO member_roles (user_id,role_id) VALUES (?,?)')
for (let u = 0; u < USERS; u++) {
  for (let k = 0; k < MEMBERSHIPS_PER_USER; k++) {
    const s = (u * 7 + k * 13) % SPACES
    insContainer.run(id('s', s), 'space', Date.now())
    insMember.run(id('s', s), id('u', u), Date.now())
    insMR.run(id('u', u), id('r', s + '-0'))
  }
}

/* Some conversations, which share the channels table with the servers. */
const insDm = db.prepare("INSERT INTO channels (id,name,kind,position,created_at) VALUES (?,'','dm',0,?)")
for (let d = 0; d < 5000; d++) {
  insDm.run(id('d', d), Date.now())
  /* A conversation is a container whose id is the channel's. */
  insContainer.run(id('d', d), 'dm', Date.now())
  insMember.run(id('d', d), id('u', d % USERS), Date.now())
  insMember.run(id('d', d), id('u', (d + 1) % USERS), Date.now())
}
db.exec('COMMIT')
db.exec('ANALYZE')

const me = id('u', 42)
const oneSpace = id('s', (42 * 7) % SPACES)

const QUERIES = {
  'sign-in channels, as it used to ask': [
    `SELECT c.* FROM channels c WHERE c.kind IN ('text','voice') OR EXISTS (SELECT 1 FROM container_members cm WHERE cm.container_id = c.id AND cm.user_id = ?) ORDER BY c.kind DESC, c.position ASC`, [me]],
  'sign-in channels, scoped to my servers': [
    `SELECT c.* FROM channels c JOIN container_members m ON m.container_id = c.space_id AND m.user_id = ? WHERE c.kind IN ('text','voice') ORDER BY c.kind DESC, c.position ASC`, [me]],
  'sign-in channels, my conversations': [
    `SELECT c.* FROM channels c JOIN container_members cm ON cm.container_id = c.id WHERE cm.user_id = ? AND c.kind = 'dm'`, [me]],
  'ready: the roles this person holds': [
    `SELECT mr.user_id, mr.role_id FROM member_roles mr JOIN roles r ON r.id = mr.role_id JOIN container_members m ON m.container_id = r.space_id WHERE m.user_id = ?`, [me]],
  'permission check: the everyone role of a server': [
    `SELECT permissions FROM roles WHERE space_id = ? AND kind = 'everyone' LIMIT 1`, [oneSpace]],
  'the roles of one server': [`SELECT id FROM roles WHERE space_id = ?`, [oneSpace]],
  'who holds one role': [`SELECT user_id FROM member_roles WHERE role_id = ?`, [id('r', '0-0')]],
  'how many servers somebody owns': [`SELECT COUNT(*) c FROM spaces WHERE owner_id = ?`, [me]],
}

function time(sql, args, runs = 30) {
  const st = db.prepare(sql)
  st.all(...args)
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < runs; i++) st.all(...args)
  return Number(process.hrtime.bigint() - t0) / 1e6 / runs
}

console.log('\n--- as the schema stands ---')
const before = {}
for (const [label, [sql, args]] of Object.entries(QUERIES)) {
  before[label] = time(sql, args)
  console.log('  ' + before[label].toFixed(2).padStart(8) + ' ms   ' + label)
}

console.log('\nadding the missing indexes...')
db.exec('CREATE INDEX IF NOT EXISTS idx_roles_space ON roles(space_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_member_roles_role ON member_roles(role_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id)')
db.exec('CREATE INDEX IF NOT EXISTS idx_channels_kind_space ON channels(kind, space_id)')
db.exec('ANALYZE')

console.log('\n--- with them ---')
for (const [label, [sql, args]] of Object.entries(QUERIES)) {
  const after = time(sql, args)
  const f = before[label] / after
  console.log('  ' + after.toFixed(2).padStart(8) + ' ms   ' + label +
    (f >= 1.5 ? `   (${f.toFixed(0)}x faster)` : f <= 0.67 ? `   (${(1 / f).toFixed(1)}x SLOWER)` : ''))
}
db.close()
