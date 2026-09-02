import { isConversationKind } from './kinds.js'
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Permission } from './permissions.js'
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { copyOffsite } from './offsite.js'
import { signPath } from './signing.js'


export const db = new DatabaseSync(resolve(config.dataDir, 'atrium.db'))

/**
 * Answering the same question twice, once.
 *
 * Working out what one person is allowed to do asks the database the same
 * handful of things over and over: who owns this space, is this person in it,
 * what can everyone here do, what is this channel. Measured on the live data,
 * one person connecting ran 103 statements to build the permissions in their
 * ready frame, and 63 of those were a statement that had already been run
 * with exactly the same arguments. Everybody reconnecting after a restart ran
 * 1021, of which 900 were repeats - the same channel and role rows read once
 * per person.
 *
 * So reads are remembered, but only inside a block that says it wants that,
 * and only for as long as that block runs. Outside one, nothing is cached and
 * nothing behaves differently.
 *
 * Two rules keep it honest:
 *
 *   - only SELECT, because only a read has an answer worth keeping.
 *   - any write empties it. A statement that changes something makes every
 *     remembered answer suspect, and the alternative is working out which
 *     ones - which is how a cache becomes a permissions bug.
 *
 * These blocks are synchronous from end to end, which is what makes this
 * safe: node:sqlite is synchronous, so nothing else can run between the first
 * read and the last one, and there is no moment where a remembered answer can
 * go stale underneath it.
 */
let scope: Map<string, unknown> | null = null
/* Statements actually run against the database, and answers handed back from
   the scope instead. Counted so the saving can be shown rather than claimed. */
let ran = 0
let served = 0

export function withReadCache<T>(run: () => T): T {
  /* Already inside one: keep the outer scope rather than starting a second,
     so a nested call still sees what the outer one has remembered. */
  if (scope) return run()
  scope = new Map()
  try {
    return run()
  } finally {
    scope = null
  }
}

/** Whether a cache is open, and how much it is holding. For the tests. */
export function readCacheSize(): number | null {
  return scope ? scope.size : null
}

/** How many reads reached the database, and how many did not. */
export function readCacheStats(): { ran: number; served: number } {
  return { ran, served }
}

export function resetReadCacheStats(): void {
  ran = 0
  served = 0
}

const preparing = db.prepare.bind(db)
;(db as unknown as { prepare: typeof preparing }).prepare = ((sql: string) => {
  const statement = preparing(sql)
  const isRead = /^\s*SELECT/i.test(sql)

  const remembering = <A extends unknown[], R>(
    name: string, call: (...args: A) => R,
  ) => (...args: A): R => {
    if (!scope || !isRead) { ran += 1; return call(...args) }
    const key = `${name}|${sql}|${JSON.stringify(args)}`
    if (scope.has(key)) { served += 1; return scope.get(key) as R }
    ran += 1
    const answer = call(...args)
    scope.set(key, answer)
    return answer
  }

  const it = statement as unknown as Record<string, unknown>
  const get = statement.get.bind(statement)
  const all = statement.all.bind(statement)
  const run = statement.run.bind(statement)
  it.get = remembering('get', get)
  it.all = remembering('all', all)
  /* A write, so whatever is remembered was remembered before it. */
  it.run = (...args: unknown[]) => { scope?.clear(); return (run as (...a: unknown[]) => unknown)(...args) }
  return statement
}) as typeof preparing

/* The other way a statement runs. Migrations and transactions go through it,
   and a cache that survived one would be remembering answers from before it. */
const running = db.exec.bind(db)
;(db as unknown as { exec: typeof running }).exec = ((sql: string) => {
  scope?.clear()
  return running(sql)
}) as typeof running

// WAL lets readers work while a write is in flight. Without it, concurrent
// reads block on every insert and the app feels laggy under no load at all.
db.exec('PRAGMA journal_mode = WAL')
/*
 * And every commit reaches the disk before it is called committed.
 *
 * This was NORMAL, which is the usual default and was never a decision -
 * WAL beside it has its reasoning written down and this had none. Under
 * NORMAL a commit is durable against the process dying and not against the
 * machine losing power: the write-ahead log is not flushed on each one, so a
 * power cut takes the last few seconds of messages with it. The database
 * cannot corrupt either way; it is the recent writes that go.
 *
 * That is the realistic failure for a server under a desk with no UPS, and
 * the cost of closing it was measured on this machine rather than guessed -
 * 200 inserts, warm, against a copy of the live database:
 *
 *   synchronous = NORMAL   0.021 ms per commit
 *   synchronous = FULL     1.072 ms per commit
 *
 * A millisecond a write. At the size this runs at it is unmeasurable; even
 * one person hammering the write ceiling of 400 a minute pays seven
 * milliseconds a second. Losing somebody's messages to a power cut to save
 * that is the wrong way round.
 */
db.exec('PRAGMA synchronous = FULL')
db.exec('PRAGMA foreign_keys = ON')
/*
 * How long a blocked write waits before giving up.
 *
 * The default is zero: a write that meets a lock fails immediately with
 * SQLITE_BUSY rather than waiting for the lock to clear. One process in WAL
 * mode rarely meets one - but the nightly backup takes a read lock across the
 * whole database, and anything that ever runs a second process makes it
 * certain. Five seconds is far longer than any statement here takes and still
 * short enough to surface a real deadlock rather than hang on it.
 */
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash    TEXT NOT NULL,
  pass_salt    TEXT NOT NULL,
  bio          TEXT NOT NULL DEFAULT '',
  -- pronouns is no longer read or written. Left in place because
  -- dropping a column means rebuilding the table, and an unread one
  -- costs nothing.
  pronouns     TEXT NOT NULL DEFAULT '',
  accent       TEXT NOT NULL DEFAULT '#3FE0E8',
  avatar_path  TEXT,
  banner_path  TEXT,
  role         TEXT NOT NULL DEFAULT 'member',
  status_text  TEXT NOT NULL DEFAULT '',
  presence     TEXT NOT NULL DEFAULT 'online',
  created_at   INTEGER NOT NULL,
  -- Set instead of deleting the row. Deleting a member used to cascade
  -- through messages and erase everything they had ever said.
  removed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS channels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT '',
  -- 'text' | 'voice' | 'dm' | 'group'
  kind       TEXT NOT NULL DEFAULT 'text',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  reply_to   TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  width      INTEGER,
  height     INTEGER,
  path       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);

-- Read position per user per channel. This is what makes unread markers work
-- across restarts; without it the client guesses and always guesses wrong.
CREATE TABLE IF NOT EXISTS read_state (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS channel_access (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,   -- 'role' or 'member'
  subject_id TEXT NOT NULL,
  PRIMARY KEY (channel_id, kind, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_access ON channel_access(channel_id);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  uses_left  INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

/*
 * What people report, from the button in the corner.
 *
 * Kept here whatever else happens to it. Forwarding to an issue tracker can
 * fail - no token, no network, the far end down - and a report that only
 * existed as an HTTP request nobody answered is a report that never happened.
 * The row is written first and the tracker is told afterwards; the issue
 * column is the number it was given, or null if it never got there.
 *
 * The kind column is what the person chose, not what it turned out to be.
 * Triage is somebody's job later; this records what they meant.
 */
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  -- Version, platform and build: the three things every report needs and
  -- nobody remembers to include. Never anything about what they were saying.
  context    TEXT NOT NULL DEFAULT '',
  issue      INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  colour      TEXT NOT NULL DEFAULT '#8395A6',
  position    INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  hoist       INTEGER NOT NULL DEFAULT 0,
  mentionable INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

/*
 * Who a message named.
 *
 * Written when the message is accepted rather than worked out when somebody
 * looks, so a mention still exists after the tab that received it is closed -
 * which is the whole complaint: the mark lived in a Set in the browser and
 * did not survive a reload.
 *
 * channel_id is carried alongside the message so "which channels have a
 * mention waiting" is one index away rather than a join through messages for
 * every row.
 */
CREATE TABLE IF NOT EXISTS mentions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(user_id, channel_id);

CREATE TABLE IF NOT EXISTS member_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS audit (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(created_at DESC);

-- One row, id 1. Simpler than a key/value table for a handful of settings.
--
-- Superseded by the spaces table below, and kept because SQLite cannot drop the
-- CHECK that pins it to one row: the settings live here until everything reads
-- from spaces, and the two are kept in step during the move.
/*
 * A space somebody made, and who is in it.
 *
 * Until now there was exactly one space and an account was membership in it:
 * signing up put you in the one seeded server, seeing everything. That is the reason
 * signup needs an invite code - the invite is the only thing standing between
 * a stranger and every message on the server.
 *
 * Membership as its own fact is what lets that change. Once being in a space
 * is a row rather than a side effect of having an account, an account can be
 * worth nothing on its own, and then open registration is safe rather than
 * reckless. It is the first step for that reason and not because it is the
 * most interesting one.
 */
CREATE TABLE IF NOT EXISTS spaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_path   TEXT,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL
);


-- Permissions given to one person directly, rather than through a role.
--
-- Roles are the right answer when several people need the same thing; a role
-- made for one person is a role that then has to be named, coloured, ordered
-- and explained. This is the escape hatch for "just let them do this one
-- thing", and it stacks with their roles exactly the way roles stack with
-- each other.
--
-- Grant only. There is no row that takes something away: a permission is
-- either given by @everyone, given by a role, given here, or absent. Denials
-- would need a precedence order between the three, and that order is the part
-- of the usual model nobody can hold in their head.
--
-- Scoped to a server, because everything else about a member is.
CREATE TABLE IF NOT EXISTS member_permissions (
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_member_perms ON member_permissions(user_id, space_id);

/*
 * Friends, and the asking.
 *
 * A friendship is one row, not two. Storing both directions means every
 * change has to write both and every read has to trust that it did - and the
 * day one of the pair goes missing, two people disagree about whether they
 * are friends. The pair is kept in a fixed order instead, smaller id first,
 * so there is exactly one row to find and no second copy to fall out of step.
 *
 * A request is separate and directional, because who asked matters: it is
 * what the other person is answering, and it is what makes accepting mean
 * something. Accepting deletes the request and writes the friendship.
 */
CREATE TABLE IF NOT EXISTS friendships (
  low        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  high       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (low, high)
);
CREATE INDEX IF NOT EXISTS idx_friendships_high ON friendships(high);

CREATE TABLE IF NOT EXISTS friend_requests (
  from_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);

/*
 * People who may not come back.
 *
 * Removing somebody was thorough about everything except the part that made
 * it mean anything: their roles went, their personal grants went, their
 * socket was dropped - and then the same invite link let them straight back
 * in. A kick is "leave", said by somebody else. This is the other one.
 *
 * Per server, like every other decision about a server. Being unwelcome in
 * one place is not being unwelcome everywhere, and nobody here has the
 * standing to say the second thing.
 *
 * The row outlives the membership on purpose - that is the whole point of it
 * - so it is keyed on the pair and not on anything in container_members.
 * created_by is kept for the audit trail and set null if that account is
 * ever removed, which does not lift the ban: who decided it is a separate
 * question from whether it holds.
 */
CREATE TABLE IF NOT EXISTS bans (
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);

/*
 * Somebody stopped from talking for a while.
 *
 * The middle option, and the one moderators actually reach for: a kick ends
 * the moment they click the invite again and a ban does not end at all, and
 * neither of those is "stop, for ten minutes". It is a row rather than a
 * column on the membership because it has an end and an author, and because
 * a lapsed one is worth keeping until something clears it - "were they timed
 * out last week" is a question the audit log alone answers badly.
 *
 * The end is a moment rather than a length, so nothing has to run for it to
 * end: the comparison is against the clock every time it is asked.
 */
CREATE TABLE IF NOT EXISTS timeouts (
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  until      INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_timeouts_user ON timeouts(user_id);

/*
 * People you do not want to hear from.
 *
 * The app was careful about strangers and had nothing at all for the case
 * that actually happens: somebody you have met. A conversation can only be
 * opened with a friend, somebody you share a server with, or somebody
 * already talking to you - which is the right rule, and it means the one
 * person you might badly want to stop hearing from has already passed it.
 * The only remedy was to leave the server.
 *
 * Directional, unlike a friendship. Blocking is one person's decision about
 * their own attention and the other person does not agree to it, is not
 * consulted, and is not told - so storing it as an unordered pair the way
 * friendships are stored would lose the only thing about it that matters,
 * which is whose decision it was. Lifting it is the blocker's alone.
 *
 * It is read on the paths where one person reaches another, and it always
 * asks about both directions: a block stops the traffic, and traffic the
 * other way is the same traffic.
 */
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);

/*
 * What somebody is called in one server.
 *
 * This was a column on the account, so it was one name everywhere: a
 * moderator renaming you in their server renamed you in every other
 * server, and in your conversations with people who have never heard of
 * theirs. The route that sets it already took a spaceId - it had to, because
 * who may set a nickname is a question about a server - and then wrote a
 * value that had nothing to do with that server. The comment above it said
 * so and left it.
 *
 * The same shape as every other per-server fact: keyed on the pair, gone
 * when the server is gone. A person's own display_name is the global one
 * and always was; this is the local override, and there is nowhere left for
 * a name to be both.
 *
 * An empty nickname is not stored - it is a deletion. "No nickname" and "a
 * nickname that happens to be blank" are the same thing to everybody
 * reading it, and keeping the row would make them different to the code.
 */
CREATE TABLE IF NOT EXISTS member_nicknames (
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  PRIMARY KEY (space_id, user_id)
);

/*
 * What somebody wants told about one channel.
 *
 * On the account rather than in the browser, because muting a channel from a
 * phone and finding it still shouting on the desktop is not muting it. The
 * old per-device flag in localStorage did exactly that.
 *
 * muted_until is NULL when the channel is not muted, and otherwise the
 * moment the mute lapses - so "is it muted" is one comparison and never a
 * special case. "Until I turn it back on" is simply a date far enough away
 * that it will not arrive, which needs no separate flag and cannot be
 * mistaken for a lapsed mute.
 *
 * level 'default' means "whatever my overall setting says" - inherit the
 * category, in other words - and is the reason this is a word rather than a
 * boolean.
 */
CREATE TABLE IF NOT EXISTS channel_prefs (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  level       TEXT NOT NULL DEFAULT 'default',
  muted_until INTEGER,
  PRIMARY KEY (user_id, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_prefs_user ON channel_prefs(user_id);

CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

-- FTS5 replaces a whole search service. Kept in sync by the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
`)

/**
 * Add a column, and say so if it fails for any reason but the obvious one.
 *
 * Each of these used to be a try/catch that swallowed everything, on the
 * assumption that the only possible failure was the column already being
 * there. Any other failure looked exactly the same - the server carried on,
 * and the first anybody knew was a query asking for a column that had never
 * been added.
 */
function addColumn(table: string, column: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    console.log(`[db] added ${table}.${column}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The one expected failure: this database already has it.
    if (/duplicate column/i.test(message)) return
    console.error(`[db] could not add ${table}.${column}: ${message}`)
    throw err
  }
}

// Pins are a column on the message rather than a table: at most one pin per
// message, and the message is where every reader already is.
addColumn('messages', 'pinned_at', 'INTEGER')
addColumn('messages', 'pinned_by', 'TEXT')

// A channel is open to everybody unless this says otherwise.
addColumn('channels', 'is_private', 'INTEGER DEFAULT 0')

/*
 * How long somebody has to wait between messages here. Nought is off.
 *
 * On the channel rather than on the server, because it is a property of the
 * room: one channel gets busy and the rest do not. The cheapest moderation
 * there is - it needs nobody awake, which is the whole point of it.
 */
addColumn('channels', 'slowmode_seconds', 'INTEGER NOT NULL DEFAULT 0')

/*
 * Where a server sits in one person's rail.
 *
 * On the membership rather than on the server, because the order is the
 * reader's and not the owner's: two people in the same servers arrange them
 * differently, and neither arrangement is a property of the server itself.
 *
 * Null until somebody drags something, and the fallback is when they joined -
 * which is the order the rail already had, so nothing moves until it is
 * asked to.
 */
/* The column this described now lives on container_members, where the
   membership itself does. See the drop below. */

/*
 * When somebody last looked at what is pinned in a channel.
 *
 * A pin is announced in the conversation, which anybody reading at the time
 * will see - and then scrolls away like anything else. The icon at the top is
 * where a pin lives permanently, so that is where "there is one you have not
 * seen" belongs.
 *
 * Null means never opened, which counts as unseen: somebody who has never
 * looked at the pins of a channel that has some has not seen them.
 */
addColumn('channel_prefs', 'pins_seen_at', 'INTEGER')
/*
 * A picture across the top of a server's channel list.
 *
 * The strip was there from the beginning and had nothing of its own to draw:
 * it stretched the server's icon, which is a small square and looks like one
 * blown up, or fell back to art grown from the server's id. Neither is a
 * thing anybody chose.
 */
addColumn('spaces', 'banner_path', 'TEXT')

// When this account's sessions were last ended. Tokens older than this are
// refused, which is what makes a password change mean something.
addColumn('users', 'token_epoch', 'INTEGER NOT NULL DEFAULT 0')
/*
 * Whether an attachment is a GIF somebody picked rather than a file they
 * chose to send.
 *
 * Reported with a screenshot: a GIF arriving with "counter-strike-rage-gif.mp4
 * - 34 KB" written underneath it. A filename and a byte count are worth
 * showing for a file somebody deliberately attached; on a reaction GIF they
 * are the name of a temporary file nobody chose and will never refer to.
 *
 * Everything sent before this is a nought, which is right: it was all sent
 * as an ordinary attachment and still reads as one.
 */
addColumn('attachments', 'is_gif', 'INTEGER DEFAULT 0')

/*
 * A small copy of a picture, for the size it is actually looked at.
 *
 * A conversation draws pictures a few hundred pixels wide and was fetching
 * the whole thing to do it - twenty pictures in a channel is twenty full
 * images downloaded by everybody who scrolls past, all of it out of the
 * upstream of whoever is hosting.
 *
 * Null for everything sent before this, and null for anything with no
 * sensible small copy - a GIF, because a canvas draws one frame of one, and
 * anything already smaller than the thumbnail would be. The reader falls
 * back to the full picture, so an absent thumbnail is slower and never
 * broken.
 */
addColumn('attachments', 'thumb_path', 'TEXT')

/*
 * Where a file came from, on the file's own row.
 *
 * All of it was already derivable - an attachment knows its message, a
 * message knows its channel, a channel knows its server - which is fine for
 * one file and useless for the questions worth asking. "How much is this
 * server holding", "what has this person posted", "what goes when they leave"
 * were each three joins and a scan; they are one indexed query now.
 *
 * The uploader is the message's author rather than a lookup into the upload
 * ledger. They are the same person by construction: the send path refuses any
 * attachment whose stored name was not claimed by the sender, so a file on
 * somebody's message is a file that person uploaded.
 *
 * A conversation has no server, so space_id is null there. That is the same
 * shape the channels table already uses and it means "not in a server", not
 * "unknown".
 */
addColumn('attachments', 'space_id', 'TEXT')
addColumn('attachments', 'channel_id', 'TEXT')
addColumn('attachments', 'user_id', 'TEXT')



/*
 * Which provider GIFs we already hold, so the same one is never fetched twice.
 *
 * Storing by content already meant a repeat send cost no disk - but it only
 * found that out after downloading the whole thing again and hashing it. This
 * is the shortcut: the address it came from, and the name it ended up under.
 *
 * Not a cache that has to be right. Every read checks the file is still on
 * disk and falls back to fetching it if not, so a swept file or a hand-tidied
 * uploads folder costs one download rather than a broken picture.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS gif_imports (
  remote_url TEXT PRIMARY KEY,
  stored     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);`)

// How somebody chose to have their name drawn. A key into a fixed set, never
// a family name from the browser: an arbitrary font would mean a request to
// somebody else's server every time a message is rendered.
addColumn('users', 'name_font', "TEXT NOT NULL DEFAULT 'default'")

// A little decoration on a name. A key into a fixed set, same reasoning as
// the font: nothing here is a value from the browser.
addColumn('users', 'name_effect', "TEXT NOT NULL DEFAULT 'none'")

// The second colour an effect paints with - the far end of a gradient, the
// glow around a name, the highlight in a sweep. Empty means "work one out
// from the first", which is what it did before there was a choice.
addColumn('users', 'accent_2', "TEXT NOT NULL DEFAULT ''")

// Older databases predate removed_at.
addColumn('users', 'removed_at', 'INTEGER')

/*
 * users.nickname is gone from here, and from everything that reads a person.
 *
 * It was one name for the whole account, which made a nickname the only
 * per-server fact in the app that was not per server: being renamed in one
 * place renamed you in every other, and in conversations with people who
 * had never heard of the server that did it. It lives in member_nicknames
 * now, keyed on the pair like everything else about a server.
 *
 * The column is left on databases that already have it. Nothing selects it,
 * dropping a column here is a whole-table rebuild - see widenUsernames for
 * what that costs - and an unread column is worth less than the risk of
 * rewriting the users table to be rid of it.
 */

/**
 * The id the sender gave a message before it had one of ours.
 *
 * Sending is not reliable without it. A client that never hears back cannot
 * safely try again - it has no way to ask "did that one land?", so a retry
 * either duplicates the message or the message is lost. Keeping the sender's
 * id makes the send repeatable: the second attempt matches the first and is
 * answered with the message that already exists.
 */
addColumn('messages', 'nonce', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_nonce ON messages(author_id, nonce)')

/**
 * Which server an audited action happened in.
 *
 * The audit log was one list for the whole machine. The route asked which
 * server it was being read for and checked view_audit_log in that server -
 * and then selected the entire table regardless, so an owner reading their
 * own server's log was shown everything everybody had done in every other
 * server on the box, including servers they are not in.
 *
 * Null means one of two things, and both are shown to nobody: an action that
 * belongs to an account rather than to any server (a password change), or a
 * row written before this column existed, which cannot be attributed to a
 * server after the fact without guessing.
 */
addColumn('audit', 'space_id', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_audit_space ON audit(space_id, created_at DESC)')

/**
 * When a message was deleted, if it was.
 *
 * Deleting used to remove the row outright, which meant a misclick was
 * final. The row now stays for a short window so it can be put back, and is
 * removed for good - along with its files - once the window closes.
 */
addColumn('messages', 'deleted_at', 'INTEGER')

/**
 * Who deleted it, which decides who may put it back.
 *
 * Keyed on the author was wrong: it let somebody undo a moderator's
 * deletion of their own message, which is the one case where a deletion is
 * a decision rather than a slip.
 */
addColumn('messages', 'deleted_by', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(deleted_at)')

/*
 * Which space a channel, a role or an invite belongs to.
 *
 * Nullable, and null means the one original space. Everything that exists
 * today was made before spaces were a thing, so rather than guess at a
 * backfill the absence was given a meaning, and one helper was the
 * single place that turns it back into an id.
 *
 * A DM belongs to no space at all and keeps a null here for a different
 * reason, which is why nothing reads this column without knowing the kind.
 */
/*
 * When you closed this conversation, if you did.
 *
 * Closing a DM takes it off your list and nothing else. It is not a delete:
 * the messages stay, the other person's list is untouched, and saying
 * anything again brings it straight back with its history intact. Somebody
 * tidying their sidebar should not be able to destroy a conversation two
 * people had, least of all somebody else's copy of it.
 *
 * Per member rather than per channel, because it is a fact about one
 * person's list.
 */
/* Likewise: closing a conversation is a fact about a membership, and is
   recorded on the membership. See the drop below. */

/*
 * What kind of role this is, rather than what it is called.
 *
 * @everyone and Owner used to be two fixed ids, which worked while there was
 * one server and stops working the moment every server needs its own. A
 * server that starts fresh needs its own @everyone for its owner to edit,
 * not the original server's - so the two special roles are recognised by
 * kind, and each space gets a pair with ids of their own.
 *
 * The original pair keep their ids. Renaming them would break every
 * channel_access row and member_roles row that names them.
 */
/*
 * A call, written into the conversation it happened in.
 *
 * Calls left no trace at all: somebody who missed one had no way of knowing
 * it had ever happened, and neither did the person who rang. A row in the
 * conversation is the only place either of them will look.
 *
 * A message rather than a table of its own, because it belongs in the order
 * of what was said - between the message before it and the message after -
 * and everything that already knows how to fetch, page and render a
 * conversation gets it for free.
 */
addColumn('messages', 'kind', "TEXT NOT NULL DEFAULT 'text'")
/** Null while it is still going. Set when it ends, which is what gives a length. */
addColumn('messages', 'call_ended_at', 'INTEGER')
/** Nobody picked up. Distinct from a call of length zero, which was answered. */
addColumn('messages', 'call_missed', 'INTEGER NOT NULL DEFAULT 0')

addColumn('roles', 'kind', "TEXT NOT NULL DEFAULT 'custom'")
db.prepare("UPDATE roles SET kind = 'everyone' WHERE id = 'everyone'").run()
db.prepare("UPDATE roles SET kind = 'owner' WHERE id = 'owner'").run()

addColumn('channels', 'space_id', 'TEXT')

/*
 * And every attachment already here told where it came from.
 *
 * Below the line that gives a channel its server, not beside the columns it
 * fills: this reads channels.space_id, and that is itself a migration. Run
 * any earlier and it is "no such column" at boot, which takes the whole
 * server with it.
 *
 * Only where it is still empty, so this costs nothing on every boot after
 * the first and cannot overwrite a row that has since been written properly.
 */
db.exec(`
  UPDATE attachments SET
    channel_id = (SELECT m.channel_id FROM messages m WHERE m.id = attachments.message_id),
    user_id    = (SELECT m.author_id  FROM messages m WHERE m.id = attachments.message_id),
    space_id   = (SELECT c.space_id FROM messages m
                    JOIN channels c ON c.id = m.channel_id
                   WHERE m.id = attachments.message_id)
  WHERE channel_id IS NULL OR user_id IS NULL
`)

/* The three questions this exists to answer, each one index. */
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_attachments_space ON attachments(space_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_channel ON attachments(channel_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
`)
addColumn('roles', 'space_id', 'TEXT')
addColumn('invites', 'space_id', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_channels_space ON channels(space_id)')

/*
 * The headings a server arranges its channels under.
 *
 * Channels were grouped by what they are - every text channel under one
 * label, every voice one under another - which is a property of the channel
 * rather than a decision anybody made. That stops working somewhere around
 * the tenth channel, and it is also the thing per-channel permissions turn
 * out to need: "the same rules for everything in here" is a sentence about a
 * category, and with no categories there is nothing to say it about.
 *
 * A category holds channels of either kind, the way the headings people
 * actually write do - a Gaming heading with its own voice room under it.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  space_id   TEXT,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_space ON categories(space_id);

/*
 * A question asked in a channel, and the answers to it.
 *
 * The poll's id is the message's id: a poll IS a message, not a thing that
 * hangs off one. That way it is deleted, pinned, searched and permission
 * checked by everything that already knows what a message is, rather than by
 * a second set of rules that has to be kept in step.
 *
 * A vote is one row per option somebody picked, so the same table serves a
 * question that takes one answer and one that takes several. The primary key
 * is what stops anybody being counted twice for the same option; which of the
 * two kinds it is decides whether the older rows are cleared first.
 */
CREATE TABLE IF NOT EXISTS polls (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  /* Whether one answer is allowed or several. */
  multi      INTEGER NOT NULL DEFAULT 0,
  /* When it stops taking answers. Null means it does not, which is what a
     poll with no time limit is. */
  closes_at  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_options (
  message_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (message_id, idx)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  message_id TEXT NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_message ON poll_votes(message_id);

/*
 * Tokens that have been signed out.
 *
 * Signing out used to be a thing the browser did to itself: the token was
 * forgotten locally and stayed valid for the rest of its thirty days, so
 * anybody who had a copy of it still had an account. The only thing that
 * ended a session was changing the password, which ends every session on
 * every device — far too blunt for "sign out on this laptop".
 *
 * A row per signed-out token, kept until the token would have expired anyway.
 * After that the signature is refused on its own and the row is only taking
 * up room, so it is swept.
 */
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_expiry ON revoked_tokens(expires_at);

`)

/*
 * Which heading a channel sits under.
 *
 * Null is the loose group at the top of the list, which is where every
 * channel that exists today starts and where a channel goes when the
 * category it was in is deleted. Deliberately not a foreign key: SQLite can
 * only add a referencing column when it defaults to null, and the delete
 * route has to do more than blank the column anyway.
 */
addColumn('channels', 'category_id', 'TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id)')

/*
 * Whether a channel takes its permissions from its category.
 *
 * Synced is the default, and a synced channel stores no overrides of its
 * own: the category's rows ARE its rows, read live rather than copied. So
 * editing the category moves everything under it at once, and the two can
 * never drift into disagreeing.
 *
 * Unsyncing copies the category's rows down first, so the channel starts
 * from exactly where it already was. That is the whole point of breaking a
 * sync - to change one thing about one channel, not to begin again.
 *
 * Meaningless without a category, which is why a loose channel shows no
 * banner: there is nothing above it to be synced to.
 */
addColumn('channels', 'perms_synced', 'INTEGER NOT NULL DEFAULT 1')

/*
 * A colour somebody picked for a voice room.
 *
 * They were already coloured, from a hash of the id - so every room had one
 * and nobody could choose it. Null means exactly that: keep the one the id
 * gives, which is why this is not defaulted to anything.
 */
addColumn('channels', 'colour', 'TEXT')

/*
 * Where the two groups that are not categories sit in the order.
 *
 * Text and Voice hold whatever nobody has filed. They are not rows in the
 * categories table and never have been, so they had no position and could
 * not be moved - they were simply rendered first, above everything somebody
 * had made. These give them one.
 *
 * Negative by default, so every existing server keeps the arrangement it
 * has: categories start at 0 and count up, so -2 and -1 put the two loose
 * groups above them exactly where they were.
 */
addColumn('spaces', 'loose_text_pos', 'INTEGER NOT NULL DEFAULT -2')
addColumn('spaces', 'loose_voice_pos', 'INTEGER NOT NULL DEFAULT -1')

/*
 * What a role or one person may do in one channel, as against in the server.
 *
 * A role says what somebody may do everywhere. This is the exception to it:
 * read but not write in announcements, write but not attach in the quiet
 * one, one person let into one room without inventing a role to carry them.
 *
 * Three states per permission, not two. A row that allows, a row that
 * denies, and - much the most common - no row at all, meaning "whatever the
 * server already said". Keeping neutral as an absent row is what keeps this
 * table small: a channel nobody has touched costs nothing at all.
 *
 * member_permissions is grant-only and explains why: a server-wide denial
 * has no sensible precedence against the roles it would have to overrule.
 * Here it does have one. The order is fixed and written down in
 * permissionsIn(), and it has to exist, because "everybody may send except
 * this one person" is the request per-channel permissions are for.
 *
 * The target is polymorphic - a channel or a category - so there is no
 * foreign key to sweep these away with. forgetOverrides() is the one place
 * that deletes them, and both delete routes call it.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS permission_overrides (
  scope      TEXT NOT NULL,      -- 'channel' | 'category'
  target_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,      -- 'role' | 'member'
  subject_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  allow      INTEGER NOT NULL,   -- 1 allows, 0 denies; no row means neither
  PRIMARY KEY (scope, target_id, kind, subject_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_overrides_target ON permission_overrides(scope, target_id);
`)

/**
 * Give the entries written before that column existed a server, where the
 * entry itself says which one.
 *
 * Only where it can be read straight off the row - the id of a role, a
 * channel, an invite or a space that is still there. Nothing is inferred
 * from who acted or when: a wrong attribution here would put one server's
 * history into another server's log, which is the exact fault this is
 * cleaning up after.
 *
 * What cannot be resolved keeps its null and is shown to nobody. That
 * includes anything naming a role or channel that has since been deleted,
 * and entries whose detail was only ever a name.
 */
for (const [sql, why] of [
  // detail is the role's id.
  [`UPDATE audit SET space_id = (SELECT r.space_id FROM roles r WHERE r.id = audit.detail)
     WHERE space_id IS NULL AND action = 'role.update'`, 'role edits'],
  // detail is "<member id> <role id>".
  [`UPDATE audit SET space_id = (
       SELECT r.space_id FROM roles r
        WHERE r.id = substr(audit.detail, instr(audit.detail, ' ') + 1))
     WHERE space_id IS NULL AND action IN ('member.role.grant', 'member.role.revoke')`,
   'roles handed out'],
  // detail is the channel's id, or that id followed by a word.
  [`UPDATE audit SET space_id = (
       SELECT c.space_id FROM channels c
        WHERE c.id = CASE WHEN instr(audit.detail, ' ') > 0
                          THEN substr(audit.detail, 1, instr(audit.detail, ' ') - 1)
                          ELSE audit.detail END)
     WHERE space_id IS NULL AND action IN ('channel.update', 'channel.access')`, 'channel edits'],
  // detail is the invite code.
  [`UPDATE audit SET space_id = (SELECT i.space_id FROM invites i WHERE i.code = audit.detail)
     WHERE space_id IS NULL AND action IN ('invite.create', 'invite.revoke')`, 'invites'],
  // detail is the space's own id.
  [`UPDATE audit SET space_id = (SELECT s.id FROM spaces s WHERE s.id = audit.detail)
     WHERE space_id IS NULL AND action = 'space.join'`, 'people joining'],
] as const) {
  try {
    const done = db.prepare(sql).run()
    if (Number(done.changes) > 0) console.log(`[audit] placed ${done.changes} entries for ${why}`)
  } catch {
    // An older database may not have the table this reads from. Losing the
    // attribution is a cosmetic loss; failing to start is not.
  }
}

/*
 * Declared here rather than beside the rest of the containment work below,
 * because the seed on the next line now writes containment - it makes the
 * first server and puts everybody in it - and a table cannot be written
 * before it exists. The reasoning for these two tables is with the backfill
 * and the triggers further down.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS containers (
  id     TEXT PRIMARY KEY,
  kind   TEXT NOT NULL CHECK (kind IN ('space', 'dm', 'group')),
  made   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS container_members (
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (container_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_container_members_user ON container_members(user_id);
`)


/**
 * The server this install was seeded with.
 *
 * Not a default, and never an answer to "which server is this in". It used to
 * be a helper naming the oldest server, and the name invited exactly the
 * mistake it caused: a dozen places fell back to it, so a question about nothing
 * was answered about whichever server happened to be oldest. That put one
 * server's permissions, ownership and moderation into another's - which is
 * the opposite of the one rule this app has, that servers are independent.
 *
 * Every one of those is gone. What is left is the two things that genuinely
 * mean the very first server: seeding a fresh database, and joining the
 * server that seed made. The database now
 * refuses a role, an invite or a room without a server of its own, so there
 * are no longer any rows for a fallback to be about.
 *
 * Cached, and forgotten when a server is deleted.
 */


/**
 * The role everybody in a server holds without being given anything.
 *
 * By kind rather than by a fixed id, because every server has one of its own
 * now. Null for a server that has none yet, where the defaults apply.
 */
export function everyoneRoleId(spaceId: string | null): string | null {
  /*
   * No server means no server.
   *
   * Asked about nothing, this used to answer about whichever server happened
   * to be created first - a leftover from when the install was the server and
   * there was only ever one. That is a wrong answer rather than a missing
   * one, which is the worse kind, because it looks like an answer.
   */
  const id = spaceId
  if (!id) return null
  const row = db.prepare("SELECT id FROM roles WHERE kind = 'everyone' AND space_id = ?")
    .get(id) as { id?: string } | undefined
  return row?.id ?? null
}

/**
 * Give a new server its own pair of special roles.
 *
 * A server that starts fresh has to start with its own @everyone, or its
 * owner is editing the original server's when they open the roles screen -
 * which is either a permission denied or, worse, a change somewhere else.
 */
/**
 * What a brand new member can do before any role is granted.
 *
 * Here rather than in permissions.ts because that file imports this one, and
 * the two places that seed an @everyone role live here. They used to write
 * the list out by hand instead, which is how create_polls came to be in the
 * defaults and missing from every server made after it: the permission was
 * added in one place and the literal in the other went on saying what it
 * always had. A migration went back and granted it to the roles that already
 * existed, and new servers quietly kept getting the stale list.
 *
 * One list, and both seeds read it, so it cannot drift again.
 */
export const EVERYONE_DEFAULTS: Permission[] = [
  // Every one of these is enforced somewhere. embed_links used to be here and
  // was enforced nowhere, and because it was also missing from PERMISSIONS it
  // made this role permanently unsaveable.
  'view_channels', 'send_messages', 'attach_files',
  'add_reactions', 'create_polls', 'read_history', 'create_invite',
]

export function seedRolesFor(spaceId: string): void {
  const existing = db.prepare("SELECT 1 FROM roles WHERE space_id = ? AND kind = 'everyone'").get(spaceId)
  if (existing) return

  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO roles (id, name, colour, position, permissions, hoist, mentionable, created_at, space_id, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insert.run(randomUUID(), 'Owner', '#4C8DFF', 100, JSON.stringify(['*']), 1, 1, now, spaceId, 'owner')
  insert.run(
    randomUUID(), '@everyone', '#8395A6', 0,
    JSON.stringify(EVERYONE_DEFAULTS),
    0, 0, now, spaceId, 'everyone',
  )
}


type Col = {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/**
 * Rebuild one table with a different definition, keeping every row.
 *
 * SQLite cannot alter a column, so the only way to add NOT NULL or a CHECK to
 * a table that already exists is to build a new one beside it and swap. Rows
 * are counted on both sides and the whole thing rolls back if a single one
 * would be lost - a migration that silently drops the rows it cannot fit is
 * worse than one that refuses to run.
 *
 * `legacy_alter_table` is on for the rename so that other tables' references
 * are left alone rather than helpfully rewritten to point at the temporary
 * name mid-swap. Ids do not change, so everything that referenced a row still
 * does. Same approach as the username widening above, which has already done
 * this to the most-referenced table in the database.
 *
 * Dropping a table drops its indexes and its triggers with it, silently. That
 * is a footnote for a table with two indexes and a paragraph for `channels`,
 * which four containment triggers hang off - a rebuild that forgot them would
 * leave a database that looks right and has stopped recording who is in a
 * conversation. So both are read back from the schema first and replayed
 * after, rather than listed here and gradually falling behind what is
 * actually on the table.
 */
function rebuildTable(
  table: string,
  define: (c: Col) => string,
  constraints: string[] = [],
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Col[]
  if (cols.length === 0) return
  const names = cols.map((c) => c.name).join(', ')
  const before = (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n

  /* Everything hanging off it. `sql` is null for the indexes SQLite makes
     itself for a UNIQUE or a primary key, and those come back on their own
     with the new table. */
  const hangingOff = (db.prepare(
    `SELECT sql FROM sqlite_master
      WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL`
  ).all(table) as unknown as Array<{ sql: string }>).map((r) => r.sql)

  const body = [...cols.map(define), ...constraints].join(',\n  ')

  db.exec('PRAGMA foreign_keys = OFF')
  db.exec('PRAGMA legacy_alter_table = ON')
  try {
    db.exec('BEGIN')
    db.exec(`CREATE TABLE ${table}_rebuild (\n  ${body}\n)`)
    db.exec(`INSERT INTO ${table}_rebuild (${names}) SELECT ${names} FROM ${table}`)
    const after = (db.prepare(`SELECT COUNT(*) n FROM ${table}_rebuild`).get() as { n: number }).n
    if (after !== before) throw new Error(`${table}: ${before} rows in, ${after} out`)
    db.exec(`DROP TABLE ${table}`)
    db.exec(`ALTER TABLE ${table}_rebuild RENAME TO ${table}`)
    for (const sql of hangingOff) db.exec(sql)
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* nothing was open */ }
    try { db.exec(`DROP TABLE IF EXISTS ${table}_rebuild`) } catch { /* nor that */ }
    throw err
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF')
    db.exec('PRAGMA foreign_keys = ON')
  }

  const back = (db.prepare(
    `SELECT COUNT(*) n FROM sqlite_master
      WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL`
  ).get(table) as { n: number }).n
  if (back !== hangingOff.length) {
    console.error(`[db] ${table}: ${hangingOff.length} indexes and triggers before, ${back} after`)
  }
}

/** Whether a column already refuses nulls, so this only runs once. */
function isNotNull(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Col[]
  return cols.some((c) => c.name === column && c.notnull === 1)
}

/**
 * Make "this belongs to a server" a rule the database keeps.
 *
 * space_id was added to roles, channels and invites by ALTER TABLE, and
 * SQLite cannot add a NOT NULL column that way - so all three arrived
 * nullable, with no foreign key, on the tables that predate servers existing.
 * Every table written since (space_members, categories) has the constraint.
 *
 * That gap is the whole reason the old fallbacks existed - a dozen places
 * that, asked about nothing, answered about whichever server was oldest. The
 * code assumes a role and a text channel always know their server, and where
 * that assumption failed the fallback did not fail with it: it answered about
 * a different one. An ownership test, a membership test and a permission set
 * all quietly became somebody else's. They are gone; this is what makes their
 * absence safe rather than merely tidier, and it is why this function stays
 * when the migrations beside it did not.
 *
 * Channels are the exception, and not the one it looks like. A conversation
 * is a row in channels with no server, legitimately and permanently - so the
 * rule there is not "always has a space", it is "has a space if and only if
 * it is not a conversation", which is what the CHECK says and what the code
 * has always meant.
 *
 * Skipped, loudly, rather than enforced, if anything still has a null after
 * the backfills. A server that will not start is not an improvement on one
 * with a row in the wrong place.
 */
export function tightenSpaceColumns(): string[] {
  const done: string[] = []

  const stragglers = (t: string, where: string): number =>
    (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${where}`).get() as { n: number }).n

  for (const table of ['roles', 'invites'] as const) {
    if (isNotNull(table, 'space_id')) continue
    const left = stragglers(table, 'space_id IS NULL')
    if (left > 0) {
      console.error(`[db] ${left} ${table} still have no server; leaving space_id nullable`)
      continue
    }
    rebuildTable(table, (c) => {
      const bits = [c.name, c.type || 'TEXT']
      if (c.pk) bits.push('PRIMARY KEY')
      if (c.name === 'space_id') bits.push('NOT NULL REFERENCES spaces(id) ON DELETE CASCADE')
      else if (c.notnull && !c.pk) bits.push('NOT NULL')
      if (c.dflt_value !== null) bits.push(`DEFAULT ${c.dflt_value}`)
      return bits.join(' ')
    })
    done.push(table)
  }

  /*
   * And the channels rule, which is the one that actually gets asked.
   *
   * A conversation has no server; a room in a server has one. Stated as a
   * CHECK, a row that breaks it cannot be written at all - which is stronger
   * than NOT NULL and is the rule the permission code has always assumed.
   */
  const hasCheck = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'channels'"
  ).get() as { sql: string } | undefined)?.sql?.includes('space_id IS NULL')
  if (!hasCheck) {
    const wrong = stragglers('channels', "(kind IN ('dm', 'group')) != (space_id IS NULL)")
    if (wrong > 0) {
      console.error(`[db] ${wrong} channels disagree about having a server; leaving the rule off`)
      return done
    }
    rebuildTable(
      'channels',
      (c) => {
        const bits = [c.name, c.type || 'TEXT']
        if (c.pk) bits.push('PRIMARY KEY')
        if (c.name === 'space_id') bits.push('REFERENCES spaces(id) ON DELETE CASCADE')
        else if (c.notnull && !c.pk) bits.push('NOT NULL')
        if (c.dflt_value !== null) bits.push(`DEFAULT ${c.dflt_value}`)
        return bits.join(' ')
      },
      ["CHECK ((kind IN ('dm', 'group')) = (space_id IS NULL))"],
    )
    done.push('channels')
  }

  if (done.length > 0) {
    const broken = db.prepare('PRAGMA foreign_key_check').all() as unknown[]
    if (broken.length > 0) {
      console.error('[db] references left dangling after tightening:', broken.length)
    }
  }
  return done
}


/**
 * Give a space's owner the Owner role, in the table the app reads.
 *
 * The role was created with every space and handed to nobody. Authority never
 * depended on it - permissions come from spaces.owner_id, so the owner really
 * did hold every right - but the app shows who holds what by reading
 * member_roles, and that said the owner held nothing. So somebody who had
 * just made a server saw themselves grouped under @everyone, with no Owner
 * heading and no sign the server was theirs.
 *
 * Idempotent, so it is safe to call on every start and again whenever a space
 * is made.
 */
export function grantOwnerRole(spaceId: string): void {
  const space = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(spaceId) as
    { owner_id: string | null } | undefined
  if (!space?.owner_id) return

  const role = db.prepare("SELECT id FROM roles WHERE space_id = ? AND kind = 'owner'").get(spaceId) as
    { id: string } | undefined
  if (!role) return

  // Only to somebody actually in the space: a space whose owner has left is
  // a mess, but it is not one this should quietly paper over.
  if (!isInContainer(space.owner_id, spaceId)) return

  db.prepare(
    'INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)'
  ).run(space.owner_id, role.id)
}



/** Did this person make this space? Whoever did has every right inside it. */
export function ownsSpace(userId: string, spaceId: string | null): boolean {
  /*
   * No server means no server.
   *
   * Asked about nothing, this used to answer about whichever server happened
   * to be created first - a leftover from when the install was the server and
   * there was only ever one. That is a wrong answer rather than a missing
   * one, which is the worse kind, because it looks like an answer.
   */
  const id = spaceId
  if (!id) return false
  const row = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(id) as
    { owner_id: string | null } | undefined
  return row?.owner_id === userId
}

/** Is this person in this space? A DM has no space and never asks. */
/**
 * Every channel one person's client is given at sign-in.
 *
 * Two questions, asked separately, because they are two different things
 * that happen to share a table: the channels of the servers they are in, and
 * the conversations they are part of.
 *
 * It used to be one query for every text and voice channel in the app,
 * filtered down afterwards in JavaScript. Correct - membership is checked
 * again before any of it is used - but priced by the size of the whole app
 * rather than by the size of the answer, on the path every connection takes.
 * Measured at 2,000 servers and 40,000 channels, for somebody in ten of
 * them: 56.65ms and 40,002 rows became 0.20ms and 202.
 *
 * The `OR` was also what made an index impossible. One question per query is
 * what lets each of them use one.
 */
export function channelsForClient(userId: string): Array<Record<string, unknown>> {
  /*
   * One question, because there is one thing to ask about.
   *
   * This was two queries - the rooms of the servers you are in, and the
   * conversations you are part of - because those were two kinds of
   * membership living in two tables. They are one table now, so this is one
   * join, and a container of a kind that does not exist yet arrives here
   * without this function being touched. That is the point of the change: a
   * new sort of place to talk becomes a row rather than a branch.
   *
   * Safe to read from because the database maintains it. The triggers mean a
   * server made a second ago is already here; the backfill means one made
   * last year is too. Checked against the query this replaced, for every
   * account, in containment.test.ts - which keeps the old shape written out
   * so that the comparison stays a comparison.
   */
  /*
   * Two arms rather than one COALESCE, because of how it is answered.
   *
   * COALESCE(c.space_id, c.id) is one tidy line and cannot use an index: the
   * planner has no way to work backwards from a member's containers to the
   * rows that would match, so it read every channel on the instance and threw
   * away the ones that were not this person's. Which is the very thing this
   * function was written to stop doing - it just moved the scan from the
   * frame to the query.
   *
   * Written as the two questions it really is, each one indexed, both driven
   * from the containers this person is in: the rooms of my servers, by
   * idx_channels_space, and my conversations, by the channels primary key.
   * A conversation is its own container so the second arm is an id lookup;
   * they cannot overlap, because a server id is never a channel id, which is
   * what makes UNION ALL right rather than UNION.
   */
  return db.prepare(
    `SELECT c.* FROM container_members m
       JOIN channels c ON c.space_id = m.container_id
      WHERE m.user_id = ?
     UNION ALL
     SELECT c.* FROM container_members m
       JOIN channels c ON c.id = m.container_id
      WHERE m.user_id = ?
      ORDER BY kind DESC, position ASC`
  ).all(userId, userId) as Array<Record<string, unknown>>
}

/**
 * Is this person in this container?
 *
 * The one membership question. A server, a conversation and a group are all
 * containers, so "are you in it" has a single answer here rather than one per
 * kind - which is what lets the lookups below become wrappers around one row
 * instead of three tables.
 */
export function isInContainer(userId: string, containerId: string | null): boolean {
  if (!containerId) return false
  return Boolean(
    db.prepare('SELECT 1 FROM container_members WHERE container_id = ? AND user_id = ?')
      .get(containerId, userId)
  )
}

/**
 * Everybody in a container, by id.
 *
 * The same list whether it is a server, a conversation or a group. This exact
 * query - "who is in this space" - was written out identically in eight
 * places across four files, which is both a duplication and eight things to
 * remember when the answer moves. It has one home now.
 */
export function membersOfContainer(containerId: string): string[] {
  return (db
    .prepare('SELECT user_id FROM container_members WHERE container_id = ?')
    .all(containerId) as unknown as Array<{ user_id: string }>).map((r) => r.user_id)
}

/**
 * Joining, leaving, and the two things a membership can say about itself.
 *
 * Every write to membership goes through these five. Until now the writes
 * said space_members or dm_members and triggers mirrored them into
 * container_members - which was the right way to start reading from the new
 * table without touching thirteen call sites, but it leaves the old tables as
 * the thing that is actually written, and they cannot be dropped while that
 * is true.
 *
 * So these write containment first and the old table second, and when the old
 * tables go it is one line out of each of these rather than another sweep of
 * five files looking for the thirteen. The triggers stay meanwhile: they fire
 * on the second write and find the row already there, which is what INSERT OR
 * IGNORE is for.
 *
 * Which old table a container belongs to is a fact about the container, so it
 * is read from the container rather than passed in and occasionally passed in
 * wrong.
 */
function kindOf(containerId: string): 'space' | 'dm' | 'group' | null {
  const row = db.prepare('SELECT kind FROM containers WHERE id = ?').get(containerId) as
    { kind: 'space' | 'dm' | 'group' } | undefined
  return row?.kind ?? null
}

/**
 * The container for something that exists, making it if it is not there.
 *
 * While the triggers existed, making a server or a conversation made its
 * container as a side effect and nothing had to remember. They are gone, and
 * makeContainer is called at each of the places one is born - but "called at
 * each of the places" is a promise about every future call site, and the
 * penalty for breaking it is a foreign key error the first time somebody
 * joins. In a test that is a red line; on the live server it is a 500 when
 * somebody accepts an invite.
 *
 * So the kind is worked out from the tables that already know it, and the row
 * is written if it is missing. Nothing is guessed: a server is a row in
 * spaces, a conversation is a channel whose kind says so. It says when it has
 * had to do this, because needing to means a call site was missed.
 */
function containerFor(id: string): 'space' | 'dm' | 'group' | null {
  const known = kindOf(id)
  if (known) return known

  const space = db.prepare('SELECT created_at FROM spaces WHERE id = ?').get(id) as
    { created_at: number } | undefined
  if (space) {
    console.warn(`[db] making a container for server ${id} late - something did not`)
    makeContainer(id, 'space', space.created_at)
    return 'space'
  }

  const channel = db.prepare('SELECT kind, created_at FROM channels WHERE id = ?').get(id) as
    { kind: string; created_at: number } | undefined
  if (channel && isConversationKind(channel.kind)) {
    console.warn(`[db] making a container for conversation ${id} late - something did not`)
    makeContainer(id, channel.kind as 'dm' | 'group', channel.created_at)
    return channel.kind as 'dm' | 'group'
  }

  return null
}

export function joinContainer(
  userId: string,
  containerId: string,
  joinedAt: number = Date.now(),
  position: number | null = null,
): void {
  const kind = containerFor(containerId)
  /*
   * A conversation's members are recorded as having joined when it was made.
   *
   * Not because the moment matters - nothing shows it - but because that is
   * what the trigger and the backfill both wrote, and a row that disagrees
   * with the rows beside it is a difference somebody has to explain later.
   */
  const at = kind === 'space' ? joinedAt : (db
    .prepare('SELECT created_at FROM channels WHERE id = ?')
    .get(containerId) as { created_at: number } | undefined)?.created_at ?? 0

  db.prepare(
    'INSERT OR IGNORE INTO container_members (container_id, user_id, joined_at, position) VALUES (?, ?, ?, ?)'
  ).run(containerId, userId, at, position)

}

/**
 * A container comes into being, and stops being.
 *
 * The trigger did this, so nothing else had to know that making a server or a
 * conversation also makes the thing that holds its people. Dropping the
 * triggers in a test showed what that had been covering: every join failed on
 * the foreign key, because the row it points at was never written. Which is
 * the answer to "are the helpers enough on their own" - they were not, and
 * this is the part that was missing.
 */
export function makeContainer(id: string, kind: 'space' | 'dm' | 'group', made: number): void {
  db.prepare('INSERT OR IGNORE INTO containers (id, kind, made) VALUES (?, ?, ?)').run(id, kind, made)
}

/** Its members go with it: container_members is ON DELETE CASCADE. */
export function unmakeContainer(id: string): void {
  db.prepare('DELETE FROM containers WHERE id = ?').run(id)
}

export function leaveContainer(userId: string, containerId: string): void {
  db.prepare('DELETE FROM container_members WHERE container_id = ? AND user_id = ?')
    .run(containerId, userId)
}

/** Everybody leaves at once, which is what deleting a server is. */
export function emptyContainer(containerId: string): void {
  db.prepare('DELETE FROM container_members WHERE container_id = ?').run(containerId)
}

/** Where a server sits in one person's rail. Their own order, nobody else's. */
export function setRailPosition(userId: string, containerId: string, position: number): void {
  db.prepare('UPDATE container_members SET position = ? WHERE container_id = ? AND user_id = ?')
    .run(position, containerId, userId)
}

/**
 * Closing a conversation, and it coming back.
 *
 * `userId` of null means everybody in it, which is what happens when
 * something is said: a conversation somebody closed reopens for them because
 * there is now something in it to read.
 *
 * Returns how many people it changed, so a caller can tell "you closed it"
 * from "that is not a conversation of yours" - which is the difference
 * between a 200 and a 404 in the route that closes one.
 */
export function setConversationClosed(
  userId: string | null,
  containerId: string,
  at: number | null,
): number {
  const who = userId === null ? '' : ' AND user_id = ?'
  const args = userId === null ? [at, containerId] : [at, containerId, userId]
  const changed = db.prepare(
    `UPDATE container_members SET hidden_at = ? WHERE container_id = ?${who}`
  ).run(...(args as [number | null, string, ...string[]]))
  return Number(changed.changes)
}


/**
 * The one-to-one conversation between two people, if there is one.
 *
 * Written out four times before this, in three files, in two slightly
 * different forms - and the difference mattered: one of them also insisted
 * the conversation had exactly two people in it, and three did not. That is
 * the kind of divergence nobody notices, because all four agree until the day
 * a malformed row exists and then they disagree about which is real.
 *
 * The strict version wins, since it is the one that says what a `dm` is: a
 * pair. A conversation with more people in it is a group, and has its own
 * kind. True of every row in the live table when this was written, so the
 * check costs nothing and closes the case where it would not be.
 */
export function conversationBetween(a: string, b: string): string | null {
  const row = db.prepare(
    `SELECT x.container_id AS id FROM container_members x
       JOIN container_members y ON y.container_id = x.container_id
       JOIN containers k ON k.id = x.container_id
      WHERE x.user_id = ? AND y.user_id = ? AND k.kind = 'dm'
        AND (SELECT COUNT(*) FROM container_members m WHERE m.container_id = k.id) = 2
      LIMIT 1`
  ).get(a, b) as { id?: string } | undefined
  return row?.id ?? null
}

/**
 * Is this person in this server?
 *
 * No server means no server: asked about nothing, this used to answer about
 * whichever server happened to be created first, which is a wrong answer
 * rather than a missing one.
 */
export function isSpaceMember(userId: string, spaceId: string | null): boolean {
  return isInContainer(userId, spaceId)
}

/*
 * Names stop being unique, and get four digits after them instead.
 *
 * Two people cannot both be Keeko today, which is fine among five friends and
 * wrong the moment anybody can sign up: the good names go to whoever arrives
 * first and everybody after them picks a spelling they did not want. A
 * discriminator makes the name the part you choose and the digits the part
 * that makes it unique.
 *
 * An empty discriminator means the bare name, which is how an account claims
 * it outright - nobody else can hold that name with no digits, while anyone
 * may still be Keeko#4821. Existing accounts keep their bare names, because
 * they already hold them and renaming five people to something they did not
 * pick is not a migration anybody asked for.
 *
 * `verified` is separate on purpose. Holding the bare name is about the name;
 * the badge is a claim that the person is who they say they are, and the
 * owner grants it. Keeping them apart means one can be given without the
 * other.
 */
addColumn('users', 'discriminator', "TEXT NOT NULL DEFAULT ''")
addColumn('users', 'verified', 'INTEGER NOT NULL DEFAULT 0')
/*
 * When a status stops being true.
 *
 * Milliseconds, and 0 for "until I say otherwise" - which is what every
 * status was before this. Kept as a moment rather than a duration because a
 * duration has to be counted from something, and the only thing that could
 * count it is the row's own last write.
 *
 * Nothing sweeps these. The moment goes out with the user, and an expired one
 * reads as no status at all - here, so that every list gets the same answer,
 * and again in the client, so that one already on somebody's screen goes
 * without waiting for anything to be refetched.
 */
addColumn('users', 'status_until', 'INTEGER NOT NULL DEFAULT 0')

/*
 * The four lookups that had no index, and are asked constantly.
 *
 * After the migrations rather than beside the table definitions: three of
 * these columns are themselves added by a migration, so on a database being
 * built for the first time the index would be created against a column that
 * does not exist yet - which is exactly how this first went in, and every
 * test that starts from an empty file said so at once.
 *
 * Every one was a full scan of something that grows with the number of
 * servers in the app, and three are on the path every connection takes.
 * Measured on a synthetic 2,000 servers / 10,000 roles / 50,000 memberships:
 *
 *   the roles somebody holds, at sign-in   62.10ms -> 0.14ms   (449x)
 *   who holds one role                      1.75ms -> 0.02ms    (84x)
 *   the roles of one server                 0.39ms -> 0.01ms    (43x)
 *   how many servers somebody owns          0.08ms -> 0.01ms    (16x)
 *   the @everyone role of a server          0.06ms -> 0.00ms    (15x)
 *
 * The last matters most despite the smallest number: it is read on every
 * permission check, so it is asked thousands of times where the rest are
 * asked once.
 */
db.exec(`
CREATE INDEX IF NOT EXISTS idx_roles_space ON roles(space_id);
CREATE INDEX IF NOT EXISTS idx_member_roles_role ON member_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_spaces_owner ON spaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_invites_space ON invites(space_id);
`)

/*
 * The table from before there was more than one server.
 *
 * `space`, singular, held one row: the name and description of the whole
 * app, back when the app was one server. `spaces` replaced it, and the
 * row was copied across - but the old table stayed, was still written to
 * every time the first server was renamed, and was still created empty on
 * every fresh install, for nothing.
 *
 * Two tables one letter apart, one of them live and one of them a ghost that
 * still took writes. One migration read it once, defensively, for a
 * database old enough to need migrating; by the time this runs it has had
 * that chance, and nothing else has wanted it since servers arrived.
 */
db.exec('DROP TABLE IF EXISTS space')

/* ------------------------------------------------------------ containment --
 *
 * What holds a channel.
 *
 * A channel is a stream of messages and nothing else. What contains it varies
 * - a server, a conversation between two people, a group, and later whatever
 * else - and today that variety is expressed twice: `channels.space_id`,
 * which is null for anything that is not in a server, and `kind`, which says
 * what the null means. Membership is expressed twice as well, in
 * `space_members` and `dm_members`, so "what may this person see" is two
 * questions joined by hand in JavaScript rather than one the database can
 * answer.
 *
 * That is what made the sign-in frame read every channel in the app: the
 * one query could not express "the things I am in", because the things
 * somebody is in were not one thing.
 *
 * So containment becomes a row of its own. One container per server, one per
 * conversation, and one table saying who is in a container - whatever kind it
 * is. Then the question has one shape, one index answers it, and a new kind
 * of container is a new row rather than another nullable column and another
 * branch at every call site.
 *
 * Nothing reads these yet. They are filled and checked against the answers
 * the current tables give, and only once those agree for every person on the
 * machine is there any reason to start reading them. Adding a table cannot
 * break anything; swapping the reads can, so the two are kept apart.
 */

/** Whether a table is still in this database. */
function hasTable(name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name))
}

/**
 * Fill containment from what the old tables already said.
 *
 * Idempotent by construction - every write is an INSERT OR IGNORE keyed on
 * what it describes - so it converged rather than duplicating, and it kept up
 * with rows made by code that still wrote only the old tables.
 *
 * A server's container has the server's own id, and a conversation's has the
 * channel's. Not because a container is those things, but because reusing the
 * id makes every backfill a join rather than a lookup table, and makes a
 * mismatch obvious when comparing the two answers.
 *
 * Kept, and does nothing once the old tables are gone: a database that has
 * not been opened since before the change still needs its history moved
 * across, and this is what does that. It is only dead for a database that has
 * already been through it once.
 */
function backfillContainment(): number {
  if (!hasTable('space_members') || !hasTable('dm_members')) return 0
  const now = Date.now()
  const was = (db.prepare('SELECT COUNT(*) n FROM container_members').get() as { n: number }).n
  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT OR IGNORE INTO containers (id, kind, made)
       SELECT id, 'space', created_at FROM spaces`
    ).run()
    db.prepare(
      `INSERT OR IGNORE INTO containers (id, kind, made)
       SELECT id, kind, created_at FROM channels WHERE kind IN ('dm', 'group')`
    ).run()
    db.prepare(
      `INSERT OR IGNORE INTO container_members (container_id, user_id, joined_at)
       SELECT space_id, user_id, joined_at FROM space_members`
    ).run()
    /* dm_members has no joined_at, so the conversation's own age stands in.
       Nothing reads it yet; it exists so the column can be NOT NULL. */
    db.prepare(
      `INSERT OR IGNORE INTO container_members (container_id, user_id, joined_at)
       SELECT dm.channel_id, dm.user_id, COALESCE(c.created_at, ?)
         FROM dm_members dm JOIN channels c ON c.id = dm.channel_id`
    ).run(now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    console.warn('[db] containment backfill did not run', err)
    return 0
  }
  return (db.prepare('SELECT COUNT(*) n FROM container_members').get() as { n: number }).n - was
}
/*
 * Where somebody has dragged each of their servers.
 *
 * A rail order is a property of a membership, not of the server - two people
 * in the same servers arrange them differently - so it belongs here rather
 * than staying behind on space_members. Null until somebody drags something,
 * which is what keeps an untouched rail in the order things were joined.
 */
addColumn('container_members', 'position', 'INTEGER')

/*
 * A conversation somebody has closed.
 *
 * Theirs alone - closing takes it off your list and nobody else's - so like
 * position it is a fact about the membership rather than about the thing, and
 * it moves here with it. Null means open, which is what almost every row is.
 */
addColumn('container_members', 'hidden_at', 'INTEGER')

const filledIn = backfillContainment()

/**
 * And then the old tables go.
 *
 * Membership lived in space_members and dm_members. It lives in
 * container_members now: every read moved first, then every write, with both
 * kept in step so the old pair stayed a second opinion the whole way. That
 * second opinion has done its work - every route that can change a membership
 * has been driven through and compared, in test/server/containmentparity.mjs
 * - and a second opinion nothing writes any more is just two tables going
 * quietly out of date.
 *
 * It checks before it drops, and refuses rather than destroying. Not because
 * a disagreement is expected, but because this is the one step that cannot be
 * undone from inside the app: a database that arrives here disagreeing is a
 * database where something was missed, and the old tables are the only record
 * of what. Better a server that starts with a loud line in the log and two
 * extra tables than one that quietly threw away the evidence.
 *
 * Six of the ten triggers are on the tables being dropped and go with them.
 * Of the four on `spaces` and `channels`, the two that make a container go
 * too - makeContainer is called where a server or a conversation is made, and
 * a container that is missing fails loudly, on the foreign key, the moment
 * anybody joins.
 *
 * The two that remove one stay. Not for symmetry - for the opposite reason.
 * A container left behind after its server is deleted breaks nothing at the
 * moment it happens: the row simply sits there, with its members, and a
 * server nobody can name appears in somebody's list. Nothing throws, nothing
 * logs. There is no foreign key that could catch it either, because a
 * container's id is a server's or a channel's and SQLite cannot reference
 * one-of-two. So the guard stays where the failure would be silent.
 */
function dropTheOldMembershipTables(filledIn: number): void {
  if (!hasTable('space_members') && !hasTable('dm_members')) return

  /*
   * One thing this cannot see, said out loud rather than left implied.
   *
   * The backfill runs first and only goes one way, old to new - so a
   * membership the old tables had and containment did not is already fixed by
   * the time the comparison happens, and the comparison finds nothing. That
   * is the right outcome for the data and the wrong outcome for knowing about
   * it, on the one boot where the evidence is about to be thrown away. So if
   * the backfill had anything to do at all, it says so.
   */
  if (filledIn > 0) {
    console.warn(
      `[db] the backfill added ${filledIn} membership(s) on this boot - containment was ` +
      'behind the old tables, and they are about to be dropped. Worth knowing why.'
    )
  }

  const disagreements: string[] = []
  const count = (sql: string): number =>
    (db.prepare(sql).get() as { n: number }).n

  if (hasTable('space_members')) {
    disagreements.push(...[
      ['a server membership containment does not have', `
        SELECT COUNT(*) n FROM space_members s
         WHERE NOT EXISTS (SELECT 1 FROM container_members m
                            WHERE m.container_id = s.space_id AND m.user_id = s.user_id)`],
      ['a server membership only containment has', `
        SELECT COUNT(*) n FROM container_members m
          JOIN containers k ON k.id = m.container_id AND k.kind = 'space'
         WHERE NOT EXISTS (SELECT 1 FROM space_members s
                            WHERE s.space_id = m.container_id AND s.user_id = m.user_id)`],
      ['a rail position the two disagree about', `
        SELECT COUNT(*) n FROM space_members s JOIN container_members m
            ON m.container_id = s.space_id AND m.user_id = s.user_id
         WHERE IFNULL(s.position, -1) != IFNULL(m.position, -1)`],
    ].map(([what, sql]) => [what, count(sql!)] as const)
      .filter(([, n]) => n > 0)
      .map(([what, n]) => `${n} × ${what}`))
  }

  if (hasTable('dm_members')) {
    disagreements.push(...[
      ['a conversation membership containment does not have', `
        SELECT COUNT(*) n FROM dm_members d
         WHERE NOT EXISTS (SELECT 1 FROM container_members m
                            WHERE m.container_id = d.channel_id AND m.user_id = d.user_id)`],
      ['a conversation membership only containment has', `
        SELECT COUNT(*) n FROM container_members m
          JOIN containers k ON k.id = m.container_id AND k.kind IN ('dm', 'group')
         WHERE NOT EXISTS (SELECT 1 FROM dm_members d
                            WHERE d.channel_id = m.container_id AND d.user_id = m.user_id)`],
      ['a closed conversation the two disagree about', `
        SELECT COUNT(*) n FROM dm_members d JOIN container_members m
            ON m.container_id = d.channel_id AND m.user_id = d.user_id
         WHERE IFNULL(d.hidden_at, -1) != IFNULL(m.hidden_at, -1)`],
    ].map(([what, sql]) => [what, count(sql!)] as const)
      .filter(([, n]) => n > 0)
      .map(([what, n]) => `${n} × ${what}`))
  }

  if (disagreements.length > 0) {
    console.error(
      '[db] NOT dropping the old membership tables - they do not agree with containment:'
    )
    for (const d of disagreements) console.error('[db]   ' + d)
    console.error('[db] the old tables are the only record of what was missed. Keeping them.')
    return
  }

  const kept = ['containment_space_gone', 'containment_talk_gone']
  db.exec('BEGIN')
  try {
    for (const t of ['containment_space_made', 'containment_talk_made']) {
      db.exec(`DROP TRIGGER IF EXISTS ${t}`)
    }
    db.exec('DROP TABLE IF EXISTS space_members')
    db.exec('DROP TABLE IF EXISTS dm_members')
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* nothing was open */ }
    console.error('[db] could not drop the old membership tables', err)
    return
  }

  const left = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'containment_%'"
  ).all() as Array<{ name: string }>).map((r) => r.name).sort()
  console.log(
    `[db] membership is one table now; the old two are gone, and the guards that stay are ${
      left.join(', ') || 'none'}`
  )
  if (left.join(',') !== kept.sort().join(',')) {
    console.error('[db] expected exactly the two removal guards to remain')
  }
}


/*
 * And kept in step by the database itself.
 *
 * Ten places write a server, a membership or a conversation, across four
 * files - three of them near-identical blocks that make a DM. Adding a
 * containment write to each is ten chances to miss one, and the one that is
 * missed does not fail: it quietly leaves somebody out of a room they are in.
 *
 * Triggers make that impossible instead of unlikely. Every existing write
 * keeps working untouched and containment is exact by construction rather
 * than by everybody remembering. When the writes are eventually moved to say
 * containment directly these come out; until then they are what makes it safe
 * to start reading from it.
 *
 * The backfill above stays too: a trigger only fires from the moment it
 * exists, and a database that predates them needs its history filled once.
 */
db.exec(`
CREATE TRIGGER IF NOT EXISTS containment_space_gone
AFTER DELETE ON spaces BEGIN
  DELETE FROM containers WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS containment_talk_gone
AFTER DELETE ON channels WHEN OLD.kind IN ('dm', 'group') BEGIN
  DELETE FROM containers WHERE id = OLD.id;
END;
`)

dropTheOldMembershipTables(filledIn)

/**
 * Drop the single-column UNIQUE on username, which SQLite can only do by
 * rebuilding the table.
 *
 * The one migration here that is not additive, so it is written to be run
 * once and to leave the database untouched if any part of it fails. The new
 * table is reconstructed from what is actually in this database rather than
 * from a definition written out here, so it cannot drift from the columns
 * that have accumulated - with one exception: table_info does not report
 * collation, and username has to keep COLLATE NOCASE or two people could be
 * Keeko and keeko.
 */
function widenUsernames(): void {
  const done = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_handle'"
  ).get()
  if (done) return

  type Col = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }
  const cols = db.prepare('PRAGMA table_info(users)').all() as unknown as Col[]
  if (cols.length === 0) return

  const define = (c: Col): string => {
    const bits = [c.name, c.type || 'TEXT']
    if (c.name === 'username') bits.push('COLLATE NOCASE')
    if (c.pk) bits.push('PRIMARY KEY')
    if (c.notnull && !c.pk) bits.push('NOT NULL')
    if (c.dflt_value !== null) bits.push(`DEFAULT ${c.dflt_value}`)
    return bits.join(' ')
  }
  const names = cols.map((c) => c.name).join(', ')

  /* Put back however this leaves, on every path out. */
  const restore = (): void => {
    db.exec('PRAGMA legacy_alter_table = OFF')
    db.exec('PRAGMA foreign_keys = ON')
  }

  // Foreign keys must be off for the drop, and this pragma is ignored inside
  // a transaction - so it goes before BEGIN, not inside it.
  db.exec('PRAGMA foreign_keys = OFF')
  // The old rename behaviour, which leaves other tables' references alone
  // instead of helpfully rewriting them mid-swap.
  db.exec('PRAGMA legacy_alter_table = ON')
  try {
    db.exec('BEGIN')
    db.exec(`CREATE TABLE users_rebuild (\n  ${cols.map(define).join(',\n  ')}\n)`)
    db.exec(`INSERT INTO users_rebuild (${names}) SELECT ${names} FROM users`)
    db.exec('DROP TABLE users')
    db.exec('ALTER TABLE users_rebuild RENAME TO users')
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* nothing was open */ }
    restore()
    console.error('[db] could not widen usernames, left as they were:', err)
    throw err
  }

  /*
   * The index is built after the swap, and it can fail: it is unique over
   * (username, discriminator), so a database holding a duplicate pair throws
   * here. That throw used to happen between the catch above and the two
   * pragmas below, which meant leaving foreign keys OFF and the legacy rename
   * behaviour ON for whatever came next. Unreachable on any database that has
   * already migrated - this returns early when the index exists - but
   * "unreachable" is not a thing to leave load-bearing.
   */
  try {
    db.exec('CREATE UNIQUE INDEX idx_users_handle ON users(username COLLATE NOCASE, discriminator)')
    const broken = db.prepare('PRAGMA foreign_key_check').all() as unknown[]
    if (broken.length > 0) {
      console.error(`[db] WARNING: ${broken.length} dangling reference(s) after rebuilding users`)
    }
  } finally {
    restore()
  }
  console.log('[db] usernames widened - a name is now the name plus four digits')
}
widenUsernames()

/**
 * Move the old visibility list onto permission overrides.
 *
 * "Who can see this" was its own little system: a flag on the channel and an
 * allow list beside it, answering one question well and no other question at
 * all. Being able to see a channel is one of the things a permission says,
 * so it belongs with the rest of them rather than in a store of its own -
 * and while there were two stores for it, two screens could disagree about
 * whether a channel was private.
 *
 * Read as: nobody may view this, except the roles and people named. Which is
 * exactly what the old pair meant, written in the new one's words.
 *
 * A list that named @everyone is the exception. That was how the old dialog
 * said "private, but open to all after all" without throwing the list away,
 * so it writes no denial - putting one in would lock everybody out of a
 * channel that was open this morning.
 *
 * Idempotent, and it never touches a channel that already has a view rule:
 * once this has run the overrides are the truth, and it must not overwrite
 * an edit made since.
 */
function migrateChannelAccess(): void {
  let moved = 0
  const put = db.prepare(
    `INSERT OR IGNORE INTO permission_overrides
       (scope, target_id, kind, subject_id, permission, allow)
     VALUES ('channel', ?, ?, ?, 'view_channels', ?)`
  )
  const already = db.prepare(
    `SELECT 1 AS x FROM permission_overrides
      WHERE scope = 'channel' AND target_id = ? AND permission = 'view_channels' LIMIT 1`
  )
  const rows = db.prepare(
    "SELECT id, space_id FROM channels WHERE is_private = 1 AND kind IN ('text', 'voice')"
  ).all() as unknown as Array<{ id: string; space_id: string | null }>

  for (const channel of rows) {
    if (already.get(channel.id)) continue
    const everyone = everyoneRoleId(channel.space_id)
    if (!everyone) continue
    const named = db.prepare('SELECT kind, subject_id FROM channel_access WHERE channel_id = ?')
      .all(channel.id) as unknown as Array<{ kind: string; subject_id: string }>
    const openToAll = named.some((n) => n.kind === 'role' && n.subject_id === everyone)
    if (!openToAll) put.run(channel.id, 'role', everyone, 0)
    for (const n of named) {
      if (n.subject_id === everyone) continue
      put.run(channel.id, n.kind === 'member' ? 'member' : 'role', n.subject_id, 1)
    }
    moved++
  }
  if (moved) console.log(`[db] moved ${moved} private channels onto permission overrides`)
}
migrateChannelAccess()

/**
 * The Text and Voice headings, made real.
 *
 * A channel with no category was drawn under a heading the client invented —
 * "Text" or "Voice", worked out from its kind. That heading was not a row in
 * anything, so it could not be renamed, moved or removed, and it split rooms
 * by kind although a category has never been tied to one.
 *
 * So every server gets the two it was already being shown, as ordinary
 * categories, with its loose channels filed into them by the kind they were
 * already grouped under. Nothing looks different afterwards; the difference
 * is that all of it can now be changed.
 *
 * Only servers that have no categories at all. Anybody who has already made
 * their own has arranged this themselves, and arriving to find two new
 * headings would be this deciding something on their behalf.
 */
function migrateDefaultCategories(): void {
  const spaces = db.prepare(
    `SELECT s.id FROM spaces s
      WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.space_id = s.id)
        AND EXISTS (SELECT 1 FROM channels ch
                     WHERE ch.space_id = s.id AND ch.category_id IS NULL
                       AND ch.kind IN ('text', 'voice'))`
  ).all() as unknown as Array<{ id: string }>
  if (spaces.length === 0) return

  const makeCategory = db.prepare(
    `INSERT INTO categories (id, space_id, name, position, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const file = db.prepare(
    `UPDATE channels SET category_id = ?
      WHERE space_id = ? AND category_id IS NULL AND kind = ?`
  )
  const now = Date.now()
  let made = 0

  for (const space of spaces) {
    for (const [i, kind, heading] of [[0, 'text', 'Text'], [1, 'voice', 'Voice']] as const) {
      /* Only where there is something to put under it — a server with no
         voice rooms should not gain an empty Voice heading. */
      const any = db.prepare(
        `SELECT 1 AS x FROM channels
          WHERE space_id = ? AND category_id IS NULL AND kind = ? LIMIT 1`
      ).get(space.id, kind)
      if (!any) continue
      const id = randomUUID()
      makeCategory.run(id, space.id, heading, i, now)
      file.run(id, space.id, kind)
      made += 1
    }
  }
  if (made > 0) console.log(`[migrate] made ${made} headings real across ${spaces.length} servers`)
}

migrateDefaultCategories()

/**
 * Everybody may ask a question, on servers that existed before they could.
 *
 * create_polls is a new permission, so no @everyone role written before today
 * carries it — and permissions are read from the stored row, not from the
 * defaults, which are only consulted when there is no @everyone role at all.
 * Without this the whole feature ships invisible: the command is absent for
 * everybody, on every server, and nothing anywhere says why.
 *
 * Given rather than withheld because that is the default for a new server,
 * and a server owner who wants it withheld can withhold it. The reverse — a
 * feature nobody can find until somebody thinks to go and grant a permission
 * they have never heard of — is not a decision anybody made.
 *
 * Only where it is absent, so running twice changes nothing and a server that
 * has deliberately removed it later is not overruled on the next restart.
 */
function migrateEveryoneMayAsk(): void {
  const rows = db.prepare(
    "SELECT id, permissions FROM roles WHERE kind = 'everyone'"
  ).all() as unknown as Array<{ id: string; permissions: string }>

  const put = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let given = 0
  for (const role of rows) {
    let held: unknown
    try { held = JSON.parse(role.permissions) } catch { continue }
    if (!Array.isArray(held)) continue
    if (held.includes('create_polls')) continue
    /* Only where they may already speak: a role that cannot send a message
       has not been given the ability to ask a question by accident. */
    if (!held.includes('send_messages')) continue
    put.run(JSON.stringify([...held, 'create_polls']), role.id)
    given += 1
  }
  if (given > 0) console.log(`[migrate] everyone may ask a question on ${given} servers`)
}

migrateEveryoneMayAsk()

/*
 * Silencing somebody in a call, taken out of manage_messages.
 *
 * It was gated on manage_messages - "delete anybody's messages" - so every
 * role trusted to tidy a channel could also mute a person mid-sentence in a
 * voice room, and there was no way to grant one without the other. It has its
 * own permission now, which means every role that could do it this morning
 * would silently stop being able to.
 *
 * So the ability follows the role rather than the change: whoever held
 * manage_messages is given mute_members once, and anybody who does not want
 * the two together can now untick one - which is the whole point of splitting
 * them. Nobody loses something they had, and the coupling stops being
 * compulsory.
 *
 * Only where it is absent, so running twice changes nothing and a server that
 * removes it later is not overruled on the next restart.
 */
function migrateVoiceMuteIsItsOwn(): void {
  const rows = db.prepare('SELECT id, kind, permissions FROM roles')
    .all() as unknown as Array<{ id: string; kind: string; permissions: string }>

  const put = db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
  let given = 0
  for (const role of rows) {
    let held: unknown
    try { held = JSON.parse(role.permissions) } catch { continue }
    if (!Array.isArray(held)) continue
    if (held.includes('mute_members')) continue
    /* administrator already expands to everything, so writing it onto one of
       those would be noise rather than a grant. */
    if (held.includes('administrator')) continue
    /*
     * And not onto @everyone, which one server on this machine has given
     * manage_messages to.
     *
     * Nothing is lost by leaving it off. Moderating somebody needs rank as
     * well as permission, and outranks is strictly greater - so a member
     * whose only role is @everyone outranks no other member, and the ability
     * this would be preserving is one that could never be used. Whoever can
     * actually mute somebody today does it through a real role, and that
     * role is given it below.
     *
     * Writing it on anyway would tick "silence people in voice" for every
     * member of a server as a side effect of a refactor, which is not a
     * decision anybody made.
     */
    if (role.kind === 'everyone') continue
    if (!held.includes('manage_messages')) continue
    put.run(JSON.stringify([...held, 'mute_members']), role.id)
    given += 1
  }
  if (given > 0) console.log(`[migrate] silencing in voice is its own permission on ${given} roles`)
}

migrateVoiceMuteIsItsOwn()

/**
 * Carry the old account-wide nicknames into the servers they are shown in.
 *
 * A nickname used to be one column on the account, so there is no record of
 * which server set it - the route knew, and threw it away. Nothing can
 * recover that. What can be preserved is what people currently see: the name
 * is copied into every server that person is in, so nobody's name changes on
 * the day of the upgrade, and a moderator who wants it gone from their own
 * server can now clear it there without touching anybody else's.
 *
 * Writes only where there is no row yet, so a nickname set properly after
 * the upgrade is never overwritten by the old global one still in the
 * column.
 *
 * On this machine it moves nothing - no account had one - which is what
 * makes it safe to be this blunt.
 */
function migrateNicknamesArePerServer(): void {
  /* Gone from every query above, but still present on databases made before
     this, and absent from ones made after - where there is nothing to do. */
  const has = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>)
    .some((c) => c.name === 'nickname')
  if (!has) return

  const rows = db.prepare(
    `SELECT u.id AS user_id, u.nickname AS nickname, m.container_id AS space_id
       FROM users u
       JOIN container_members m ON m.user_id = u.id
       JOIN containers c ON c.id = m.container_id AND c.kind = 'space'
      WHERE u.nickname != ''`
  ).all() as unknown as Array<{ user_id: string; nickname: string; space_id: string }>

  const put = db.prepare(
    'INSERT OR IGNORE INTO member_nicknames (space_id, user_id, nickname) VALUES (?, ?, ?)'
  )
  let moved = 0
  for (const r of rows) moved += Number(put.run(r.space_id, r.user_id, r.nickname).changes)
  if (moved > 0) console.log(`[migrate] ${moved} nicknames are now per server`)
}

migrateNicknamesArePerServer()

/**
 * Everybody is a member. Say so on the rows as well as in the code.
 *
 * `role` held 'owner' for whoever claimed the install, and that account
 * opened the health page and handed out verified badges. Both are the
 * operator's business now, proved with a secret rather than by being a
 * particular account, so nothing reads this column anywhere.
 *
 * Leaving one row saying 'owner' would be harmless and would still be a lie
 * sitting in the database - the kind somebody finds in a year, believes, and
 * writes a query against. So it is normalised, and every account written
 * since says 'member' by itself.
 *
 * The column stays. Dropping one rebuilds the whole users table, which this
 * codebase has done before and has a comment about; a column every row
 * agrees on is not worth that. If the table is ever rebuilt for a reason
 * that pays for itself, this goes with it.
 */
export function migrateEverybodyIsAMember(): void {
  const done = db.prepare("UPDATE users SET role = 'member' WHERE role != 'member'").run()
  const n = Number(done.changes)
  if (n > 0) console.log(`[migrate] ${n} account(s) no longer hold a role outside a server`)
}

migrateEverybodyIsAMember()

/*
 * Who may attach which file.
 *
 * Sending a file is two steps: upload it, then name it in a message. The
 * second step took the path from the message and believed it - so a member
 * could attach ANY file already on this server to a message of their own,
 * including one somebody else had uploaded into a channel they cannot see.
 * The comment above that code claimed the ids were checked. They were not,
 * and could not be: nothing wrote down who had uploaded what.
 *
 * The worst of it was not reading somebody else's picture - you need the
 * path, and the names are random - it was deletion. removeAttachmentsOf
 * keeps a file that another message still points at, quite rightly, because
 * two messages can share an imported GIF. So attaching your file's path to a
 * message of mine meant your delete no longer deleted it: the row went, the
 * message went, and the picture carried on being served from mine.
 *
 * A row per person per file rather than per file, because a GIF imported
 * from a provider is stored by its contents - two people sending the same one
 * share a single file on disk, and both of them are entitled to it.
 *
 * Pruned with the file it describes, deliberately. This app deletes things
 * properly on purpose, and a record of who uploaded something outliving the
 * something would quietly undo that.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS uploads (
  name       TEXT NOT NULL,        -- the stored filename, never a path
  user_id    TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (name, user_id)
);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
`)

/**
 * Give the files already here the owner they never had.
 *
 * Without this, everything uploaded before today becomes unattachable by
 * anybody - so somebody re-sending a photo they posted last week would find
 * it quietly dropped. Every source below already records who it belongs to;
 * this is only reading it back out.
 *
 * Idempotent, and it never overwrites: INSERT OR IGNORE, and it runs against
 * whatever is still referenced rather than against the folder, because a file
 * nothing points at is on its way out anyway.
 */
function backfillUploads(): void {
  const put = db.prepare(
    `INSERT OR IGNORE INTO uploads (name, user_id, mime, bytes, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const nameOf = (p: unknown): string =>
    typeof p === 'string' ? (p.split('?')[0] ?? '').split('/').pop() ?? '' : ''

  let added = 0
  const add = (path: unknown, userId: unknown, mime: string, bytes: number, at: number): void => {
    const name = nameOf(path)
    if (!name || typeof userId !== 'string' || !userId) return
    added += Number(put.run(name, userId, mime, bytes, at).changes)
  }

  // An attachment belongs to whoever wrote the message carrying it.
  for (const r of db.prepare(
    `SELECT a.path, a.mime, a.bytes, m.author_id, m.created_at
       FROM attachments a JOIN messages m ON m.id = a.message_id`
  ).all() as unknown as Array<{
    path: string; mime: string; bytes: number; author_id: string; created_at: number
  }>) {
    add(r.path, r.author_id, r.mime ?? '', r.bytes ?? 0, r.created_at ?? Date.now())
  }

  /*
   * A picture on a profile belongs to that profile, and a server's icon to
   * whoever owns the server.
   *
   * These carry no size or type anywhere - the columns hold a path and
   * nothing else - so both are read off the file itself. A row saying zero
   * bytes would be a row that lies to the storage page the first time one of
   * these is re-sent.
   */
  const onDisk = (path: unknown): { mime: string; bytes: number } => {
    const name = nameOf(path)
    if (!name) return { mime: '', bytes: 0 }
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
    const mime = ({
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif',
    } as Record<string, string>)[ext] ?? ''
    try {
      return { mime, bytes: statSync(resolve(config.uploadDir, name)).size }
    } catch {
      // Already swept. The row is still worth having: nothing can be
      // attached from it either way, and the sweep will clear it.
      return { mime, bytes: 0 }
    }
  }

  for (const r of db.prepare('SELECT id, avatar_path, banner_path, created_at FROM users')
    .all() as unknown as Array<{
      id: string; avatar_path: string | null; banner_path: string | null; created_at: number
    }>) {
    for (const path of [r.avatar_path, r.banner_path]) {
      const { mime, bytes } = onDisk(path)
      add(path, r.id, mime, bytes, r.created_at ?? Date.now())
    }
  }

  for (const r of db.prepare('SELECT icon_path, owner_id, created_at FROM spaces')
    .all() as unknown as Array<{
      icon_path: string | null; owner_id: string | null; created_at: number
    }>) {
    const { mime, bytes } = onDisk(r.icon_path)
    add(r.icon_path, r.owner_id, mime, bytes, r.created_at ?? Date.now())
  }

  if (added > 0) console.log(`[db] recorded who uploaded ${added} existing file(s)`)
}
backfillUploads()

/**
 * Write down that this person uploaded this file.
 *
 * And make the second copy here rather than at each upload route, because
 * this is the one place every stored file passes through - three routes call
 * it today and the fourth one written will get the copy for free. It returns
 * at once and cannot throw; see offsite.ts for why that is safe.
 */
export function rememberUpload(
  name: string, userId: string, mime: string, bytes: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO uploads (name, user_id, mime, bytes, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(name, userId, mime, bytes, Date.now())
  copyOffsite(name)
}

/**
 * What this person is entitled to attach, by stored name.
 *
 * Null when they are not - which is both "somebody else uploaded it" and
 * "no such file was ever uploaded here", deliberately answered the same way.
 */
export function uploadClaim(
  name: string, userId: string,
): { mime: string; bytes: number } | null {
  const row = db.prepare('SELECT mime, bytes FROM uploads WHERE name = ? AND user_id = ?')
    .get(name, userId) as unknown as { mime: string; bytes: number } | undefined
  return row ?? null
}

/** Forget a file entirely, for every person who could attach it. */
export function forgetUpload(name: string): void {
  if (!name) return
  db.prepare('DELETE FROM uploads WHERE name = ?').run(name)
}

/**
 * Every override belonging to a channel or a category, for when it goes.
 *
 * The target column is polymorphic, so no foreign key can do this. Both
 * delete routes call it; a channel deleted without it leaves rows that a
 * later channel could inherit by being handed the same id.
 */
export function forgetOverrides(scope: 'channel' | 'category', targetId: string): void {
  db.prepare('DELETE FROM permission_overrides WHERE scope = ? AND target_id = ?')
    .run(scope, targetId)
}

/**
 * Every rule written about one role or one person, for when they go.
 *
 * A rule naming a role that no longer exists is inert - nobody holds it, so
 * nothing matches - but it is not harmless. It is listed by accessFor, so the
 * panel drew a row saying "a deleted role", and the settings pane offered it
 * as somebody a private channel is open to. Rows about a deleted role also
 * accumulate for ever, in a table whose whole point is that it only holds the
 * exceptions.
 */
export function forgetSubjectOverrides(kind: 'role' | 'member', subjectId: string): void {
  db.prepare('DELETE FROM permission_overrides WHERE kind = ? AND subject_id = ?')
    .run(kind, subjectId)
}

/** A free set of four digits for this name, or null if they are all taken. */
export function freeDiscriminator(username: string): string | null {
  const taken = new Set(
    (db.prepare('SELECT discriminator FROM users WHERE username = ? COLLATE NOCASE')
      .all(username) as Array<{ discriminator: string }>).map((r) => r.discriminator)
  )
  // Random rather than the next free number, so a name does not advertise how
  // many people have taken it and nobody is stuck with #0002 for ever.
  for (let tries = 0; tries < 200; tries += 1) {
    const candidate = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    if (!taken.has(candidate)) return candidate
  }
  for (let n = 1; n < 10000; n += 1) {
    const candidate = String(n).padStart(4, '0')
    if (!taken.has(candidate)) return candidate
  }
  return null
}

/**
 * The people somebody has any business being shown.
 *
 * Three ways: you are in a server together, you are friends, or you are in a
 * conversation together. Anybody else is a stranger who happens to have an
 * account on the same machine.
 *
 * One definition, used everywhere a member list or a member update goes out.
 * It was written twice before this - once for the HTTP route and not at all
 * for the gateway, which is the one the client actually reads - so scoping
 * the route changed nothing anybody could see.
 */
const VISIBLE_TO = `(
  u.id = ?
  OR EXISTS (
    SELECT 1 FROM container_members mine
      JOIN container_members theirs ON theirs.container_id = mine.container_id
     WHERE mine.user_id = ? AND theirs.user_id = u.id
  )
  OR EXISTS (
    SELECT 1 FROM friendships f
     WHERE (f.low = ? AND f.high = u.id) OR (f.high = ? AND f.low = u.id)
  )
)`

export function visibleMembers(userId: string): unknown[] {
  return db.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users u
      WHERE ${ACTIVE_USERS.replace(/removed_at/g, 'u.removed_at')} AND ${VISIBLE_TO}
      ORDER BY u.display_name COLLATE NOCASE`
  ).all(userId, userId, userId, userId)
}

/**
 * Everybody on the far side of that rule, as a set.
 *
 * The relation is symmetric - sharing a server, being friends and being in a
 * conversation all go both ways - so this is both "who may see this person"
 * and "who this person may see", and one query answers either.
 *
 * It exists because the alternative is a query per candidate. Presence and
 * activity both walked every connected client asking canSeeMember about each
 * one, which is fine at eleven people and is N queries per connect at any
 * size worth having. Asking once and testing against a set is the same answer
 * for one round trip.
 */
export function visibleWith(userId: string): Set<string> {
  const rows = db.prepare(
    `SELECT u.id FROM users u
      WHERE ${ACTIVE_USERS.replace(/removed_at/g, 'u.removed_at')} AND ${VISIBLE_TO}`
  ).all(userId, userId, userId, userId) as unknown as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

/**
 * The people somebody needs before they have opened anything.
 *
 * Themselves, their friends, and everybody in their conversations. Bounded by
 * how many people they actually talk to, rather than by the size of every
 * server they happen to be in.
 *
 * visibleMembers - the whole directory - used to go out with `ready`, and it
 * is the term that multiplies: fifty servers of ten thousand people is half a
 * million rows computed per connection, before the app has drawn anything.
 * The rest arrive a server at a time, from /api/spaces/:id/members, as each
 * one is opened.
 *
 * A server's people are not needed to draw its channel list, and a message
 * cannot arrive from somebody outside a server this account is in - so there
 * is nobody who can appear on screen before the request that names them.
 */
/**
 * Write down a server mute or deafen, so a restart does not undo it.
 *
 * The table is keyed by the pair, because a mute belongs to one server: the
 * same person can be silenced in one and untouched in another.
 *
 * This lived in the gateway and named neither the space nor the right
 * conflict target - it inserted `(user_id, muted, deafened, implied)` into a
 * table whose space_id is NOT NULL, and conflicted on `user_id`, which is not
 * a key. So it threw on every call, every mute and deafen went unwritten, and
 * because the throw came before the rest of the handler nobody was ever told
 * to re-mint their token - which is where the grant actually lives. The mute
 * was recorded in memory, shown in the member list, and never applied.
 */
export function rememberVoiceModeration(
  spaceId: string,
  userId: string,
  state: { muted: boolean; deafened: boolean; implied: boolean },
): void {
  if (!state.muted && !state.deafened) {
    db.prepare('DELETE FROM voice_moderation WHERE space_id = ? AND user_id = ?')
      .run(spaceId, userId)
    return
  }
  db.prepare(`
    INSERT INTO voice_moderation (space_id, user_id, muted, deafened, implied)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(space_id, user_id) DO UPDATE SET
      muted = excluded.muted, deafened = excluded.deafened, implied = excluded.implied
  `).run(spaceId, userId, +state.muted, +state.deafened, +state.implied)
}

export function startingMembers(userId: string): unknown[] {
  return db.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users u
      WHERE ${ACTIVE_USERS.replace(/removed_at/g, 'u.removed_at')}
        AND (
          u.id = ?
          OR EXISTS (
            SELECT 1 FROM friendships f
             WHERE (f.low = ? AND f.high = u.id) OR (f.high = ? AND f.low = u.id)
          )
          OR EXISTS (
            SELECT 1 FROM container_members mine
              JOIN container_members theirs ON theirs.container_id = mine.container_id
              JOIN containers k ON k.id = mine.container_id AND k.kind IN ('dm','group')
             WHERE mine.user_id = ? AND theirs.user_id = u.id
          )
        )
      ORDER BY u.display_name COLLATE NOCASE`
  ).all(userId, userId, userId, userId)
}

/**
 * Everybody in one server, as whole records.
 *
 * The directory arrives a server at a time now, so this is what fills it: the
 * route the client calls when it opens a server, and the push somebody gets
 * the moment they join one. Written once because those two have to agree -
 * a person who is in the list on join and missing on open, or the reverse,
 * is a name that appears and then does not.
 */
export function membersOfSpace(spaceId: string): unknown[] {
  return db.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users u
       JOIN container_members m ON m.user_id = u.id
       LEFT JOIN member_nicknames n ON n.space_id = m.container_id AND n.user_id = u.id
      WHERE m.container_id = ? AND u.removed_at IS NULL
      ORDER BY COALESCE(NULLIF(n.nickname, ''), u.display_name) COLLATE NOCASE`
  ).all(spaceId)
}

/* --------------------------------------------------- nicknames, per server -- */

/**
 * What people are called in one server, by id.
 *
 * A map rather than a column on each record, because a nickname is a fact
 * about a pair and the records are shared: the same person's row is in the
 * directory once and drawn in every server they are in. Hanging the
 * nickname off it is what made one name follow somebody everywhere, and
 * putting it back on a per-space copy of the row would do it again the
 * moment two copies met.
 *
 * Only the ones that are set. A server where nobody has been renamed sends
 * nothing at all, which is almost all of them.
 */
export function nicknamesIn(spaceId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of db.prepare(
    "SELECT user_id, nickname FROM member_nicknames WHERE space_id = ? AND nickname != ''"
  ).all(spaceId) as Array<{ user_id: string; nickname: string }>) {
    out[r.user_id] = r.nickname
  }
  return out
}

/** What one person is called there, or '' for their own name. */
export function nicknameIn(spaceId: string, userId: string): string {
  const row = db.prepare(
    'SELECT nickname FROM member_nicknames WHERE space_id = ? AND user_id = ?'
  ).get(spaceId, userId) as { nickname: string } | undefined
  return row?.nickname ?? ''
}

/**
 * Set it, or clear it.
 *
 * Blank deletes the row rather than storing an empty string: "no nickname"
 * and "a nickname that is blank" read identically to everybody and would
 * read differently to every query. Returns what it settled on, so the
 * caller can announce the same value it stored.
 */
export function setNicknameIn(spaceId: string, userId: string, name: string): string {
  const clean = name.trim().slice(0, 32)
  if (!clean) {
    db.prepare('DELETE FROM member_nicknames WHERE space_id = ? AND user_id = ?')
      .run(spaceId, userId)
    return ''
  }
  db.prepare(
    'INSERT OR REPLACE INTO member_nicknames (space_id, user_id, nickname) VALUES (?, ?, ?)'
  ).run(spaceId, userId, clean)
  return clean
}

/** Whether one person may be shown the other at all. */
export function canSeeMember(viewerId: string, targetId: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM users u WHERE u.id = ? AND ${VISIBLE_TO}`)
      .get(targetId, viewerId, viewerId, viewerId, viewerId)
  )
}

/* ------------------------------------------------------------- friends -- */

/** The pair in the fixed order the table stores them in. */
function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export function areFriends(a: string, b: string): boolean {
  const [low, high] = pair(a, b)
  return Boolean(
    db.prepare('SELECT 1 FROM friendships WHERE low = ? AND high = ?').get(low, high)
  )
}

/** Become friends, and clear any request either way round. */
export function addFriend(a: string, b: string): void {
  if (a === b) return
  const [low, high] = pair(a, b)
  db.prepare('INSERT OR IGNORE INTO friendships (low, high, created_at) VALUES (?, ?, ?)')
    .run(low, high, Date.now())
  // Both directions: two people can ask each other at the same time, and
  // leaving the other request behind would show a pending ask between people
  // who are already friends.
  db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
    .run(a, b, b, a)
}

export function removeFriend(a: string, b: string): void {
  const [low, high] = pair(a, b)
  db.prepare('DELETE FROM friendships WHERE low = ? AND high = ?').run(low, high)
}

/* --------------------------------------------------------------- blocks -- */

/**
 * Whether either of these two has blocked the other.
 *
 * Both directions, always, and that is the whole design of it. A block is
 * one person's decision about their own attention, but the thing being
 * stopped is a channel between two people - and a channel is not one-way. If
 * only the blocker's direction were checked, blocking somebody would stop
 * you writing to them and leave them writing to you, which is the opposite
 * of what the button says.
 *
 * One indexed lookup, on the paths where one person reaches another: opening
 * a conversation, sending into one, ringing, and asking to be friends.
 */
export function blockedBetween(a: string, b: string): boolean {
  return Boolean(db.prepare(
    `SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
      LIMIT 1`
  ).get(a, b, b, a))
}

/** Whether this particular person did the blocking. For "unblock" to exist. */
export function hasBlocked(blocker: string, blocked: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .get(blocker, blocked)
  )
}

/**
 * Block somebody, and undo the standing they had.
 *
 * A friendship is a mutual agreement to be reachable, and blocking somebody
 * is withdrawing it - so it goes, along with any request either way. Leaving
 * it would put the person on the friends list, un-writeable-to, which reads
 * as a bug rather than as a decision.
 *
 * The conversation itself stays. What was said was said, and deleting
 * somebody's history because they fell out is not this button's business -
 * hiding it is the client's job, and only for as long as the block stands.
 */
export function blockUser(blocker: string, blocked: string): void {
  if (blocker === blocked) return
  db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)')
    .run(blocker, blocked, Date.now())
  removeFriend(blocker, blocked)
  db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
    .run(blocker, blocked, blocked, blocker)
}

/**
 * Lift one. It does not restore the friendship - that was ended, and
 * quietly putting it back would be a decision neither of them made.
 */
export function unblockUser(blocker: string, blocked: string): boolean {
  const done = db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
    .run(blocker, blocked)
  return Number(done.changes) > 0
}

/**
 * Who this person has blocked.
 *
 * Only their own list, and only the direction they decided. Being told who
 * has blocked YOU is not something any app should answer: it is somebody
 * else's private decision about their own attention, and it is the one
 * thing about a block that would make it worth arguing over.
 */
export function blockedBy(userId: string): string[] {
  return (db.prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?')
    .all(userId) as Array<{ blocked_id: string }>).map((r) => r.blocked_id)
}

/** Everybody this person is friends with. */
export function friendsOf(userId: string): string[] {
  const rows = db.prepare(
    'SELECT low, high FROM friendships WHERE low = ? OR high = ?'
  ).all(userId, userId) as Array<{ low: string; high: string }>
  return rows.map((r) => (r.low === userId ? r.high : r.low))
}

/**
 * A date far enough off that it will not arrive.
 *
 * "Until I turn it back on" as an ordinary timestamp, so every check stays
 * `muted_until > now` and there is no second flag to keep in step.
 */
export const MUTED_INDEFINITELY = Date.UTC(9999, 0, 1)

export type ChannelPref = {
  channelId: string
  level: 'default' | 'all' | 'mentions' | 'nothing'
  /** When the mute lapses, or null when the channel is not muted. */
  mutedUntil: number | null
}

/** Everything this person has said about individual channels. */
export function channelPrefsFor(userId: string): ChannelPref[] {
  const rows = db.prepare(
    `SELECT channel_id, level, muted_until FROM channel_prefs
      WHERE user_id = ?
        AND (level != 'default' OR (muted_until IS NOT NULL AND muted_until > ?))`
  ).all(userId, Date.now()) as Array<{
    channel_id: string; level: string; muted_until: number | null
  }>

  return rows.map((r) => ({
    channelId: r.channel_id,
    level: (['all', 'mentions', 'nothing'].includes(r.level) ? r.level : 'default') as ChannelPref['level'],
    mutedUntil: r.muted_until,
  }))
}

/**
 * Set what to be told about a channel.
 *
 * Both parts are optional and only what is given changes: the bell menu sets
 * a level without touching a running mute, and the mute submenu sets a mute
 * without resetting the level back to default.
 */
export function setChannelPref(
  userId: string,
  channelId: string,
  patch: { level?: ChannelPref['level']; mutedUntil?: number | null },
): ChannelPref {
  const now = Date.now()
  db.prepare(
    `INSERT INTO channel_prefs (user_id, channel_id, level, muted_until)
     VALUES (?, ?, 'default', NULL)
     ON CONFLICT (user_id, channel_id) DO NOTHING`
  ).run(userId, channelId)

  if (patch.level !== undefined) {
    db.prepare('UPDATE channel_prefs SET level = ? WHERE user_id = ? AND channel_id = ?')
      .run(patch.level, userId, channelId)
  }
  if (patch.mutedUntil !== undefined) {
    db.prepare('UPDATE channel_prefs SET muted_until = ? WHERE user_id = ? AND channel_id = ?')
      .run(patch.mutedUntil, userId, channelId)
  }

  const row = db.prepare(
    'SELECT channel_id, level, muted_until FROM channel_prefs WHERE user_id = ? AND channel_id = ?'
  ).get(userId, channelId) as { channel_id: string; level: string; muted_until: number | null }

  return {
    channelId: row.channel_id,
    level: row.level as ChannelPref['level'],
    // A mute that has already lapsed is not a mute, and saying so here keeps
    // every caller from having to compare against the clock itself.
    mutedUntil: row.muted_until && row.muted_until > now ? row.muted_until : null,
  }
}

/** Put somebody in a space. Idempotent, so joining twice is not an error. */
/* The server is named by whoever is joining somebody to it. It used to
   default to the first one, which was right for the single caller that meant
   that and silently wrong for anyone who forgot an argument. */
export function joinSpace(userId: string, spaceId: string | null): void {
  const id = spaceId
  if (!id) return
  /*
   * Refused here as well as at the route that asks.
   *
   * Every way into a server ends at this function, and a check written at
   * one of the callers is a check the next caller will not have. That is the
   * trap this codebase has fallen into twice already - member visibility
   * written for the route and not the gateway, an invite validated on
   * registration and not on redemption - so the rule lives where joining
   * actually happens. The routes still answer properly; this is what makes
   * the answer true.
   */
  if (isBanned(userId, id)) return
  joinContainer(userId, id)
}

/**
 * Everything a membership carried, cleared when it ends.
 *
 * Four tables, and they were being cleared in two places that each knew
 * about a different subset - removal knew roles and server-wide grants,
 * leaving knew the same two, and neither knew about a private channel's
 * list or a per-channel override made for one person. So being let back in
 * silently restored the private channel somebody had specifically been
 * added to.
 *
 * The argument for all four is the one already written above the roles:
 * letting somebody back in should not restore what whoever removed them had
 * just taken away. Written once so the next thing that has to be cleared is
 * cleared for every way of leaving at the same time.
 *
 * Scoped to the one server throughout. The subject is an account, and the
 * same account may hold roles, grants and named access in servers that have
 * nothing to do with this one.
 */
export function forgetMemberIn(spaceId: string, userId: string): void {
  db.prepare(
    'DELETE FROM member_roles WHERE user_id = ? AND role_id IN (SELECT id FROM roles WHERE space_id = ?)'
  ).run(userId, spaceId)
  db.prepare('DELETE FROM member_permissions WHERE space_id = ? AND user_id = ?')
    .run(spaceId, userId)
  db.prepare(
    `DELETE FROM channel_access
      WHERE kind = 'member' AND subject_id = ?
        AND channel_id IN (SELECT id FROM channels WHERE space_id = ?)`
  ).run(userId, spaceId)
  db.prepare(
    `DELETE FROM permission_overrides
      WHERE kind = 'member' AND subject_id = ?
        AND ((scope = 'channel'
              AND target_id IN (SELECT id FROM channels WHERE space_id = ?))
          OR (scope = 'category'
              AND target_id IN (SELECT id FROM categories WHERE space_id = ?)))`
  ).run(userId, spaceId, spaceId)
}

/* ------------------------------------------------------------------ bans -- */

/**
 * Whether this person is barred from this server.
 *
 * One row per pair, so this is an existence check and nothing more. Called
 * on every join and on every invite that is looked at, which is rare enough
 * that the index on space_id - the primary key - is the whole of the
 * performance story.
 */
export function isBanned(userId: string, spaceId: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM bans WHERE space_id = ? AND user_id = ?').get(spaceId, userId)
  )
}

/**
 * Bar somebody, whether or not they are currently in.
 *
 * Banning an account that already left is the ordinary case rather than an
 * edge one: somebody walks out after an argument and the decision is made
 * afterwards. So this writes the row regardless, and taking them out of the
 * server is the caller's separate job.
 *
 * REPLACE rather than IGNORE so banning somebody already banned updates the
 * reason and the name against it instead of silently doing nothing.
 */
/**
 * When somebody's timeout ends, or 0 if they are not in one.
 *
 * Asked against the clock rather than swept, so a timeout that has run out
 * needs nothing to have happened for it to be over. The row is left where it
 * is - it costs nothing, and it is the only record of what was done.
 */
export function timedOutUntil(spaceId: string, userId: string): number {
  const row = db.prepare(
    'SELECT until FROM timeouts WHERE space_id = ? AND user_id = ?'
  ).get(spaceId, userId) as { until?: number } | undefined
  const until = row?.until ?? 0
  return until > Date.now() ? until : 0
}

/** Stop somebody talking here until a moment. */
export function timeOutIn(
  spaceId: string, userId: string, until: number, by: string, reason: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO timeouts (space_id, user_id, until, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(spaceId, userId, until, reason.slice(0, 500), by, Date.now())
}

/** Let them talk again. Returns whether there was anything to lift. */
export function liftTimeout(spaceId: string, userId: string): boolean {
  const row = db.prepare(
    'DELETE FROM timeouts WHERE space_id = ? AND user_id = ? RETURNING user_id'
  ).get(spaceId, userId)
  return !!row
}

/** Everybody currently stopped from talking in a server. */
export function timeoutsOf(spaceId: string): Array<{ user_id: string; until: number; reason: string }> {
  return db.prepare(
    `SELECT user_id, until, reason FROM timeouts
      WHERE space_id = ? AND until > ? ORDER BY until DESC`
  ).all(spaceId, Date.now()) as Array<{ user_id: string; until: number; reason: string }>
}

export function banFromSpace(
  spaceId: string, userId: string, by: string, reason: string,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO bans (space_id, user_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(spaceId, userId, reason.slice(0, 500), by, Date.now())
}

/** Lift one. Returns whether there was one to lift, so the route can 404. */
export function liftBan(spaceId: string, userId: string): boolean {
  const done = db.prepare('DELETE FROM bans WHERE space_id = ? AND user_id = ?')
    .run(spaceId, userId)
  return Number(done.changes) > 0
}

/**
 * Who is barred from this server, newest first.
 *
 * Joined to users so the list can show a person rather than an id - and left
 * joined, because a ban survives the account being removed and a row that
 * cannot name anybody is still a row somebody may want to lift.
 */
export function bansOf(spaceId: string): Array<Record<string, unknown>> {
  return db.prepare(
    `SELECT b.user_id AS id, b.reason, b.created_by, b.created_at,
            u.username, u.display_name, u.avatar_path, u.discriminator
       FROM bans b LEFT JOIN users u ON u.id = b.user_id
      WHERE b.space_id = ?
      ORDER BY b.created_at DESC`
  ).all(spaceId) as unknown as Array<Record<string, unknown>>
}

// Serving a file now asks whether it is an attachment, on every request.
db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_path ON attachments(path)')

/*
 * And the same for a thumbnail, because deleting one asks about both.
 *
 * Removing a picture asks whether any other message still points at the file
 * before it takes it off the disk, and that question now covers thumb_path
 * too - the same bytes can be a picture in one message and a thumbnail in
 * another. With only `path` indexed, the OR could not use an index at all
 * and became a scan of every attachment.
 *
 * Measured on a hundred thousand attachments, asking the common question -
 * nobody else is using it, which is a miss and so reads the whole table:
 * 9.2ms a file against 43us with this. Deleting one message carrying four
 * pictures went from 0.35ms to 73ms, and the sweep does that for every
 * deleted message in a row, on the thread everything else is waiting on.
 */
db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_thumb ON attachments(thumb_path)')

/**
 * Server mutes and deafens, which used to live only in memory.
 *
 * Every restart silently lifted every one of them - and a restart happens
 * for an update, a crash, or the watchdog noticing the port is quiet, none
 * of which is a decision to unmute somebody. `implied` marks a mute that
 * came with a deafen rather than on its own, so lifting the deafen lifts
 * only what it added.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS voice_moderation (
    space_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    muted     INTEGER NOT NULL DEFAULT 0,
    deafened  INTEGER NOT NULL DEFAULT 0,
    implied   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (space_id, user_id)
  )
`)


export type User = {
  id: string
  username: string
  /** Four digits, or empty for an account that holds the bare name. */
  discriminator: string
  /** Shows a badge, and is the owner's to grant. */
  verified: number
  display_name: string
  /* No nickname. It is what one SERVER calls somebody and lives in
     member_nicknames - see nicknamesIn. Declaring it here while
     PUBLIC_USER_COLUMNS no longer selects it is a field that typechecks
     everywhere and is undefined at runtime, which is worse than not having
     it. */
  bio: string
  accent: string
  name_font: string
  name_effect: string
  accent_2: string
  avatar_path: string | null
  banner_path: string | null
  /* No role. Every account is a member; there is no kind of account that
     means anything outside a server, and the column that used to say so is
     read by nothing. See isOperator in auth.ts for the two routes that are
     about the hardware. */
  status_text: string
  /** When the status stops being shown. 0 is "no timer on it". */
  status_until: number
  presence: string
  created_at: number
}

export type MessageRow = {
  id: string
  channel_id: string
  author_id: string
  body: string
  reply_to: string | null
  created_at: number
  edited_at: number | null
}

/** What the client is allowed to see about a user. Never leak pass_hash. */
export const PUBLIC_USER_COLUMNS =
  'id, username, discriminator, verified, display_name, bio, accent, accent_2, name_font, name_effect, avatar_path, banner_path, status_text, status_until, presence, created_at'

/** Members who are still part of the space. */
export const ACTIVE_USERS = 'removed_at IS NULL'

/**
 * Attach reactions and attachments to a set of message rows.
 *
 * Done as two queries for the whole batch rather than two per message, so
 * opening a channel is 3 queries total instead of 120.
 */
export function hydrate(rows: MessageRow[], viewerId: string): unknown[] {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const holes = ids.map(() => '?').join(',')

  const reactions = db
    .prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${holes})`)
    .all(...ids) as unknown as Array<{ message_id: string; emoji: string; user_id: string }>

  const files = (db
    .prepare(
      `SELECT id, message_id, filename, mime, bytes, width, height, path, is_gif,
              thumb_path
         FROM attachments WHERE message_id IN (${holes})`
    )
    .all(...ids) as unknown as Array<Record<string, unknown>>)
    // Signed on the way out, never in the table. What is stored stays a
    // plain path, so the sweeper and everything else still recognise it.
    .map((f) => ({
      ...f,
      path: signPath(String(f.path)),
      /* The small copy is signed the same way, and stays absent rather than
         becoming an empty string - the reader decides on presence. */
      thumb_path: f.thumb_path ? signPath(String(f.thumb_path)) : null,
    })) as Array<Record<string, unknown>>

  const byMessage = new Map<string, Map<string, { emoji: string; count: number; me: boolean }>>()
  for (const r of reactions) {
    let group = byMessage.get(r.message_id)
    if (!group) byMessage.set(r.message_id, (group = new Map()))
    const entry = group.get(r.emoji) ?? { emoji: r.emoji, count: 0, me: false }
    entry.count += 1
    if (r.user_id === viewerId) entry.me = true
    group.set(r.emoji, entry)
  }

  const filesByMessage = new Map<string, Array<Record<string, unknown>>>()
  for (const f of files) {
    const key = String(f.message_id)
    const list = filesByMessage.get(key) ?? []
    list.push(f)
    filesByMessage.set(key, list)
  }

  const polls = pollsFor(ids, viewerId)

  return rows.map((row) => ({
    ...row,
    reactions: [...(byMessage.get(row.id)?.values() ?? [])],
    attachments: filesByMessage.get(row.id) ?? [],
    ...(polls.get(row.id) ? { poll: polls.get(row.id) } : {}),
  }))
}

/**
 * The polls among a batch of messages, counted.
 *
 * Three queries for the whole batch rather than three per message. The counts
 * are worked out here rather than kept on the row, because a stored count and
 * a votes table are two answers to one question and they drift.
 *
 * The numbers go to everybody, whether or not they have answered. Hiding them
 * until somebody votes turns a question into a toll gate: everybody who only
 * wanted the answer votes for anything to get past it, which makes the number
 * they were curious about wrong.
 */
export function pollsFor(ids: string[], viewerId: string): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (ids.length === 0) return out
  const holes = ids.map(() => '?').join(',')

  const rows = db.prepare(
    `SELECT message_id, question, multi, closes_at FROM polls WHERE message_id IN (${holes})`
  ).all(...ids) as unknown as Array<{
    message_id: string; question: string; multi: number; closes_at: number | null
  }>
  if (rows.length === 0) return out

  const mine = rows.map((r) => r.message_id)
  const someHoles = mine.map(() => '?').join(',')

  const options = db.prepare(
    `SELECT message_id, idx, text FROM poll_options
      WHERE message_id IN (${someHoles}) ORDER BY idx`
  ).all(...mine) as unknown as Array<{ message_id: string; idx: number; text: string }>

  const votes = db.prepare(
    `SELECT message_id, idx, user_id FROM poll_votes WHERE message_id IN (${someHoles})`
  ).all(...mine) as unknown as Array<{ message_id: string; idx: number; user_id: string }>

  const tally = new Map<string, Map<number, number>>()
  const chose = new Map<string, Set<number>>()
  /* Counted separately from the votes: with several answers allowed, the
     votes add up to more than the number of people who answered, and it is
     the people that "12 people have answered" is about. */
  const answered = new Map<string, Set<string>>()
  for (const v of votes) {
    const per = tally.get(v.message_id) ?? new Map<number, number>()
    per.set(v.idx, (per.get(v.idx) ?? 0) + 1)
    tally.set(v.message_id, per)
    const who = answered.get(v.message_id) ?? new Set<string>()
    who.add(v.user_id)
    answered.set(v.message_id, who)
    if (v.user_id === viewerId) {
      const mine = chose.get(v.message_id) ?? new Set<number>()
      mine.add(v.idx)
      chose.set(v.message_id, mine)
    }
  }

  const now = Date.now()
  for (const poll of rows) {
    const per = tally.get(poll.message_id) ?? new Map<number, number>()
    const voters = answered.get(poll.message_id)?.size ?? 0
    /* The share is of the votes cast, not of the people: with several answers
       allowed those are different numbers, and a bar filling past the end of
       its track is what using the wrong one looks like. */
    const cast = [...per.values()].reduce((a, b) => a + b, 0)
    const opts = options
      .filter((o) => o.message_id === poll.message_id)
      .map((o) => {
        const n = per.get(o.idx) ?? 0
        return {
          idx: o.idx,
          text: o.text,
          votes: n,
          /* Rounded here so every client shows the same number. Worked out
             per client they disagree by a percent, which looks like a bug. */
          share: cast ? Math.round((n / cast) * 100) : 0,
          mine: chose.get(poll.message_id)?.has(o.idx) ?? false,
        }
      })
    out.set(poll.message_id, {
      question: poll.question,
      multi: poll.multi === 1,
      closesAt: poll.closes_at,
      /* Closed is a fact about the clock, not a flag somebody sets: a poll
         whose time has passed is closed everywhere at once without anything
         having to go round and mark it. */
      closed: poll.closes_at !== null && poll.closes_at <= now,
      options: opts,
      voters,
    })
  }
  return out
}

/**
 * One message, hydrated once, ready to be sent to many people.
 *
 * Almost nothing about a message differs by who is reading it. The row is the
 * row, and the attachment links are signed the same for everybody - the only
 * per-viewer thing in the whole shape is whether each reaction is one of
 * yours.
 *
 * pushRow used to call hydrateOne once per recipient, which is two queries
 * each: a message in a ten thousand member channel was twenty thousand
 * queries to produce ten thousand objects differing in one boolean per emoji,
 * and for a message that has just been sent there are no reactions at all, so
 * they were identical.
 *
 * So it is built once, with the reactors kept alongside, and personalised
 * afterwards by `forViewer` - which touches nothing but the flags.
 */
export type SharedMessage = {
  message: Record<string, unknown>
  /** Who reacted with what, so `me` can be answered without asking again. */
  reactors: Map<string, Set<string>>
  /** And who answered a poll with what, for the same reason. */
  chose: Map<string, Set<number>>
}

export function hydrateShared(id: string): SharedMessage | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL')
    .get(id) as unknown as MessageRow | undefined
  if (!row) return null

  // No viewer, so every `me` comes back false and none of them is a lie about
  // anybody in particular - forViewer is what makes them true.
  const message = hydrate([row], '')[0] as Record<string, unknown>

  const reactors = new Map<string, Set<string>>()
  for (const r of db
    .prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?')
    .all(id) as unknown as Array<{ emoji: string; user_id: string }>) {
    const who = reactors.get(r.emoji) ?? new Set<string>()
    who.add(r.user_id)
    reactors.set(r.emoji, who)
  }
  /* Who answered what, kept alongside for the same reason the reactors are:
     the only part of a poll that differs by who is reading it is which option
     is theirs, and asking again per recipient is a query per person. */
  const chose = new Map<string, Set<number>>()
  if (message.poll) {
    for (const v of db
      .prepare('SELECT user_id, idx FROM poll_votes WHERE message_id = ?')
      .all(id) as unknown as Array<{ user_id: string; idx: number }>) {
      const mine = chose.get(v.user_id) ?? new Set<number>()
      mine.add(v.idx)
      chose.set(v.user_id, mine)
    }
  }

  return { message, reactors, chose }
}

/**
 * The same message as one person sees it.
 *
 * A shallow copy: the arrays inside are shared on purpose, because nothing
 * mutates them and copying an attachment list per recipient would give back
 * the allocation this exists to avoid. Only the reactions are rebuilt, and
 * only when there are any - which for a message that has just been sent is
 * never.
 */
export function forViewer(shared: SharedMessage, viewerId: string): unknown {
  const reactions = shared.message.reactions as Array<{ emoji: string; count: number; me: boolean }>
  const poll = shared.message.poll as
    | { options: Array<{ idx: number; mine: boolean }> }
    | undefined

  const any = (reactions && reactions.length > 0) || !!poll
  if (!any) return shared.message

  const out: Record<string, unknown> = { ...shared.message }
  if (reactions && reactions.length > 0) {
    out.reactions = reactions.map((r) => ({
      ...r,
      me: shared.reactors.get(r.emoji)?.has(viewerId) ?? false,
    }))
  }
  if (poll) {
    const theirs = shared.chose.get(viewerId)
    out.poll = {
      ...poll,
      options: poll.options.map((o) => ({ ...o, mine: theirs?.has(o.idx) ?? false })),
    }
  }
  return out
}

/** Everything the client needs about one message, after a change. */
export function hydrateOne(id: string, viewerId: string): unknown | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL')
    .get(id) as unknown as MessageRow | undefined
  if (!row) return null
  return hydrate([row], viewerId)[0] ?? null
}

/** Members of a DM channel. Empty for public channels. */
export function dmMembers(channelId: string): string[] {
  return (db
    .prepare('SELECT user_id FROM container_members WHERE container_id = ?')
    .all(channelId) as unknown as Array<{ user_id: string }>).map((r) => r.user_id)
}

/**
 * A channel as clients expect it, with DM membership attached.
 *
 * A bare row is not enough for a conversation: the client works out who it is
 * talking to from `members`, and without it the DM opens with no name on it
 * and no way to call anybody. The gateway does this for every channel at
 * sign-in, so anything sent later has to match or the two disagree.
 */
/**
 * How roles are ordered, everywhere.
 *
 * Highest position first, which is the hierarchy - and then a tie-break,
 * which is the part that was missing. A new role is given one above the
 * highest, capped at a ceiling, so two roles can and do end up sharing a
 * position; SQLite is then free to return them in either order, and it does
 * not have to be the same order twice. That decides which colour somebody
 * wears and where their group sits in the member list, so it would have read
 * as two roles swapping places for no reason.
 *
 * Older first among equals, because that is the one people already think of
 * as senior, and by id after that so it is settled even for two made in the
 * same millisecond.
 *
 * One constant rather than nine copies of the same clause: they were nine
 * separate strings, and a fix applied to eight of them is not a fix.
 */
export const ROLE_ORDER = 'ORDER BY position DESC, created_at ASC, id ASC'

/** The same order, for a query that aliases the roles table as `r`. */
export const ROLE_ORDER_R = 'ORDER BY r.position DESC, r.created_at ASC, r.id ASC'

export function channelFor(id: string): unknown | null {
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    unknown as {
      id: string; kind: string; created_at: number
      members?: string[]; last_activity?: number
    } | undefined
  if (!row) return null
  if (isConversationKind(row.kind)) row.members = dmMembers(id)
  /*
   * The same field the channel list is given when a client connects, worked
   * out the same way - most recent message, or when the channel was made if
   * there is nothing in it yet.
   *
   * It is not a column, so a pushed channel arrived without it and every
   * client sorted it as if nothing had ever happened in it. A conversation
   * created the moment a friend request was accepted therefore appeared at
   * the BOTTOM of the list, which is the opposite of where a brand new
   * conversation belongs.
   */
  const last = db
    .prepare('SELECT MAX(created_at) AS at FROM messages WHERE channel_id = ? AND deleted_at IS NULL')
    .get(id) as unknown as { at: number | null } | undefined
  row.last_activity = last?.at ?? row.created_at
  return row
}

/**
 * True when this channel is a conversation - a DM or a group.
 *
 * Named for what it tests. It asks whether the channel has members in
 * dm_members, which is a different thing entirely from a channel's
 * is_private flag in access.ts, and reading one as the other inverts every
 * check that uses it.
 */
export function isDirect(channelId: string): boolean {
  /*
   * Asked of what the thing is, rather than of who is in it.
   *
   * This used to answer by looking for anybody in dm_members, so a
   * conversation with nobody left in it stopped being a conversation and
   * started being treated as a room in a server. The container says what it
   * is directly, which is both the shorter question and the one that stays
   * true when the membership is empty.
   */
  const row = db
    .prepare("SELECT 1 AS x FROM containers WHERE id = ? AND kind IN ('dm', 'group')")
    .get(channelId) as unknown as { x: number } | undefined
  return Boolean(row)
}

/**
 * There is nothing to seed.
 *
 * This used to make a seeded server on an empty database, with five
 * channels and a pair of roles, because the app began as a thing each person
 * downloaded and hosted for themselves: the install *was* the server, and
 * there was no way to make another inside it.
 *
 * That is not how this works. One instance is hosted, everybody makes an
 * account on it, and everybody makes their own servers inside it - so an
 * install having a server of its own is a leftover, and a brand new account
 * landing in somebody else's server is not a thing that should happen.
 * Making a server already creates its own channels, its own @everyone and
 * Owner, and hands the Owner role to whoever made it; there is nothing the
 * old seed did that the ordinary path does not.
 *
 * A fresh account now has no servers, which is the correct answer: the home
 * page it lands on is the one carrying "make or join a server".
 *
 * Kept as a function that does nothing rather than deleted, so the migrations
 * below - which do still need to know about a database written under the old
 * shape - keep their place in the order they run in.
 */
export function seed(): void {
  /* Nothing. See above. */
}

