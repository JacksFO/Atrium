import { isConversationKind } from './kinds.js'
import { WebSocketServer, WebSocket } from 'ws'
import { config } from './config.js'
import type { Server, IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { readToken, findUser } from './auth.js'
import { db, rememberVoiceModeration, withReadCache, joinContainer, makeContainer, setConversationClosed, channelsForClient, conversationBetween, membersOfContainer, blockedBetween, blockedBy, hydrateOne, hydrateShared, forViewer, dmMembers, isDirect, startingMembers, canSeeMember, visibleWith, channelPrefsFor, channelFor, membersOfSpace, isSpaceMember, uploadClaim, ACTIVE_USERS, PUBLIC_USER_COLUMNS, type User, ROLE_ORDER_R } from './db.js'
import { permissionsFor, permissionsIn, writeAudit, outranks, type Permission } from './permissions.js'
import { mayIgnoreSlowmode, slowmodeMessage, waitLeft } from './slowmode.js'
import { timedOutUntil } from './db.js'
import {
  canAccessChannel, accessibleChannelIds, canBeInVoice, channelPermissionsFor, setVoicePlacement,
} from './access.js'
import { mentionedBy, recordMentions, unreadMentionChannels } from './mentions.js'
import { cleanActivities, type Activity } from './activity.js'
import { allow } from './ratelimit.js'

type Client = { socket: WebSocket; user: User; alive: boolean; givenUpOn?: boolean }

const clients = new Set<Client>()
/**
 * The same clients, indexed by who they are.
 *
 * Delivery needs "the sockets belonging to these people" constantly, and
 * finding them by walking every connection is what made a two-person message
 * cost a lap of the whole machine. Kept in step with `clients` through
 * addClient and dropClient, which are the only two ways in or out - a set
 * that can be updated from anywhere is a set that will disagree.
 */
const socketsOf = new Map<string, Set<Client>>()

function addClient(c: Client): void {
  clients.add(c)
  const theirs = socketsOf.get(c.user.id) ?? new Set<Client>()
  theirs.add(c)
  socketsOf.set(c.user.id, theirs)
}

function dropClient(c: Client): void {
  clients.delete(c)
  const theirs = socketsOf.get(c.user.id)
  if (!theirs) return
  theirs.delete(c)
  // Emptied rather than left behind: one entry per account that has ever
  // connected is a slow leak on a long-running process.
  if (theirs.size === 0) socketsOf.delete(c.user.id)
}

/**
 * Who is in which voice channel, and their moderation state.
 *
 * Kept in memory rather than the database: it is worthless after a restart,
 * because every client will have been disconnected anyway.
 */
type VoiceState = {
  channelId: string
  muted: boolean      // they muted themselves
  deafened: boolean   // they muted everyone else
  sharing: boolean
  /**
   * Which preset they chose to share at, so viewers can be told.
   *
   * The badge saying "1080p 30FPS" read a setting held on the sharer's own
   * machine, so it could only ever be shown to the sharer. Everybody else
   * watched with no idea whether what they were seeing was the quality on
   * offer or their own connection struggling.
   *
   * An id, not the preset: the numbers behind each one belong to the client
   * and can change without this having to know.
   */
  shareQuality: string | null
  /**
   * What this person is watching, as stream keys like `share:<id>`.
   *
   * Nothing streams until somebody asks for it, and until now only the media
   * server knew who had asked — so a picture of who is watching your screen
   * could not be drawn, because nobody outside your own browser knew.
   *
   * Held here rather than derived: the media server knows subscriptions and
   * does not tell the other clients, and this is the one place that already
   * fans out to exactly the people allowed to see it.
   */
  watching: string[]
  // Independent of sharing on purpose: a screen and a face are two separate
  // things to send, and plenty of people do both at once.
  camera: boolean
}
const voice = new Map<string, VoiceState>()

/**
 * The presets a client is allowed to claim.
 *
 * Checked rather than passed through: this string is sent on to everybody
 * else in the channel, and a value that came from one person and is shown to
 * the rest is not something to take on trust. Mirrors SHARE_PRESETS in the
 * client - a new preset needs adding here too, and until it is, it reads as
 * no answer rather than as a wrong one.
 */
const SHARE_QUALITIES = new Set([
  'smooth', 'high', 'fluid', 'large',
  /*
   * Kept although the client no longer offers them.
   *
   * Somebody still running an older page can be sharing at one of these right
   * now, and refusing the string would take the badge off a share that is
   * genuinely running - the newer clients watching resolve an unknown id to
   * no badge on their own, which is the same outcome without calling a real
   * answer a lie.
   */
  'light', 'sharp',
])

/**
 * Server mute and deafen, applied by a moderator, in one server.
 *
 * Keyed by server and person, not by person. These were sets of user ids, and
 * the mute went into the LiveKit token as canPublish: false - so a moderator
 * of one server silenced somebody everywhere in the app, including in
 * servers that moderator has nothing to do with, and including a server that
 * person owns.
 */
const modKey = (spaceId: string, userId: string): string => `${spaceId}\u0000${userId}`
const serverMutes = new Set<string>()

/**
 * Read back at boot, written on every change.
 *
 * The sets stay, because these are read on every voice broadcast and a
 * query each time would be silly. The table is only the copy that survives
 * the process - which it did not before, so every restart quietly undid
 * every moderator's decision.
 */
function rememberModeration(spaceId: string, userId: string): void {
  const key = modKey(spaceId, userId)
  try {
    rememberVoiceModeration(spaceId, userId, {
      muted: serverMutes.has(key),
      deafened: serverDeafens.has(key),
      implied: impliedMutes.has(key),
    })
  } catch (err) {
    /*
     * Writing it down failing must not stop it happening.
     *
     * This threw on every call for as long as it existed, and because it sits
     * before the rest of the handler, the audit entry, the instruction to
     * re-mint the token and the broadcast all went with it - so a mute was
     * held in memory, drawn in the member list, and never actually applied.
     * The write is the part that survives a restart; it is not the part that
     * makes the mute work, and it must not be able to take that with it.
     */
    console.error('[voice] could not write down a moderation decision', err)
  }
}
/**
 * Mutes that arrived as part of a deafen rather than on their own.
 *
 * Deafening somebody mutes them too - there is little sense in talking to
 * people you cannot hear. But undeafening lifted only the deafen, so the mute
 * it had added stayed behind and had to be found and removed by hand.
 * Applying two things and lifting one is the whole bug; this remembers which
 * mutes were never asked for directly.
 */
const impliedMutes = new Set<string>()

/**
 * People we have just told to reconnect their media, and when.
 *
 * Muting somebody rewrites what their token allows, which only takes effect
 * when their client reconnects - and a client on its way through that can
 * announce a departure it does not mean. Believing it removes somebody who
 * is still sitting in the call hearing everyone, and once they are gone from
 * here no moderator can reach them to undo the mute that caused it. Their
 * socket closing still removes them, so nobody lingers who has really left.
 */
const reconnecting = new Map<string, number>()
const RECONNECT_GRACE_MS = 10_000

/**
 * How far back a repeated send is recognised as the same one.
 *
 * Generous on purpose. Every send carries a fresh id, so the only thing that
 * ever reuses one is a retry of that same message - which means a longer
 * window costs nothing and a short one is a real hole: a client that was
 * shut for an afternoon and comes back flushing what it never heard about
 * would post a second copy of everything that had in fact arrived.
 *
 * Found by a probe that reused an id across runs and got two copies once the
 * ten minutes it started with had elapsed.
 */
const REPEAT_WINDOW_MS = 24 * 60 * 60_000

/**
 * How long a deleted message can be brought back.
 *
 * A little longer than the ten seconds offered in the client, so the answer
 * to "can I still undo this" is never decided by the round trip.
 */
/**
 * How much is waiting in each channel, counted to a ceiling.
 *
 * A badge says "99+" past two digits, so counting further is work nobody can
 * see. The ceiling is what keeps this proportional to the number of channels
 * rather than to everything ever said in them.
 */
const UNREAD_CAP = 100

/** Which channels have anything at all: two timestamps, no counting. */
const unreadWhere = db.prepare(
  `SELECT c.id AS channelId, c.kind AS kind, r.last_read_at AS readAt,
          (SELECT MAX(created_at) FROM messages m
            WHERE m.channel_id = c.id AND m.deleted_at IS NULL) AS newest
     FROM channels c
     LEFT JOIN read_state r ON r.channel_id = c.id AND r.user_id = ?`
)

/** And how much, for the few that do - stopping at the ceiling. */
const unreadCount = db.prepare(
  `SELECT COUNT(*) AS n FROM (
     SELECT 1 FROM messages
      WHERE channel_id = ? AND author_id != ? AND deleted_at IS NULL
        AND created_at > ?
      LIMIT ${UNREAD_CAP})`
)

/*
 * The same count, for somebody who has blocked people.
 *
 * The badge was counting messages the app then refuses to show - open the
 * channel and find nothing but collapsed stubs, which is the notification
 * problem one size smaller: a number that walks you into a room to see
 * nothing.
 *
 * Its own statement rather than a clause on the one above, because of what
 * the clause costs when it has nothing to do. Measured, on a channel of
 * fifty thousand messages: 40.2us for the plain count against 68.9us with
 * the NOT EXISTS and an empty blocks table - 71% more, on a query that runs
 * once per channel per connection, to answer a question almost nobody is
 * asking. At fifty channels and a hundred people reconnecting together that
 * is 144ms of blocked event loop bought for nothing.
 *
 * So the price is paid by the people it is for. Which one to run is decided
 * by a single indexed probe per connection, below.
 */
const unreadCountMinusBlocked = db.prepare(
  `SELECT COUNT(*) AS n FROM (
     SELECT 1 FROM messages m
      WHERE m.channel_id = ? AND m.author_id != ? AND m.deleted_at IS NULL
        AND m.created_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE b.blocker_id = ? AND b.blocked_id = m.author_id)
      LIMIT ${UNREAD_CAP})`
)

/** Whether this account has blocked anybody at all. One probe, once. */
const hasBlockedAnybody = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? LIMIT 1')

function unreadFor(userId: string): Array<{ channelId: string; count: number }> {
  const out: Array<{ channelId: string; count: number }> = []
  /* Asked once for the whole sweep rather than per channel, and false for
     almost every account that will ever run this. */
  const any = Boolean(hasBlockedAnybody.get(userId))
  const rows = unreadWhere.all(userId) as unknown as Array<{
    channelId: string; kind: string; readAt: number | null; newest: number | null
  }>
  for (const c of rows) {
    if (!c.newest) continue
    /*
     * A public channel never opened counts from nothing, because joining a
     * server should not present two thousand unread messages. A conversation
     * counts from the beginning, because one nobody has opened is one nobody
     * has seen.
     */
    const since = c.readAt ?? (isConversationKind(c.kind) ? 0 : null)
    if (since === null || c.newest <= since) continue
    const n = (any
      ? unreadCountMinusBlocked.get(c.channelId, userId, since, userId)
      : unreadCount.get(c.channelId, userId, since)) as unknown as { n: number }
    if (n.n > 0) out.push({ channelId: c.channelId, count: n.n })
  }
  return out
}

const UNDO_MS = 15_000
const serverDeafens = new Set<string>()

// Put back what was in force when the process last stopped.
for (const row of db.prepare('SELECT space_id, user_id, muted, deafened, implied FROM voice_moderation')
  .all() as unknown as Array<{ space_id: string; user_id: string; muted: number; deafened: number; implied: number }>) {
  const key = modKey(row.space_id, row.user_id)
  if (row.muted) serverMutes.add(key)
  if (row.deafened) serverDeafens.add(key)
  if (row.implied) impliedMutes.add(key)
}

/**
 * What the realtime side is currently carrying.
 *
 * For the status page. Nothing here is a secret from the owner, and all of
 * it is the sort of thing you want to know before somebody tells you the
 * app is behaving oddly.
 */
export function gatewayStats(): {
  sockets: number
  people: number
  rooms: number
  inVoice: number
  sharing: number
  onCamera: number
} {
  const people = new Set<string>()
  for (const c of clients) people.add(c.user.id)
  const rooms = new Set<string>()
  let sharing = 0
  let onCamera = 0
  for (const v of voice.values()) {
    rooms.add(v.channelId)
    if (v.sharing) sharing += 1
    if (v.camera) onCamera += 1
  }
  return {
    sockets: clients.size,
    people: people.size,
    rooms: rooms.size,
    inVoice: voice.size,
    sharing,
    onCamera,
  }
}

export function serverDeafened(spaceId: string | null, userId: string): boolean {
  return spaceId !== null && serverDeafens.has(modKey(spaceId, userId))
}

export function serverMuted(spaceId: string | null, userId: string): boolean {
  // A conversation is not a server and has nobody to moderate it.
  return spaceId !== null && serverMutes.has(modKey(spaceId, userId))
}

type PublicVoiceState = VoiceState & {
  userId: string; serverMuted: boolean; serverDeafened: boolean
}

/* ------------------------------------------------------- calls in chat -- */

/*
 * Close anything left open when the process stopped.
 *
 * Who is in a call lives in memory and the two-minute timers live in the
 * event loop, so a restart loses both - and a call row open at that moment
 * would say "started a call" in that conversation for ever, with nothing
 * left anywhere able to end it. Nobody is in a call at boot by definition,
 * so anything still open ended when the server did.
 *
 * Written the moment this feature existed and missed, which is how it should
 * have been found: the server has been restarted a dozen times today.
 */
{
  const stranded = db.prepare(
    "UPDATE messages SET call_ended_at = created_at WHERE kind = 'call' AND call_ended_at IS NULL"
  ).run()
  if (Number(stranded.changes) > 0) {
    console.log(`[calls] closed ${stranded.changes} call(s) left open by a restart`)
  }
}

/** The one-to-one conversation between two people, if they have one. */
/** The conversation between two people, if there is one. */
function dmBetween(a: string, b: string): string | null {
  return conversationBetween(a, b)
}

/**
 * The conversation between two people, making it if there is not one yet.
 *
 * Ringing used to write a call row only where a conversation already existed,
 * so calling somebody you had never messaged left no trace of the call at
 * all. That is the one case the rows were added for: somebody who was away
 * had no way of knowing anybody had rung, and "away" very much includes
 * "we have never spoken before".
 *
 * Worse when they were offline, which is when it matters most - the caller
 * was told the person was unavailable and the person was told nothing, ever.
 *
 * Safe to call on any ring, because ringing is already limited to somebody
 * you share a server with, are friends with, or are already talking to. It
 * cannot be used to open a conversation with a stranger.
 */
export function dmBetweenOrMake(a: string, b: string): string | null {
  const existing = dmBetween(a, b)
  if (existing) return existing

  const other = db.prepare(`SELECT id, display_name FROM users WHERE id = ? AND ${ACTIVE_USERS}`)
    .get(b) as { id: string; display_name: string } | undefined
  if (!other) return null

  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    "INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, ?, '', 'dm', 0, ?)"
  ).run(id, other.display_name, now)
  makeContainer(id, 'dm', now)
  joinContainer(a, id)
  joinContainer(b, id)

  // Both sides need it before anything lands in it, or the call row arrives
  // in a conversation neither client knows exists.
  const channel = channelFor(id)
  pushToUsers([a, b], { t: 'channel-created', channel })
  return id
}

/** The call still in progress in this conversation, if there is one. */
/**
 * A conversation where this person has a call still open, if any.
 *
 * For the case nothing else covers: somebody rang and hung up before anybody
 * answered, so they were never counted as being in the room and the ordinary
 * "did that empty it" check never ran. The row stayed open and offered a call
 * to walk into that had nobody in it.
 *
 * Their own calls only - the author of the row - because hanging up is only
 * an ending for the person who started it. Somebody else leaving a
 * conversation they were never in ends nothing.
 */
function liveCallRowChannelFor(userId: string): string | null {
  const row = db.prepare(
    `SELECT channel_id AS c FROM messages
      WHERE kind = 'call' AND author_id = ? AND call_ended_at IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
  ).get(userId) as unknown as { c: string } | undefined
  return row?.c ?? null
}

function liveCallRow(channelId: string): { id: string; created_at: number } | undefined {
  return db.prepare(
    `SELECT id, created_at FROM messages
      WHERE channel_id = ? AND kind = 'call' AND call_ended_at IS NULL
        AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`
  ).get(channelId) as { id: string; created_at: number } | undefined
}

/** Somebody rang. Written straight away, so a missed call still leaves a trace. */
function openCallRow(channelId: string, callerId: string): void {
  // One at a time. Ringing again while a row is open would leave the first
  // one running for ever, and the conversation would collect calls that never
  // ended.
  if (liveCallRow(channelId)) return

  const id = randomUUID()
  db.prepare(
    `INSERT INTO messages (id, channel_id, author_id, body, created_at, kind, call_missed)
     VALUES (?, ?, ?, '', ?, 'call', 1)`
  ).run(id, channelId, callerId, Date.now())
  pushRow(channelId, id)
}

/** Picked up: no longer missed, and the length is counted from here. */
function answerCallRow(channelId: string): void {
  const open = liveCallRow(channelId)
  if (!open) return
  db.prepare('UPDATE messages SET call_missed = 0, created_at = ? WHERE id = ?')
    .run(Date.now(), open.id)
  pushRow(channelId, open.id)
}

/** Over, however it ended. */
function endCallRow(channelId: string, onlyIfMissed = false): void {
  const open = liveCallRow(channelId)
  if (!open) return
  const missed = db.prepare('SELECT call_missed AS m FROM messages WHERE id = ? AND deleted_at IS NULL')
    .get(open.id) as { m: number }
  // Cancelling or declining only ends a call nobody answered. A hang-up ends
  // one that was.
  if (onlyIfMissed && missed.m !== 1) return
  db.prepare('UPDATE messages SET call_ended_at = ? WHERE id = ?').run(Date.now(), open.id)
  pushRow(channelId, open.id)
}

/**
 * How long one person may sit in a call on their own before it is over.
 *
 * Both leaving ends it at once - there is nothing left to come back to. One
 * leaving does not, because dropping out, closing a lid and walking to
 * another room all look exactly like hanging up, and the call is very often
 * still happening. Two minutes is long enough to come back from that and
 * short enough that somebody left talking to themselves is not still counted
 * as being on a call an hour later.
 */
const CALL_LINGER_MS = 2 * 60_000
const endingCalls = new Map<string, NodeJS.Timeout>()

/** How many people are in this room now. */
function roomCount(channelId: string): number {
  let n = 0
  for (const v of voice.values()) if (v.channelId === channelId) n += 1
  return n
}

/**
 * Somebody left a conversation's call.
 *
 * Empty ends it. One person left starts the clock, and them being joined
 * again stops it - coming back carries on the same call rather than opening
 * a second one underneath the first.
 */
function callMayBeOver(channelId: string): void {
  const left = roomCount(channelId)
  if (left === 0) {
    callStillGoing(channelId)
    endCallRow(channelId)
    return
  }
  if (endingCalls.has(channelId)) return
  endingCalls.set(channelId, setTimeout(() => {
    endingCalls.delete(channelId)
    // Asked again rather than assumed: two minutes is plenty of time for the
    // other person to have come back, and the timer cannot know that.
    if (roomCount(channelId) < 2) endCallRow(channelId)
  }, CALL_LINGER_MS))
}

/** Somebody joined, so whatever was counting down is no longer true. */
function callStillGoing(channelId: string): void {
  const timer = endingCalls.get(channelId)
  if (!timer) return
  clearTimeout(timer)
  endingCalls.delete(channelId)
}

/** Send the row to everybody in the conversation, new or changed. */
function pushRow(channelId: string, messageId: string): void {
  /*
   * By id. hydrateOne takes one and fetches the row itself - handing it the
   * row instead made node:sqlite read the object as a bag of named
   * parameters and throw "Unknown named parameter 'id'", so nothing was ever
   * pushed and a call only appeared on reload.
   *
   * It slipped through because the call carried `as never`, which silenced
   * the one check that would have said so. The cast was the bug; the argument
   * was only the symptom.
   */
  toChannelHydrated(channelId, messageId, 'message')
}

/**
 * One message, to everybody in a channel who may see it, hydrated once.
 *
 * The four places that send a message row used to hydrate it per recipient,
 * which is two queries each. Almost nothing about a message differs by who is
 * reading it - the row is the row and the attachment links are signed the
 * same for everyone - so ten thousand people meant twenty thousand queries to
 * build ten thousand objects differing in one boolean per emoji. On a message
 * that has just been sent there are no reactions at all, so they were
 * identical.
 *
 * Two queries now, and a shallow copy each with the reaction flags answered
 * from a set.
 */
function toChannelHydrated(channelId: string, messageId: string, t: string): void {
  // Deleted between the write and here. Nothing to send anybody.
  const shared = hydrateShared(messageId)
  if (!shared) return
  const allowed = audienceFor(channelId)
  for (const c of candidatesFor(channelId)) {
    if (!allowed(c)) continue
    send(c.socket, { t, message: forViewer(shared, c.user.id) })
  }
}

/**
 * A message changed; tell the channel.
 *
 * The same path an edit or a reaction takes, so a poll's counts arrive the
 * way every other change to a message does — hydrated once and personalised
 * per reader, rather than a second kind of update with its own rules.
 */
export function pushMessageChange(channelId: string, messageId: string): void {
  toChannelHydrated(channelId, messageId, 'message')
}

/** The server a voice channel belongs to, for measuring rank in the right place. */
function spaceOfVoice(userId: string): string | null {
  const where = voice.get(userId)?.channelId
  if (!where) return null
  const row = db.prepare('SELECT space_id FROM channels WHERE id = ?').get(where) as
    { space_id: string | null } | undefined
  return row?.space_id ?? null
}

/**
 * A one-time pass into a channel somebody was carried into.
 *
 * Being in the call is the permission, and for as long as they are in it,
 * that is all this needs. The gap is the moment of arriving: a client moved
 * between channels tears the old connection down before building the new
 * one, and anything that announces the leave on the way deletes the very
 * record that is letting them in. They would then be refused entry to the
 * room they had just been carried into - which is the stranding the old
 * refusal was avoiding, arriving by a different door.
 *
 * So the move also hands them a pass, and the pass is spent the moment they
 * announce they are there. After that it is presence again, and hanging up
 * ends it exactly as before: nothing is granted, and nothing is left behind.
 * An unspent one goes stale on its own, for somebody who was moved and whose
 * app never managed to arrive.
 */
const passes = new Map<string, { channelId: string; until: number }>()
const PASS_MS = 60_000

/*
 * Who is in which call, for the access layer to consult.
 *
 * Registered rather than imported: access.ts must not depend on the gateway,
 * and this is the only place that knows - being in a call is held in memory
 * here and written down nowhere.
 */
setVoicePlacement((userId, channelId) => {
  if (voice.get(userId)?.channelId === channelId) return true
  const pass = passes.get(userId)
  if (!pass || pass.channelId !== channelId) return false
  if (pass.until <= Date.now()) {
    passes.delete(userId)
    return false
  }
  return true
})

function voiceSnapshot(): PublicVoiceState[] {
  return [...voice.entries()].map(([userId, v]) => ({
    userId,
    ...v,
    // Whatever is in force in the server whose room they are sitting in.
    serverMuted: serverMuted(spaceOfChannel(v.channelId), userId),
    serverDeafened: serverDeafened(spaceOfChannel(v.channelId), userId),
  }))
}


/**
 * The occupancy one person is allowed to see.
 *
 * Two different walls, and only one of them was here.
 *
 * A conversation's call is private to the people in that conversation, which
 * was answered. A server's voice channel is private to that server, which
 * nothing answered - so when nobody happened to be on a call in a DM,
 * this returned every occupant in the app to everybody connected. Sitting
 * in a voice channel in one server was visible from a server you have never
 * been in, along with whether you were muted and whether you were sharing
 * your screen.
 *
 * canAccessChannel already knows the rule, including private channels within
 * a server, so this asks it rather than restating it.
 */
function canSeeVoice(user: { id: string }, channelId: string): boolean {
  if (isDirect(channelId)) return dmMembers(channelId).includes(user.id)
  return canAccessChannel(user.id, channelId)
}

function voiceVisibleTo(userId: string): PublicVoiceState[] {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as
    { id: string } | undefined
  if (!user) return []
  return voiceSnapshot().filter((o) => canSeeVoice(user, o.channelId))
}

function announceVoice(): void {
  const all = voiceSnapshot()
  /*
   * Worked out per client now, rather than broadcasting one list to everybody
   * whenever no DM call was running. That shortcut was the leak: the common
   * case sent every server's voice channels to every connected person.
   *
   * The cost is a handful of channel-access checks per person per change,
   * against a few people and a few channels. Correctness is worth more than
   * a saved string concatenation here.
   */
  for (const c of clients) {
    send(c.socket, {
      t: 'voice-state',
      occupants: all.filter((o) => canSeeVoice(c.user, o.channelId)),
    })
  }
}


/**
 * The last still captured from each live screen share.
 *
 * Held only in memory and only while the share is running: a picture of
 * somebody's desktop is not something to keep a moment longer than the
 * thing it is a picture of. Dropped the instant they stop sharing.
 */
const stills = new Map<string, { image: string; at: number }>()
/** Who asked for a still and has not been given one yet. */
const stillWaiters = new Map<string, Set<string>>()
/**
 * When each sharer was last asked for a frame.
 *
 * Without this, one person hovering a name in a loop makes somebody else's
 * machine grab and encode a frame of their screen as fast as it is asked -
 * a client deciding how much work another client does. Anyone who asks
 * while a capture is already in flight is added to the waiting list and
 * gets that one when it lands.
 */
const stillAsked = new Map<string, number>()
const STILL_ASK_MS = 1_500
/**
 * When each viewer was last handed a still of each sharer.
 *
 * The ask throttle above protects the sharer's machine. This protects the
 * server's upload, which is a different thing and the one that hurts: a
 * cached still is served without asking anybody, and the general message
 * limit allows thirty messages a second. Every other thing this gateway
 * sends is a few bytes; a still is twenty thousand of them, so that allowance
 * is roughly six hundred kilobytes a second of upstream per client - about
 * five megabits, from a house, for one person holding a pointer still.
 *
 * The card asks every four seconds. Two is generous and cannot be noticed.
 */
const stillServed = new Map<string, number>()
const STILL_SERVE_MS = 2_000

/** Whether this viewer may be handed a picture of this sharer right now. */
function mayServeStill(viewer: string, sharer: string): boolean {
  const key = `${viewer}:${sharer}`
  if (Date.now() - (stillServed.get(key) ?? 0) < STILL_SERVE_MS) return false
  stillServed.set(key, Date.now())
  return true
}
/** How stale a still may be before it is worth asking for another. */
const STILL_FRESH_MS = 6_000
/** Roughly a 320px JPEG, base64. Anything larger is not a thumbnail. */
const STILL_MAX = 96 * 1024

/**
 * Tell somebody that a picture of their screen just went to somebody else.
 *
 * The spectator list is built from live connections, so a person looking at
 * stills appeared nowhere on it - they could watch a frame of your desktop
 * every few seconds and you would have no way to know. Nothing they could not
 * have seen by pressing Watch, but "who can see this" has to be true, and it
 * was not.
 */
function tellSharer(sharer: string, viewer: string): void {
  if (sharer === viewer) return
  for (const c of clients) {
    if (c.user.id === sharer) send(c.socket, { t: 'share-peeked', userId: viewer })
  }
}

function forgetStills(userId: string): void {
  stills.delete(userId)
  stillWaiters.delete(userId)
  stillAsked.delete(userId)
  // Keyed viewer:sharer, so the ones to drop are every viewer of this sharer.
  const suffix = `:${userId}`
  for (const key of stillServed.keys()) {
    if (key.endsWith(suffix)) stillServed.delete(key)
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

/**
 * Who may see traffic in a channel.
 *
 * Public channels reach everyone; a DM reaches only its members. Previously
 * every message went to every connected client and was filtered in the
 * browser - harmless with one public space, a straight data leak the moment
 * DMs existed.
 */
function audienceFor(channelId: string): (c: Client) => boolean {
  if (isDirect(channelId)) {
    const allowed = new Set(dmMembers(channelId))
    return (c) => allowed.has(c.user.id)
  }
  // A private channel broadcasts only to the people who can see it. Without
  // this the message list is filtered but the live feed is not, so a message
  // appears in a channel somebody was never shown.
  return (c) => canAccessChannel(c.user.id, channelId)
}

/**
 * The connected clients worth asking about a channel at all.
 *
 * Every send walked `clients` - every socket in the app - and asked the
 * audience predicate about each one. For a two-person conversation at fifty
 * thousand connections that is fifty thousand questions to find two, and for
 * a channel each question is a permission resolution.
 *
 * Narrowed by the only thing that is cheap and certain: a conversation
 * reaches its members, and a channel cannot reach anybody who is not in the
 * server it belongs to. One query either way, and the predicate still decides
 * - this changes who gets asked, never what the answer is.
 */
function candidatesFor(channelId: string): Iterable<Client> {
  const ids = isDirect(channelId)
    ? dmMembers(channelId)
    : (() => {
        const space = spaceOfChannel(channelId)
        // No space and not a conversation should not happen; asking everybody
        // is the answer that cannot be wrong if it ever does.
        if (!space) return null
        return membersOfContainer(space)
      })()
  if (!ids) return clients

  const out: Client[] = []
  for (const id of new Set(ids)) {
    const theirs = socketsOf.get(id)
    if (theirs) for (const c of theirs) out.push(c)
  }
  return out
}

function toChannel(channelId: string, payload: unknown, except?: WebSocket): void {
  const allowed = audienceFor(channelId)
  const data = JSON.stringify(payload)
  for (const c of candidatesFor(channelId)) {
    if (c.socket === except || !allowed(c)) continue
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(data)
  }
}

/** Which server a channel belongs to. Null for a DM, which has none. */
/**
 * Who an @everyone in this channel actually reaches.
 *
 * The people in the conversation for a DM; the members of the server for a
 * channel. Not "everybody in the app" - a broadcast marks a channel for
 * the people who can see it, and marking it for anybody else would put a
 * badge on a server they are not in.
 */
function audienceOf(channelId: string): string[] {
  if (isDirect(channelId)) return dmMembers(channelId)
  const space = spaceOfChannel(channelId)
  if (!space) return []
  return membersOfContainer(space)
}

function spaceOfChannel(channelId: string): string | null {
  const row = db.prepare('SELECT space_id FROM channels WHERE id = ?').get(channelId) as
    { space_id: string | null } | undefined
  return row?.space_id ?? null
}

/**
 * May this person do this, in this channel?
 *
 * The channel is not optional in spirit: every one of these actions happens
 * somewhere. Without it the answer came from whichever server is first, so a
 * permission held there was held everywhere, and somebody who owned a server
 * of their own was refused in it because they held nothing in the original.
 * Servers are meant to be independent, and this was the seam they leaked
 * through most.
 *
 * And it is now the channel's answer rather than the server's, which is the
 * point of per-channel overrides: this one function is where "everybody may
 * send, except in announcements" becomes true. A check that reaches for
 * permissionsFor with a channel in its hand reads the server-wide answer and
 * silently ignores every override the channel has - so the ones here all
 * come through this.
 */
function may(user: User, permission: Permission, channelId?: string): boolean {
  if (!channelId) return permissionsFor(user.id, undefined).has(permission)
  return permissionsIn(user.id, channelId).has(permission)
}

/**
 * Who is online, as far as this person is concerned.
 *
 * This used to be every connected account in the app, handed to everybody
 * in `ready`. Names were safe - the member list has been scoped for a while -
 * but the ids were not, so a stranger with a fresh account got a live roster
 * of everyone using the app, and anything polling it learned when each of them
 * was awake. That is a behavioural record of people they share nothing with,
 * which is the thing the member list was scoped to prevent, arriving by a
 * different door.
 */
function onlineIdsFor(viewerId: string): string[] {
  const seen = visibleWith(viewerId)
  const here = new Set([...clients].map((c) => c.user.id))
  /*
   * Anybody still inside the grace counts as here. Their socket has gone but
   * nobody has been told, and leaving them out would hand somebody who
   * connected during those fifteen seconds a different answer to the one
   * everybody already connected is holding - one list built from the sockets,
   * the other from what was announced, disagreeing for as long as the grace
   * lasts.
   */
  for (const id of goingOffline.keys()) here.add(id)
  return [...here].filter((id) => seen.has(id))
}

/** Whether any socket is still open for them, without asking the database. */
function stillConnected(userId: string): boolean {
  for (const c of clients) if (c.user.id === userId) return true
  return false
}

/**
 * How long a dropped socket has to come back before anybody is told.
 *
 * You are online while the app is open, and a wifi hiccup is not the app
 * closing. Without this a three second blip announced the person offline and
 * online again, so a room of people watched a dot blink at them all evening
 * for something none of them did.
 *
 * Only ever applied to a socket that vanished. A clean close is somebody
 * quitting and is announced at once, and so is a socket the heartbeat gave up
 * on, which has already been silent for a minute by the time it gets here.
 */
const OFFLINE_GRACE_MS = 15_000

/** Offline announcements waiting to see whether the socket comes back. */
const goingOffline = new Map<string, NodeJS.Timeout>()

/**
 * Say they have gone, unless they are already back.
 *
 * The check runs again when the timer fires rather than only when it was set:
 * the whole point is that a reconnect in between makes the announcement wrong,
 * and by then it is `clients` that knows, not us.
 */
function announceOffline(userId: string): void {
  goingOffline.delete(userId)
  if (stillConnected(userId)) return
  pushAboutMember(userId, { t: 'presence', userId, online: false })
}

/** They are back, or never really left. Nothing to announce. */
function cancelOffline(userId: string): void {
  const timer = goingOffline.get(userId)
  if (timer === undefined) return
  clearTimeout(timer)
  goingOffline.delete(userId)
}

/**
 * What each person is doing, while they are here.
 *
 * In memory and nowhere else, deliberately. A record of what somebody played
 * and when is exactly the thing nobody agreed to when they turned this on:
 * this answers "what are they doing now", and the moment they close the app
 * the answer is gone rather than filed. Nothing to leak and nothing to
 * subpoena, which is the whole design.
 */
const activities = new Map<string, Activity[]>()

/**
 * What everybody this person may be shown is doing.
 *
 * Filtered, not handed over whole. Sending the lot would tell somebody who
 * shares no server with any of them both that those accounts exist and what
 * they are doing tonight - which is the thing the member list was fixed to
 * stop doing, arriving by a different door.
 */
function activitiesVisibleTo(viewerId: string): Record<string, Activity[]> {
  const out: Record<string, Activity[]> = {}
  const seen = visibleWith(viewerId)
  for (const [userId, activity] of activities) {
    if (!seen.has(userId)) continue
    out[userId] = activity
  }
  return out
}

/**
 * Everybody who may be shown this person.
 *
 * A member update carries a name, a picture and a status. Sending it to every
 * connected client tells a stranger who else has an account here, which is
 * exactly what the member list stopped doing.
 */
export function pushAboutMember(userId: string, payload: unknown, except?: WebSocket): void {
  const data = JSON.stringify(payload)
  // Asked once. This was canSeeMember per connected client, which is a query
  // each and turns one person signing in into a query per person online.
  const seers = visibleWith(userId)
  for (const c of clients) {
    /*
     * `except` is the socket that caused this, when there is one. Telling
     * somebody their own connection just opened is noise - they were there -
     * while their *other* devices do need to hear it, which is why this is a
     * socket and not a user.
     */
    if (c.socket === except) continue
    if (!seers.has(c.user.id)) continue
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(data)
  }
}

/** Push an event to a specific set of members, wherever they are connected. */
export function pushToUsers(userIds: string[], payload: unknown): void {
  const wanted = new Set(userIds)
  const data = JSON.stringify(payload)
  for (const c of clients) {
    if (!wanted.has(c.user.id)) continue
    if (c.socket.readyState === WebSocket.OPEN) c.socket.send(data)
  }
}

/**
 * Push a channel change to everyone allowed to see channels.
 *
 * Gated on view_channels rather than blasted at everyone, so a member who
 * cannot see channels does not learn about them through the side door.
 */
export function pushChannelEvent(payload: unknown): void {
  const data = JSON.stringify(payload)
  /*
   * Only to people who can actually reach that channel.
   *
   * This went to everybody holding view_channels, which was everybody - the
   * same set of people, for as long as one server was the whole server. With
   * more than one it hands the name of a channel in your server to people who
   * are not in it, so it now asks the same question the channel list asks.
   */
  const shaped = payload as { channel?: { id?: string }; spaceId?: string | null }
  const channel = shaped?.channel
  /*
   * In the channel's own server. Asked without one, this was answered by
   * whether they may view channels in the original server - so an event about
   * somebody else's server was withheld from, or shown to, the wrong people
   * entirely.
   *
   * An event about several channels at once - a reorder - names its server
   * directly, because there is no single channel to read it off. Without that
   * it fell through to the original server's answer, and reordering one
   * server's channels sent every channel id and position in the app to
   * everybody connected.
   */
  const eventSpace = channel?.id ? spaceOfChannel(channel.id) : (shaped?.spaceId ?? undefined)

  /*
   * And an event about a list of channels is cut to each person's own list.
   *
   * The two checks below decide whether somebody hears an event at all, which
   * is the whole answer when the event is about one channel. A reorder is
   * about all of them, so passing that gate handed over the id and position
   * of every channel in the server - the private ones included. No names and
   * no contents, but it is still "there is a room here you cannot see, and it
   * is third", which is precisely what a private channel is not supposed to
   * say.
   *
   * So the list is rebuilt per person. That means serialising once per
   * recipient rather than once - a handful of channels for a handful of
   * people, against telling everybody about rooms that are not theirs.
   */
  const wholeList = (payload as { channels?: Array<{ id?: string }> })?.channels
  const listed = Array.isArray(wholeList) ? wholeList : null

  /*
   * And only the private ones are worth asking about.
   *
   * The first version of this asked canAccessChannel for every listed channel
   * for every client, which is right and does not scale: measured on this
   * machine at 73us a check, that is 13ms for fourteen channels and thirteen
   * people, 365ms at a hundred channels and fifty, and seven seconds at five
   * hundred and two hundred - and SQLite here is synchronous, so those are
   * seconds with the whole server stopped.
   *
   * A public channel is visible to anybody who got past the two checks below,
   * so it never needed asking about. Only a private one can leak, and there
   * are usually none: this is one indexed query for the event, then a check
   * per private channel per person. With no private channels in the server it
   * is the old single shared payload again, which is the common case.
   */
  const secret = listed && eventSpace
    ? new Set((db.prepare(
        'SELECT id FROM channels WHERE space_id = ? AND is_private = 1'
      ).all(eventSpace) as unknown as Array<{ id: string }>).map((r) => r.id))
    : new Set<string>()
  const anySecret = secret.size > 0

  for (const c of clients) {
    // Membership first. Permissions come from a space's @everyone whether or
    // not you are in it, so view_channels alone answers yes for a stranger.
    if (eventSpace && !isSpaceMember(c.user.id, eventSpace)) continue
    if (!permissionsFor(c.user.id, eventSpace).has('view_channels')) continue
    if (channel?.id && !canAccessChannel(c.user.id, channel.id)) continue
    if (c.socket.readyState !== WebSocket.OPEN) continue

    /* Nothing to cut: one channel, or a list with nothing private in it. */
    if (!listed || !anySecret) { c.socket.send(data); continue }

    const theirs = listed.filter((one) =>
      typeof one?.id === 'string'
      && (!secret.has(one.id) || canAccessChannel(c.user.id, one.id)))
    /* Every one of them was hidden, so there is nothing to say. Sending an
       empty list would be an event announcing that something they cannot see
       has moved. */
    if (theirs.length === 0) continue
    c.socket.send(JSON.stringify({ ...(payload as object), channels: theirs }))
  }
}

/**
 * Tell a server that somebody has arrived in it.
 *
 * There are two ways in - accepting an invite while signed in, and signing up
 * with one - and the second is the common one, because an invite usually goes
 * to somebody who does not have an account yet. Both have to say so, which is
 * why this lives here rather than beside either of them.
 *
 * `member-update` already announced the person, and that is not enough on its
 * own: it makes them somebody the client knows about, while the member column
 * filters by who is in the server on show. Without the membership they were
 * known, listed nowhere, and invisible until each person happened to reload.
 *
 * Only that server's members hear it. Who joined which server is that
 * server's business.
 */
export function announceJoin(spaceId: string | null, userId: string): void {
  if (!spaceId) return
  const who = db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as unknown as User | undefined
  if (!who) return
  const others = membersOfContainer(spaceId)
    .filter((id) => id !== userId)
  if (others.length > 0) {
    pushToUsers(others, { t: 'member-joined', spaceId, user: who })
  }

  /*
   * And the other direction, which was missing entirely.
   *
   * This told everybody already here that somebody had arrived, and
   * deliberately left the arriver out of that list - they know they joined.
   * But their own client was connected before they joined, so its member list
   * is still just themselves: it has never been sent anybody else, and a
   * `ready` only happens once, at connect.
   *
   * So every person in the server rendered as "Unknown" - the name a client
   * shows for an id it has no user for - until they reloaded the page.
   * Reported by somebody who had just been invited into a server.
   *
   * They are sent the people in the server they have just joined, which is
   * exactly what they gained sight of. This was visibleMembers - everybody
   * they can see anywhere - which was the same list `ready` used to carry and
   * is the same multiplication: joining one server re-sent every person in
   * every other one.
   */
  pushToUsers([userId], {
    t: 'members-sync',
    spaceId,
    members: membersOfSpace(spaceId),
    here: others.concat(userId),
  })
}

/**
 * Turn everybody out of a set of voice channels.
 *
 * Who is in a voice channel is held in memory here, keyed by person - the
 * channel rows know nothing about it. So deleting a server removed its
 * channels and left anybody sitting in one of them in a room that no longer
 * exists: still shown as in a call by their own app, with nothing to leave
 * and no way to be told.
 *
 * Called with the channel ids read BEFORE the delete, because afterwards
 * there is nothing left to ask which channels belonged to that server.
 */
export function clearVoiceIn(channelIds: string[]): void {
  if (channelIds.length === 0) return
  const gone = new Set(channelIds)
  let any = false
  for (const [userId, state] of [...voice]) {
    if (!gone.has(state.channelId)) continue
    voice.delete(userId)
    any = true
    // The same message somebody gets when they are disconnected by a
    // moderator: their app already knows how to put the call down.
    pushToUsers([userId], { t: 'voice-kick' })
  }
  if (any) announceVoice()
}

/**
 * Turn named people out of one voice channel.
 *
 * The sibling of clearVoiceIn, for losing access rather than the channel
 * ceasing to exist. Being in a call is held in memory here and nowhere else,
 * so taking somebody off a private channel's list left them sitting in it,
 * talking, with the app that removed them showing the change and nothing
 * happening to the call.
 *
 * Only the people named, because the others are still allowed to be there.
 */
export function clearVoiceForUsers(userIds: string[], channelId: string): void {
  let any = false
  for (const userId of userIds) {
    const state = voice.get(userId)
    if (!state || state.channelId !== channelId) continue
    voice.delete(userId)
    any = true
    // The message a moderator's disconnect already sends: their app knows
    // how to put a call down when it arrives.
    pushToUsers([userId], { t: 'voice-kick' })
  }
  if (any) announceVoice()
}

/**
 * Take somebody out of whatever call they are in inside one server.
 *
 * The third of these, and the one that was missing. Losing a private
 * channel clears the call (clearVoiceForUsers); a channel being deleted
 * clears it (clearVoiceIn); and losing the whole server - kicked, banned,
 * or walking out - did not.
 *
 * So somebody banned while sitting in a voice room stayed in it. Their
 * socket closed, which is not the same thing at all: being in a call is
 * held in this map and nowhere else, so everybody went on seeing them in
 * the room, and they went on talking, while the member list showed them
 * gone. A ban that leaves the person audible is not a ban.
 *
 * Nothing happens if their call is somewhere else - a conversation, or
 * another server's room. Neither is this server's business.
 */
export function clearVoiceForUserInSpace(userId: string, spaceId: string): void {
  const state = voice.get(userId)
  if (!state) return
  if (spaceOfChannel(state.channelId) !== spaceId) return
  voice.delete(userId)
  /* The same frame a moderator's remove-from-call sends: their app already
     knows how to put a call down when it arrives. */
  pushToUsers([userId], { t: 'voice-kick' })
  announceVoice()
}

/** Close every socket a member has open, e.g. once they are removed. */
export function disconnectUser(userId: string): void {
  for (const c of [...clients]) {
    if (c.user.id !== userId) continue
    send(c.socket, { t: 'removed' })
    c.socket.close(4004, 'removed from the space')
    dropClient(c)
  }
}

/**
 * Proxy one WebSocket to LiveKit, frame for frame.
 *
 * An https page cannot open a plain ws:// socket, so LiveKit's signalling is
 * relayed through this origin. Doing it here rather than with a plugin is
 * deliberate: a second plugin would attach its own `upgrade` listener, and
 * two listeners on the same server race for every upgrade - which silently
 * turned gateway connections into 404s about half the time.
 */
/**
 * Where a `/livekit/...` request is actually forwarded to.
 *
 * Built from the configured address and nothing else. This used to be string
 * concatenation - `config.livekitUrl + url.replace(/^\/livekit/, '')` - and a
 * path is not a suffix. `/livekit@evil.example/x` produced
 * `ws://localhost:7880@evil.example/x`, where `localhost:7880` is the
 * *userinfo* and the host is somebody else's machine; `/livekit@127.0.0.1:22/`
 * reached whatever was listening on that port. Nothing authenticates a
 * WebSocket upgrade, so anybody who could reach this server could have it open
 * outbound connections anywhere, and have the frames relayed back to them.
 *
 * So the host is taken from the configuration and the request may only choose
 * a path beneath it. Returns null for anything that is not a request to this
 * proxy at all.
 */
export function livekitTarget(rawUrl: string, configured: string): string | null {
  let base: URL
  try {
    base = new URL(configured)
  } catch {
    return null
  }

  const at = rawUrl.indexOf('?')
  const path = at === -1 ? rawUrl : rawUrl.slice(0, at)
  const query = at === -1 ? '' : rawUrl.slice(at)

  /* Exactly this prefix, and then either nothing or a path. `/livekitfoo` is
     not a request to this proxy and must not be treated as one. */
  if (path !== '/livekit' && !path.startsWith('/livekit/')) return null

  /*
   * One leading slash, always. Left as it arrived, `/livekit//evil.example/x`
   * becomes the protocol-relative `//evil.example/x`, which resolves against
   * any base to a different host - the same escape by a second door.
   */
  const rest = path.slice('/livekit'.length)
  const beneath = rest === '' ? '/' : `/${rest.replace(/^\/+/, '')}`

  const target = `${base.protocol}//${base.host}${beneath}${query}`

  /* And proved rather than trusted: whatever the construction did, this is
     only a target if it is still pointing at the configured host. */
  try {
    if (new URL(target).host !== base.host) return null
  } catch {
    return null
  }
  return target
}

function proxyToLivekit(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const target = livekitTarget(req.url ?? '', config.livekitUrl)
  if (target === null) {
    socket.destroy()
    return
  }

  const upstream = new WebSocket(target, {
    headers: {
      // LiveKit reads the token from the query string, but pass the origin
      // through so its own checks see the real client.
      ...(req.headers.origin ? { origin: req.headers.origin } : {}),
    },
  })

  let clientSocket: WebSocket | null = null

  upstream.on('open', () => {
    livekitWss.handleUpgrade(req, socket, head, (client) => {
      clientSocket = client
      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
      })
      client.on('close', () => upstream.close())
      client.on('error', () => upstream.close())

      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
      })
      upstream.on('close', () => client.close())
    })
  })

  upstream.on('error', () => {
    if (clientSocket) clientSocket.close()
    else socket.destroy()
  })
}

const livekitWss = new WebSocketServer({ noServer: true })

export function attachGateway(server: Server): void {
  // noServer, so this is the only thing listening for upgrades and it decides
  // where each one goes.
  // A ceiling on a single frame. The largest legitimate message is an SDP
  // offer at a few kilobytes; anything approaching this is not a client of
  // ours. ws closes the connection when a frame exceeds it.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    /*
     * Compressed, because what goes down this socket is repetitive JSON.
     *
     * Measured on real frames: a single message is 406 bytes and compresses
     * to 265, which is worth little. A voice-state broadcast for twenty
     * people is 3,693 bytes and compresses to 227 — 94% — because it is the
     * same eight keys twenty times over. Rosters, member lists and presence
     * are all that shape, and they are the frames that go to everybody.
     *
     * This is the cheap end of what Discord does with Erlpack: they replaced
     * JSON with a binary format for the same reason. Compression gets most of
     * the saving for one option rather than a codec on both sides.
     *
     * `threshold` keeps small frames raw — under a kilobyte the header costs
     * more than the compression saves, and a typing notice is 80 bytes.
     *
     * Context takeover is left ON, which is what makes the repetitive frames
     * collapse: the window carries the previous frame's dictionary. It costs
     * memory per connection, so on an instance with thousands of sockets this
     * is the knob to turn off first — `serverNoContextTakeover: true`, at the
     * price of most of the 94%.
     */
    perMessageDeflate: {
      threshold: 1024,
      zlibDeflateOptions: { level: 6, memLevel: 7 },
      concurrencyLimit: 10,
    },
  })

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url ?? '').split('?')[0] ?? ''

    if (path === '/gateway') {
      wss.handleUpgrade(req, socket as Duplex, head, (ws) => wss.emit('connection', ws, req))
      return
    }

    if (config.livekitUrl && (path === '/livekit' || path.startsWith('/livekit/'))) {
      proxyToLivekit(req, socket as Duplex, head)
      return
    }

    // Anything else is not a WebSocket endpoint we serve.
    socket.destroy()
  })

  wss.on('connection', (socket) => {
    let client: Client | null = null

    // A socket that never authenticates is dropped — otherwise an unauthenticated
    // connection can sit open forever holding a slot.
    const authTimer = setTimeout(() => {
      if (!client) socket.close(4001, 'no hello')
    }, 10_000)

    socket.on('message', async (raw) => {
      let msg: any
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }

      // Message budget.
      //
      // Nothing here was rate limited, which mattered little while every
      // message only affected the sender - and matters a great deal now that
      // rtc-signal exists, because that is an explicit instruction to send a
      // payload to somebody else. Without a budget one member can push
      // unbounded traffic into another member's socket.
      //
      // Generous enough that typing indicators and reactions never notice.
      if (client && !allow(`ws:${client.user.id}`, 300, 10_000)) return

      // ---- hello: the only message accepted before auth ----
      if (msg.t === 'hello') {
        /*
         * Once per socket, and only once.
         *
         * This assigned a fresh Client and added it to the set without asking
         * whether this socket already had one - so a second hello left the
         * first entry in `clients` for ever, pointing at the same socket. Two
         * entries meant every broadcast went down that socket twice, and the
         * heartbeat finished the job: it only ever marks the newest entry
         * alive, so a minute later it found the stale one silent and
         * terminated the perfectly healthy connection they share.
         *
         * Ignored rather than refused. A client with a session is not doing
         * anything dangerous by saying hello twice, and closing the socket
         * would turn a harmless duplicate into a disconnection.
         */
        if (client) return

        const userId = await readToken(String(msg.token ?? ''))
        const user = userId ? findUser(userId) : undefined
        if (!user) {
          send(socket, { t: 'error', code: 'bad_token' })
          socket.close(4003, 'bad token')
          return
        }

        /*
         * One question asked once.
         *
         * Everything from here to the ready frame is one synchronous stretch
         * of reads, and it asks the same handful of them repeatedly - who
         * owns this space, is this person in it, what is this channel. On the
         * live data that was 103 statements of which 63 were an exact repeat.
         * Held only for the length of this block; see withReadCache.
         */
        withReadCache(() => {

        clearTimeout(authTimer)
        client = { socket, user, alive: true }
        addClient(client)

        /*
         * view_channels is enforced here rather than only in the UI: without
         * it a member sees their DMs and nothing else.
         *
         * Per server, because the answer differs per server: one flat answer
         * meant losing view_channels in one place hid the channels of every
         * place, and holding it anywhere revealed them everywhere.
         */
        const mayViewIn = (spaceOfChannel: string | null) =>
          permissionsFor(user.id, spaceOfChannel).has('view_channels')
        /*
         * Conversations always, and a server's channels only where this
         * person may view channels in that server.
         *
         * One flat answer meant losing view_channels anywhere hid the
         * channels of everywhere, and holding it anywhere revealed them
         * everywhere - which is the same fault as every other unscoped
         * check, in the one place that decides what somebody can even see.
         */
        /*
         * Asked for by membership, rather than asking for everything.
         *
         * This read every text and voice channel in the app and then
         * filtered them down in JavaScript. It was correct - the filter below
         * and canAccessChannel both refuse a server somebody is not in - but
         * it was priced by the size of the whole app instead of by the size of
         * the answer, on the one path every connection takes.
         *
         * Measured on a synthetic 2,000 servers / 40,000 channels / 5,000
         * conversations, for somebody in ten servers:
         *
         *   as it was          56.65ms   40,002 rows built and thrown away
         *   these two           0.20ms      202 rows
         *
         * 290x, and 198x less garbage per sign-in. The `OR EXISTS` was also
         * what made an index impossible: one query asking two questions about
         * two different things that happen to share a table.
         *
         * Nothing about who sees what changes. Membership is already the
         * gate - canAccessChannel refuses a channel in a space somebody is
         * not a member of, and that is what the list below is filtered
         * through - so this asks the database the question the answer was
         * being filtered by anyway.
         */
        const everyChannel = channelsForClient(user.id) as unknown as
          Array<{ id: string; kind: string; space_id: string | null }>

        const allowed = new Map<string | null, boolean>()
        const channels = everyChannel.filter((c) => {
          if (c.kind !== 'text' && c.kind !== 'voice') return true
          const space = c.space_id ?? null
          if (!allowed.has(space)) allowed.set(space, mayViewIn(space))
          return allowed.get(space) === true
        })
        /*
         * Only people this person shares something with.
         *
         * This sent the whole user table. The HTTP route was scoped first and
         * that changed nothing anybody could see, because this is the list the
         * client actually reads - a fix in the wrong place looks exactly like
         * a fix, right up until somebody checks.
         */
        /*
         * Not the whole directory any more. See startingMembers: everybody a
         * server holds arrives when that server is opened, from the route the
         * client was already calling and already throwing the records away.
         */
        const members = startingMembers(user.id)
        // Who each conversation is with.
        //
        // The client was matching a channel name against the member list to
        // work out who a DM belonged to, which breaks the moment somebody
        // changes their display name, and says nothing at all about a group.
        // The membership is a fact the server holds already.
        /*
         * Only the conversations this person is in.
         *
         * This read the whole table — every conversation membership of every
         * account on the instance — and built a map of all of them, on every
         * connection. On a busy instance that is hundreds of thousands of
         * rows per person signing in, to answer a question about their own
         * twenty conversations. It also held other people's memberships in
         * memory for no reason at all.
         */
        const dmRows = db
          .prepare(
            /* The kind is a join on the containers primary key rather than an
               IN over a subquery: as a subquery it read every container on
               the instance to build the list, which is the same shape of
               waste this query was written to remove. */
            `SELECT m.container_id AS channel_id, m.user_id FROM container_members m
               JOIN containers k ON k.id = m.container_id AND k.kind IN ('dm', 'group')
              WHERE m.container_id IN (SELECT container_id FROM container_members WHERE user_id = ?)`
          )
          .all(user.id) as unknown as Array<{ channel_id: string; user_id: string }>
        const membersByChannel = new Map<string, string[]>()
        for (const row of dmRows) {
          const list = membersByChannel.get(row.channel_id) ?? []
          list.push(row.user_id)
          membersByChannel.set(row.channel_id, list)
        }
        /*
         * Conversations this person has closed.
         *
         * Closing a DM takes it off your list and nothing else - the messages
         * stay, the other person's list is untouched, and anything said in it
         * brings it straight back with its history. So it is filtered here,
         * per person, rather than being any kind of delete.
         */
        const closed = new Set(
          (db.prepare('SELECT container_id AS channel_id FROM container_members WHERE user_id = ? AND hidden_at IS NOT NULL')
            .all(user.id) as unknown as Array<{ channel_id: string }>).map((r) => r.channel_id)
        )

        // Private channels are filtered out of the list entirely. Somebody
        // who cannot enter a channel has no reason to know it exists.
        const reachable = accessibleChannelIds(user.id)
        const visible = (channels as unknown as Array<{ id: string; kind: string }>)
          .filter((c) => (isConversationKind(c.kind) || reachable.has(c.id)) && !closed.has(c.id))

        /**
         * Is this channel this person's to hear about at all?
         *
         * The one predicate for every list in `ready`, because three of them
         * used to answer it differently. The channel list was filtered and
         * the mention marks were filtered; the unread counts and the pin
         * marks were not - so a channel somebody cannot open still arrived
         * as an id with a number beside it, and the number said how much was
         * being said in a room they are not in. Nothing was drawn from it,
         * which is why it went unnoticed: a client cannot place a channel it
         * does not have. The id on the wire is the leak, not the badge.
         */
        const isMine = (id: string) =>
          reachable.has(id) || (isDirect(id) && dmMembers(id).includes(user.id))

        // When each channel last had anything said in it, so the client can put
        // the conversations being used at the top rather than making somebody
        // scroll an alphabet to find who they were just talking to.
        /*
         * Asked per channel, and only the ones being sent.
         *
         * This was one `GROUP BY channel_id` over every undeleted message in
         * the app - the same shape, on the same path, as the unread count
         * a few lines below that was rewritten for exactly this reason, and it
         * outlived that rewrite. Its plan is a search by `deleted_at` and a
         * temporary B-tree, so it is priced by the whole history of the server
         * and not by this person's channels: measured at 0.116ms on 551
         * messages, which is 21ms at a hundred thousand and 210ms at a
         * million, on every single connection. It also built a row for every
         * channel on the instance and then used the handful it wanted.
         *
         * One seek each instead, straight down idx_messages_channel, which
         * does not grow with how much has been said.
         */
        const newestIn = db.prepare(
          'SELECT MAX(created_at) AS at FROM messages WHERE channel_id = ? AND deleted_at IS NULL',
        )
        const lastByChannel = new Map<string, number>()
        for (const c of visible as unknown as Array<{ id: string }>) {
          const at = (newestIn.get(c.id) as unknown as { at: number | null } | undefined)?.at
          if (at !== null && at !== undefined) lastByChannel.set(c.id, at)
        }

        for (const c of visible as unknown as Array<
          { id: string; kind: string; created_at: number; members?: string[]; last_activity?: number }
        >) {
          if (isConversationKind(c.kind)) c.members = membersByChannel.get(c.id) ?? []
          // A conversation with nothing in it yet sorts by when it was made.
          c.last_activity = lastByChannel.get(c.id) ?? c.created_at
        }

        const readState = db
          .prepare('SELECT channel_id, last_read_at FROM read_state WHERE user_id = ?')
          .all(user.id)

        // Unread counts, worked out here rather than left to the client.
        //
        // The client started every session with nothing unread, so reading
        // on a phone left everything bold on a desktop. The server already
        // knows when each channel was last read; this is that fact turned
        // into a number somebody can see.
        //
        // A DM you have never opened still counts, because somebody started
        // it deliberately and the whole thing is unread - without this a new
        // conversation arrives with no badge at all, which reads as the
        // message never having been sent.
        //
        // A public channel never opened counts from nothing, because joining
        // a server should not present two thousand unread messages.
        /*
         * Counted per channel, and never past the cap.
         *
         * This was one GROUP BY over every message in the database, on every
         * connection: measured at 64ms with a hundred thousand messages in
         * it, walking every undeleted row to reach a number nobody reads
         * past two digits. It also counted channels this person cannot see
         * and threw those away afterwards.
         *
         * Two cheap steps instead. One row per channel says when its newest
         * message was and when this person last read it - no counting at all
         * - and only the channels where those disagree are counted, stopping
         * at the cap. 0.15ms on the same data, and it stops growing with the
         * server's history.
         */
        const unread = unreadFor(user.id)
        const unreadHere = unread.filter((r) => isMine(r.channelId))

        // Roles travel with `ready` because the member list needs them to
        // group and colour people, not only the settings screen.
        /*
         * Roles of the servers this person is in, not every role on the
         * machine. They colour and group the member list, so somebody else's
         * would have coloured people by a role they have never held.
         */
        const roles = db.prepare(
          `SELECT r.* FROM roles r
             JOIN container_members m ON m.container_id = r.space_id
            WHERE m.user_id = ?
            ${ROLE_ORDER_R}`
        ).all(user.id)
        /*
         * Who holds which role, in the servers this person is in.
         *
         * Every row in the app said who holds what in servers they have
         * never seen. The roles themselves are already scoped, so this was
         * also handing out assignments to roles the client cannot resolve.
         */
        const assignments = db.prepare(
          `SELECT mr.user_id, mr.role_id FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             JOIN container_members m ON m.container_id = r.space_id
            WHERE m.user_id = ?`
        ).all(user.id)
        /*
         * What they may do, per server, rather than one answer for all of them.
         *
         * A single set meant the original server's permissions everywhere, so
         * somebody who had just made their own would be offered none of its
         * settings - the panes are gated on this. Sent as a map because the
         * client switches servers without reconnecting.
         */
        const permissionsBySpace: Record<string, string[]> = {}
        /*
         * And the channels where that server-wide answer is not the answer.
         *
         * By server, and then by channel. A flat map would be smaller and
         * would make the client work out which server a channel is in every
         * time one server's answer is replaced - which is the lookup that
         * has to be right for a cleared rule to actually clear.
         *
         * Only the channels that differ, which in a server nobody has
         * overridden anything in is none of them - see channelPermissionsFor.
         */
        const channelPermissions: Record<string, Record<string, string[]>> = {}
        const categories: unknown[] = []
        /*
         * Where Text and Voice sit, per server.
         *
         * They hold whatever nobody has filed and are not rows in the
         * categories table, so their place in the order is kept on the space
         * instead. Sent alongside, because a client drawing the list has to
         * put all the headings in one order and cannot work these two out.
         */
        const looseOrder: Record<string, { text: number; voice: number }> = {}
        for (const row of db.prepare(
          `SELECT m.container_id AS space_id FROM container_members m
             JOIN containers k ON k.id = m.container_id
            WHERE m.user_id = ? AND k.kind = 'space'`)
          .all(user.id) as Array<{ space_id: string }>) {
          permissionsBySpace[row.space_id] = [...permissionsFor(user.id, row.space_id)]
          channelPermissions[row.space_id] = channelPermissionsFor(user.id, row.space_id)
          categories.push(...(db.prepare(
            'SELECT id, space_id, name, position, created_at FROM categories WHERE space_id IS ? ORDER BY position, created_at'
          ).all(row.space_id) as unknown[]))
          const at = db.prepare(
            'SELECT loose_text_pos AS text, loose_voice_pos AS voice FROM spaces WHERE id = ?'
          ).get(row.space_id) as unknown as { text: number; voice: number } | undefined
          looseOrder[row.space_id] = { text: at?.text ?? -2, voice: at?.voice ?? -1 }
        }

        send(socket, {
          t: 'ready', user, channels: visible, members, readState, unread: unreadHere, permissionsBySpace,
          /*
           * The headings the channel list is drawn under, for every server
           * this person is in. A category is a label on a list they are
           * already being sent, so there is nothing here to filter; the
           * client leaves out a heading with nothing under it, so one whose
           * channels are all private does not appear as an empty label
           * announcing that something is there.
           */
          categories,
          looseOrder,
          channelPermissions,
          /*
           * Channels where somebody has been named and has not read it yet.
           *
           * Sent with the unread counts because it answers the same question
           * one step further in: not only "is there something here" but "is
           * some of it about me". The browser used to decide this from live
           * messages alone, so a mention went unmarked the moment the tab was
           * reloaded.
           */
          /*
           * Through isMine, like every other list here. A role mention names
           * everybody holding the role, and a role can be held by somebody
           * who cannot see the channel it was used in - so this is where a
           * private channel would otherwise hand out its id.
           *
           * Filtered here rather than at the point of writing, so rows
           * already stored are covered too.
           */
          mentionChannels: unreadMentionChannels(user.id).filter(isMine),
          /*
           * Channels holding a pin this person has not looked at.
           *
           * Against channel_prefs.pins_seen_at rather than against read_state:
           * scrolling past the line announcing a pin is not the same as
           * having looked at what was pinned, and the icon is where a pin
           * lives once that line has scrolled away.
           *
           * A channel never opened counts, which is the point - somebody who
           * has never looked at the pins of a channel that has some has not
           * seen them.
           */
          pinChannels: (db.prepare(
            `SELECT DISTINCT m.channel_id AS channelId
               FROM messages m
               JOIN channels c ON c.id = m.channel_id
               LEFT JOIN channel_prefs p
                 ON p.channel_id = m.channel_id AND p.user_id = ?
              WHERE m.pinned_at IS NOT NULL
                AND m.deleted_at IS NULL
                AND (p.pins_seen_at IS NULL OR m.pinned_at > p.pins_seen_at)`
          ).all(user.id) as unknown as Array<{ channelId: string }>)
            .map((r) => r.channelId).filter(isMine),
          roles, assignments, online: onlineIdsFor(user.id),
          voice: voiceVisibleTo(user.id),
          /*
           * What this server will accept, so the client can refuse an
           * oversized file at once rather than pushing twenty-five megabytes
           * up a home connection to be told no at the far end.
           */
          limits: { uploadBytes: config.maxUploadBytes },
          /*
           * Muted channels and per-channel notification settings, so every
           * device this person signs in on agrees. Only the ones that say
           * something are sent - a channel with nothing set is the default
           * and does not need a row on the wire.
           */
          channelPrefs: channelPrefsFor(user.id),
          /*
           * Who is in each server used to be sent here, for every server at
           * once, so the member column could be drawn without asking. It is
           * the same multiplication as the directory itself - every person in
           * every server, on every connect - and the column only ever draws
           * one of them. It arrives with that server's people now, from the
           * one request that already fetches them.
           */
          /*
           * And what everybody is up to, so somebody who has just signed in
           * sees it rather than waiting for each of them to change track.
           */
          activities: activitiesVisibleTo(user.id),
          /*
           * Who this person has blocked.
           *
           * Sent rather than fetched because the client needs it before it
           * draws anything: a blocked person's messages in a shared server
           * are hidden by the reader's own client, and a list that arrives
           * a moment later means their words appear and then vanish.
           *
           * Bounded by how many people somebody has fallen out with, which
           * is a list of ids and is short. Only their own direction - who
           * has blocked THEM is nowhere on the wire, and is not a question
           * this server answers to anybody.
           */
          blocked: blockedBy(user.id),
        })
        })
        /*
         * Only to people who may be shown them. Was broadcast() - every
         * connect and every disconnect announced to every account on the
         * machine, including strangers.
         */
        /*
         * If a drop was waiting to be announced, it was wrong: they are back
         * inside the grace and nobody was ever told they had gone. Cancelled
         * before the announcement below, so the two cannot cross.
         */
        cancelOffline(user.id)
        pushAboutMember(user.id, { t: 'presence', userId: user.id, online: true }, socket)
        return
      }

      if (!client) return

      switch (msg.t) {
        /*
         * ---- activity: what this person is doing ----
         *
         * Asserted by their own machine, because nothing else can know it,
         * and repeated by this server only as far as cleanActivity allows.
         * Null means "nothing", which is also what a refusal comes out as -
         * being unable to say something is not worth an error to ten people.
         *
         * Rate limited on its own budget rather than the shared one. A track
         * position moves every second and a client that decided to say so
         * would otherwise spend the whole allowance that sending messages
         * needs. Twelve in a minute is a change of track every five seconds,
         * which is faster than anybody listens.
         */
        case 'activity': {
          if (!allow(`act:${client.user.id}`, 12, 60_000)) return
          /*
           * A list, or the single one an app released before this sends. Both
           * are read the same way, so a copy nobody has restarted keeps
           * reporting rather than quietly stopping.
           */
          const next = cleanActivities(msg.activities ?? msg.activity)
          const before = activities.get(client.user.id) ?? null
          if (next.length > 0) activities.set(client.user.id, next)
          else activities.delete(client.user.id)
          // Nothing changed, nothing said. A client repeating itself every
          // few seconds should cost the people watching nothing at all.
          if (JSON.stringify(before ?? []) === JSON.stringify(next)) return
          /*
           * To the people who may be shown this person, not to everybody
           * connected. A stranger who shares no server has no business
           * learning that this account exists, let alone what it is playing.
           */
          pushAboutMember(client.user.id, { t: 'activity', userId: client.user.id, activities: next })
          return
        }

        // ---- send: the optimistic-send counterpart ----
        // The client already rendered this message with `nonce`. We echo the
        // nonce back so it can swap the placeholder for the real row rather
        // than appending a duplicate.
        case 'send': {
          const body = String(msg.body ?? '').trim()
          const hasFiles = Array.isArray(msg.attachments) && msg.attachments.length > 0
          const nonce = msg.nonce ? String(msg.nonce).slice(0, 64) : null

          /**
           * Say no in a way the sender can hear.
           *
           * The client keeps every message until it is told the message
           * landed, and says them all again on reconnect. So a refusal that
           * went unmentioned - too long, no permission, a channel that is
           * gone - left the sender with a message marked unsent that would
           * be retried on every reconnect, for ever, and could never
           * possibly succeed. Refusing has to be said out loud.
           */
          const refuse = (detail: string): void => {
            if (nonce) send(socket, { t: 'send-refused', nonce, detail })
            else send(socket, { t: 'error', code: 'no_permission', detail })
          }

          if (!body && !hasFiles) return refuse('There was nothing to send.')
          if (body.length > 4000) {
            return refuse('That message is longer than 4000 characters.')
          }

          const channelId = String(msg.channelId)
          /* The slow mode with it: this asked for the id alone, so the
             column read below was always undefined and the setting did
             nothing at all. One row either way. */
          const channel = db.prepare(
            'SELECT id, slowmode_seconds FROM channels WHERE id = ?'
          ).get(channelId)
          if (!channel) return refuse('That channel no longer exists.')
          // Posting into a channel you cannot see would put a message
          // somewhere you could never read it - and tell everybody who can.
          if (!isDirect(channelId) && !canAccessChannel(client.user.id, channelId)) {
            return refuse('You cannot post in that channel.')
          }
          if (!may(client.user, 'send_messages', channelId)) {
            return refuse('You cannot send messages here.')
          }
          /*
           * Stopped from talking here, for a while.
           *
           * Before slow mode, because being timed out is a decision somebody
           * made about this person and slow mode is a property of the room -
           * told the wrong one first, somebody serving a timeout is told to
           * wait five seconds and tries again.
           *
           * Asked against the clock, so a timeout that has run out needs
           * nothing to have happened for it to be over.
           */
          if (!isDirect(channelId)) {
            const inSpace = spaceOfChannel(channelId)
            if (inSpace) {
              const until = timedOutUntil(inSpace, client.user.id)
              if (until > 0) {
                const mins = Math.ceil((until - Date.now()) / 60000)
                return refuse(
                  `You cannot send messages in this server for another ${mins} minute${mins === 1 ? '' : 's'}.`
                )
              }
            }
          }
          /*
           * Slow mode, where the channel is in it.
           *
           * Asked of this person's own last message rather than the channel's,
           * because a gap between everybody's messages is not slow mode - it
           * is one queue for the room, and one person typing would hold up
           * everybody else.
           *
           * Only where the channel is actually slowed: the common case is
           * nought, which costs the column already in hand and no query at
           * all. slowmode.ts holds the rule and is tested on its own.
           */
          const slow = (channel as unknown as { slowmode_seconds?: number }).slowmode_seconds ?? 0
          if (slow > 0 && !isDirect(channelId)) {
            const held = permissionsIn(client.user.id, channelId)
            if (!mayIgnoreSlowmode((p) => held.has(p as Permission))) {
              const last = db.prepare(
                `SELECT created_at AS at FROM messages
                  WHERE channel_id = ? AND author_id = ? AND deleted_at IS NULL
                  ORDER BY created_at DESC LIMIT 1`
              ).get(channelId, client.user.id) as { at?: number } | undefined
              const left = waitLeft({
                seconds: slow, lastAt: last?.at ?? 0, exempt: false, now: Date.now(),
              })
              if (left > 0) return refuse(slowmodeMessage(left))
            }
          }
          /*
           * Who is in this conversation, asked once.
           *
           * Both the membership check and the block check below need it, and
           * both used to ask separately - a second query per message on the
           * hot path, for an answer that cannot have changed in between.
           * Measured on this machine: 44.5us a message, against 68us for the
           * block check itself and 33.5us for the channel lookup above. Two
           * thirds of what the block cost was the asking twice.
           */
          const talking = isDirect(channelId) ? dmMembers(channelId) : null
          if (talking && !talking.includes(client.user.id)) {
            return refuse('That conversation is not yours.')
          }
          /*
           * And not into a conversation with somebody who is blocked.
           *
           * Refused here rather than delivered and hidden by the other
           * client. Hiding it would leave the message written down, counted
           * in their unread badge, and waiting for the day the block is
           * lifted - which is not what blocking somebody means, and is
           * worse than useless if the reason for the block was what they
           * were saying.
           *
           * Only for a conversation between two people. A group is other
           * people's as well, and one member's block is not a veto on what
           * everybody else can read; a shared server's channel is the same
           * argument, larger. Those are hidden by the reader's own client,
           * which is the only place a one-sided decision belongs.
           *
           * Said out loud to the sender, because a message that vanishes
           * silently is retried on every reconnect for ever.
           */
          if (talking) {
            /* Lifted out of the closure below, which loses the narrowing
               that says this client is still connected. */
            const me = client.user.id
            const others = talking.filter((id) => id !== me)
            if (others.length === 1 && blockedBetween(me, others[0]!)) {
              return refuse('You cannot send messages to them.')
            }
          }
          // In the channel being posted to. Asked without one, this was
          // answered by the first server in the app - so whether you may
          // ping everybody here depended on your roles somewhere else.
          /*
           * Decided once, here, and handed to the mention recorder below.
           * Asking a second time invites two answers that can disagree, and
           * this is the one that already refuses the message.
           */
          const mayBroadcast = may(client.user, 'mention_everyone', channelId)
          if (/@everyone\b/.test(body) && !mayBroadcast) {
            return refuse('You cannot mention everyone.')
          }
          if (hasFiles && !may(client.user, 'attach_files', channelId)) {
            return refuse('You cannot attach files.')
          }

          /**
           * The same send, arriving twice, is one message.
           *
           * A client that gets no answer has to be able to ask again - that
           * is the whole of making sending reliable - and without this the
           * second attempt would post a second copy. Matched on the sender's
           * own id, so nobody can suppress anybody else's message by
           * guessing one.
           */
          if (nonce) {
            const already = db
              .prepare(`SELECT id, deleted_at FROM messages
                        WHERE author_id = ? AND nonce = ? AND created_at > ?`)
              .get(client.user.id, nonce, Date.now() - REPEAT_WINDOW_MS) as
              unknown as { id: string; deleted_at: number | null } | undefined
            if (already) {
              /**
               * Answered rather than ignored: the client is waiting to be
               * told this landed, and being told once is what it needs.
               *
               * Deleted counts as landed. Bringing it back because the
               * sender's connection stuttered would undo a deletion nobody
               * asked to undo, and posting a fresh copy would be worse - so
               * it is acknowledged with nothing, and the client drops its
               * placeholder.
               */
              send(socket, {
                t: 'ack',
                nonce,
                message: already.deleted_at === null
                  ? hydrateOne(already.id, client.user.id)
                  : null,
              })
              return
            }
          }

          const row = {
            id: randomUUID(),
            channel_id: String(msg.channelId),
            author_id: client.user.id,
            body,
            reply_to: msg.replyTo ? String(msg.replyTo) : null,
            created_at: Date.now(),
            edited_at: null,
          }
          db.prepare(
            `INSERT INTO messages (id, channel_id, author_id, body, reply_to, created_at, nonce)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(row.id, row.channel_id, row.author_id, row.body, row.reply_to, row.created_at, nonce)

          /*
           * Who it named, written down beside it.
           *
           * The browser worked this out on arrival and kept it in a Set, so a
           * mention nobody had looked at yet died with the tab. Recorded here
           * it outlives the session, which is what lets a channel - and the
           * server it is in - keep their mark until it has actually been read.
           *
           * The broadcast permission was decided above, on this message, so
           * the answer is handed on rather than asked a second time: two
           * checks that could disagree is one too many.
           */
          try {
            recordMentions(row.id, row.channel_id, mentionedBy(row.body, {
              channelId: row.channel_id,
              spaceId: spaceOfChannel(row.channel_id),
              authorId: row.author_id,
              broadcastAllowed: mayBroadcast,
              audience: audienceOf(row.channel_id),
            }))
          } catch (err) {
            // A message arriving without its mark is far better than a message
            // refused because working the mark out went wrong.
            console.error('[mentions] could not record:', err)
          }

          /*
           * Anything said reopens the conversation for everybody in it.
           *
           * Closing a DM is a fact about a list, not about the conversation,
           * so a new message has to undo it - otherwise somebody who tidied
           * their sidebar last week silently stops receiving from that person
           * and has no way of knowing. This is also what makes closing safe
           * to offer: it can always be undone by saying something.
           */
          setConversationClosed(null, String(row.channel_id), null)

          /*
           * Attach the files this person uploaded, and only those.
           *
           * The comment that used to sit here said the ids were checked. They
           * were not, and could not be - nothing wrote down who had uploaded
           * what, so this took the path out of the message and believed it.
           * Any member could name any file already on this server, including
           * one from a channel they cannot see.
           *
           * The sharp end was deletion rather than reading. A file is kept
           * while any message still points at it, quite rightly, because two
           * messages can share an imported GIF - so attaching somebody else's
           * path to a message of your own meant their delete stopped
           * deleting: the message went and the picture carried on being
           * served from yours.
           *
           * Everything about the file now comes from the ledger rather than
           * from the message: the name, the type and the size. What is still
           * taken from the client is what only describes it - the label, the
           * dimensions the browser measured, and whether it was picked from
           * the GIF panel.
           */
          const files = Array.isArray(msg.attachments) ? msg.attachments.slice(0, 10) : []
          for (const f of files) {
            if (!f?.url) continue

            // The stored name, off the path this server issued - never the
            // whole string that came back, which carries a signature.
            const stored = (String(f.url).split('?')[0] ?? '').split('/').pop() ?? ''
            const claim = stored ? uploadClaim(stored, client.user.id) : null
            if (!claim) {
              /*
               * Said out loud rather than dropped.
               *
               * Silently sending the message without the picture looks like
               * the upload failed and invites somebody to try again, which
               * will fail the same way. This is also what an ordinary client
               * hits when its upload has been swept for sitting unsent for an
               * hour, and that is worth being told.
               */
              return refuse('That file is not one you uploaded, or it is no longer here.')
            }
            /*
             * The small copy, checked exactly as the picture was.
             *
             * It is another file this person uploaded, so it goes through the
             * same claim: a client cannot point a thumbnail at somebody
             * else's file, or at a path it invented. Anything that does not
             * check out is simply left off - a missing thumbnail costs a
             * larger download and nothing else, so there is no reason to
             * refuse the whole message over one.
             */
            const thumbName = f.thumb
              ? (String(f.thumb).split('?')[0] ?? '').split('/').pop() ?? ''
              : ''
            const thumbOk = thumbName && uploadClaim(thumbName, client.user.id)
            /*
             * Where this came from, written down rather than left to be
             * worked out later by joining three tables.
             *
             * The channel is the one the message went to, and the server is
             * that channel's - null in a conversation, which has none. The
             * uploader is the sender: the claim above already refused any
             * file they did not upload themselves.
             */
            const inSpace = (db
              .prepare('SELECT space_id FROM channels WHERE id = ?')
              .get(row.channel_id) as unknown as { space_id: string | null } | undefined)
              ?.space_id ?? null
            db.prepare(
              `INSERT INTO attachments
                 (id, message_id, filename, mime, bytes, width, height, path, is_gif,
                  thumb_path, space_id, channel_id, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              /*
               * Our id, not theirs.
               *
               * This was the client's own string going straight into a
               * primary key - so a repeated one made the insert throw in the
               * middle of accepting a message, leaving the message written
               * and no acknowledgement sent.
               */
              randomUUID(), row.id, String(f.filename ?? 'file').slice(0, 200),
              claim.mime, claim.bytes,
              f.width ? Number(f.width) : null, f.height ? Number(f.height) : null,
              // Built here from the name we just checked, rather than taken
              // from the message. The signature the client returns must never
              // reach the table: the sweeper and the serving check both
              // expect a plain path and would stop recognising the file.
              `/uploads/${stored}`,
              /*
               * Taken from the client, and safe to. It decides whether a
               * filename is drawn under the picture and nothing else - the
               * worst a client can do by lying is hide its own file's name
               * from itself.
               */
              /*
               * Either spelling.
               *
               * This read `isGif` and the client sends `is_gif`, so the flag
               * arrived as undefined and every GIF was stored as an ordinary
               * file - which the client then drew as a video with its
               * filename written underneath, rather than as the picture it
               * is. Exactly the shape of the `url` trap noted above: a key
               * under the wrong name is not refused, it is skipped, and
               * nothing anywhere says so. Both are accepted rather than
               * picking one and leaving the other silently wrong.
               */
              (f.isGif ?? f.is_gif) ? 1 : 0,
              /* Built from the checked name, like the path above - never the
                 signed string the client handed back. */
              thumbOk ? `/uploads/${thumbName}` : null,
              inSpace, row.channel_id, client.user.id,
            )
          }

          const full = hydrateOne(row.id, client.user.id)
          send(socket, { t: 'ack', nonce, message: full })
          toChannel(row.channel_id, { t: 'message', message: full }, socket)
          return
        }

        case 'react': {
          const messageId = String(msg.messageId ?? '')
          const emoji = String(msg.emoji ?? '').slice(0, 24)
          if (!messageId || !emoji) return

          const owner = db.prepare(
            'SELECT channel_id FROM messages WHERE id = ? AND deleted_at IS NULL'
          ).get(messageId) as unknown as { channel_id: string } | undefined
          if (!owner) return
          // After the lookup, because the answer depends on which server the
          // message is in and that is not known until we have found it.
          if (!may(client.user, 'add_reactions', owner.channel_id)) return
          if (isDirect(owner.channel_id)) {
            if (!dmMembers(owner.channel_id).includes(client.user.id)) return
          } else if (!canAccessChannel(client.user.id, owner.channel_id)) {
            return
          }

          const existing = db
            .prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
            .get(messageId, client.user.id, emoji)

          if (existing) {
            db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
              .run(messageId, client.user.id, emoji)
          } else {
            db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
              .run(messageId, client.user.id, emoji, Date.now())
          }

          // Each client needs its own `me` flag - which is the one thing
          // that differs, so the row is built once and only the flags are
          // answered per person.
          toChannelHydrated(owner.channel_id, messageId, 'message-update')
          return
        }

        case 'edit': {
          const messageId = String(msg.messageId ?? '')
          const body = String(msg.body ?? '').trim()
          if (!messageId || !body || body.length > 4000) return

          const owned = db
            .prepare('SELECT 1 FROM messages WHERE id = ? AND author_id = ? AND deleted_at IS NULL')
            .get(messageId, client.user.id)
          if (!owned) return

          db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?')
            .run(body, Date.now(), messageId)
          const where = db.prepare(
            'SELECT channel_id FROM messages WHERE id = ? AND deleted_at IS NULL'
          ).get(messageId) as unknown as { channel_id: string } | undefined
          if (!where) return

          /*
           * Who it names, worked out again from the new words.
           *
           * Found by audit. An edit rewrote the body and left the mention rows
           * exactly as they were, so both directions were wrong: adding a name
           * left that person unmarked, and - worse - taking one out left the
           * badge behind, pointing at a mention that no longer existed
           * anywhere in the text.
           *
           * Cleared and rewritten rather than added to, because the whole
           * point is that the old answer may no longer be true.
           */
          try {
            db.prepare('DELETE FROM mentions WHERE message_id = ?').run(messageId)
            recordMentions(messageId, where.channel_id, mentionedBy(body, {
              channelId: where.channel_id,
              spaceId: spaceOfChannel(where.channel_id),
              authorId: client.user.id,
              broadcastAllowed: may(client.user, 'mention_everyone', where.channel_id),
              audience: audienceOf(where.channel_id),
            }))
          } catch (err) {
            console.error('[mentions] could not update on edit:', err)
          }

          toChannelHydrated(where.channel_id, messageId, 'message-update')
          return
        }

        case 'delete': {
          const messageId = String(msg.messageId ?? '')
          const row = db.prepare(
            'SELECT author_id, channel_id, kind FROM messages WHERE id = ? AND deleted_at IS NULL'
          ).get(messageId) as unknown as
            { author_id: string; channel_id: string; kind: string } | undefined
          if (!row) return

          /*
           * The line saying somebody pinned something is the one message
           * nobody wrote, and clearing it up is what the pin permission says
           * it allows - so manage_pins is enough for that line and nothing
           * else. Without this the client offered the menu and the server
           * quietly ignored it, which is worse than not offering it.
           *
           * Still only that kind. Being allowed to tidy up an announcement is
           * not being allowed to delete what people actually said.
           */
          const mine = row.author_id === client.user.id
          const housekeeping = row.kind === 'pin' && may(client.user, 'manage_pins', row.channel_id)
          if (!mine && !housekeeping && !may(client.user, 'manage_messages', row.channel_id)) return
          if (!mine) writeAudit(client.user.id, 'message.delete', messageId, spaceOfChannel(row.channel_id))

          /**
           * Marked rather than removed.
           *
           * It disappears for everybody straight away, which is the point of
           * pressing delete, but the row and its files survive long enough to
           * be put back. The sweep below finishes the job.
           */
          db.prepare('UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?')
            .run(Date.now(), client.user.id, messageId)
          toChannel(row.channel_id, { t: 'message-delete', id: messageId })
          return
        }

        /**
         * Put it back, if it has not been gone long.
         *
         * Whoever pressed delete, and nobody else. Keying this on the author
         * was wrong twice over: it let somebody reverse a moderator's
         * decision about their own message, and it stopped a moderator
         * taking back a deletion they had just made by mistake.
         */
        case 'undelete': {
          const messageId = String(msg.messageId ?? '')
          const row = db.prepare(
            'SELECT deleted_by, channel_id, deleted_at FROM messages WHERE id = ?'
          ).get(messageId) as unknown as
            { deleted_by: string | null; channel_id: string; deleted_at: number | null } | undefined
          if (!row || row.deleted_at === null) return
          if (row.deleted_by !== client.user.id) return
          if (Date.now() - row.deleted_at > UNDO_MS) return

          db.prepare('UPDATE messages SET deleted_at = NULL, deleted_by = NULL WHERE id = ?')
            .run(messageId)
          toChannelHydrated(row.channel_id, messageId, 'message-restore')
          return
        }

        // ---- voice ----
        case 'voice-join': {
          const channelId = String(msg.channelId ?? '')
          if (!channelId) return

          /**
           * A call in a DM registers here like any other room.
           *
           * It used to be refused twice over - once for not being kind
           * 'voice', and once because canAccessChannel says no to every DM
           * by design. So a call had audio and nothing else: the server
           * never knew the two of them were in a room together, which meant
           * the sharing flag went nowhere and rtc-signal dropped every offer
           * for being between two people who, as far as it could tell, were
           * not in a call at all. Sharing a screen in a DM could not have
           * worked, whatever the buttons said.
           *
           * Membership is the whole permission, exactly as it is for the
           * token: being in the conversation is what entitles you to the
           * call in it.
           */
          if (isDirect(channelId)) {
            if (!dmMembers(channelId).includes(client.user.id)) return
          } else {
            /*
             * Or having been put here by somebody who may move people.
             *
             * The move sets where they are before telling them, so by the
             * time their app announces the join this is already true. Without
             * it the move would land and the announcement would be refused a
             * moment later, which is the stranding the old refusal avoided by
             * never moving anybody at all.
             */
            if (!canBeInVoice(client.user.id, channelId)) return
            const channel = db.prepare("SELECT id FROM channels WHERE id = ? AND kind = 'voice'")
              .get(channelId)
            if (!channel) return
            /*
             * And that they may use channels in this server at all - the
             * server-wide answer, deliberately, not this channel's.
             *
             * The line above is where the channel gets its say, and it says
             * more than view_channels does: somebody carried in by a
             * moderator cannot see the room they are being put in, by
             * definition. Asking the channel again here refused exactly the
             * person that line had just admitted - so the join was dropped,
             * the pass that let them in was never spent, and they sat
             * outside a call they had been moved into.
             */
            if (!permissionsFor(client.user.id, spaceOfChannel(channelId))
              .has('view_channels')) return
          }

          // A move keeps the share: the client never stopped capturing, so
          // clearing the flag here would hide a live screen from everybody in
          // the channel they moved into. voice-update corrects it within a
          // frame if they really did stop.
          reconnecting.delete(client.user.id)
          // Spent. From here it is being in the call that keeps them in it.
          if (passes.get(client.user.id)?.channelId === channelId) {
            passes.delete(client.user.id)
          }
          const already = voice.get(client.user.id)
          voice.set(client.user.id, {
            channelId,
            muted: Boolean(msg.muted),
            deafened: Boolean(msg.deafened),
            sharing: already?.sharing ?? false,
            shareQuality: already?.shareQuality ?? null,
            camera: already?.camera ?? false,
            /* Kept across a rejoin: somebody whose connection blinked was
               watching the same thing a moment ago and still is. */
            watching: already?.watching ?? [],
          })
          // Somebody came back, so the call is not ending after all. Only
          // conversations count down; a server's voice channel is somewhere
          // to sit, and sitting in one alone is not a call running out.
          if (isDirect(channelId)) callStillGoing(channelId)
          announceVoice()
          return
        }

        case 'voice-leave': {
          const told = reconnecting.get(client.user.id)
          if (told !== undefined && Date.now() - told < RECONNECT_GRACE_MS) {
            /**
             * Almost certainly the reconnect we asked for - but somebody who
             * really does leave right after being muted would otherwise sit
             * in the list forever. So decide once the window closes instead
             * of believing either story now: coming back clears the entry,
             * and if nothing has, the departure was real.
             */
            const who = client.user.id
            setTimeout(() => {
              if (!reconnecting.has(who)) return
              reconnecting.delete(who)
              forgetStills(who)
              /* Read before the delete, like the path below - and the call
                 has to be asked about here too. This branch dropped somebody
                 from the room and never checked whether that left the room
                 empty, so a call ended this way never ended at all. */
              const wasIn = voice.get(who)?.channelId
              if (voice.delete(who)) {
                if (wasIn && isDirect(wasIn)) callMayBeOver(wasIn)
                announceVoice()
              }
            }, Math.max(0, RECONNECT_GRACE_MS - (Date.now() - told)) + 500)
            return
          }
          forgetStills(client.user.id)
          // Read before the delete, or there is nothing left to ask about.
          const leaving = voice.get(client.user.id)?.channelId
          if (!voice.delete(client.user.id)) {
            /*
             * Not in the map, but a call may still be open here.
             *
             * Somebody who rang and hung up before anybody answered was never
             * counted as being in the room, so this returned and left the row
             * open - "Join call" on a call with nobody in it, for ever.
             */
            const ringing = liveCallRowChannelFor(client.user.id)
            if (ringing) callMayBeOver(ringing)
            return
          }
          if (leaving && isDirect(leaving)) callMayBeOver(leaving)
          announceVoice()
          return
        }

        case 'voice-update': {
          const current = voice.get(client.user.id)
          if (!current) return
          if (typeof msg.muted === 'boolean') current.muted = msg.muted
          if (typeof msg.deafened === 'boolean') current.deafened = msg.deafened
          if (typeof msg.sharing === 'boolean') {
            // A picture of a desktop outlives the share by exactly nothing.
            if (current.sharing && !msg.sharing) forgetStills(client.user.id)
            current.sharing = msg.sharing
            // And neither does the quality it was being sent at: left behind,
            // it would sit on a tile describing a share that had ended.
            if (!msg.sharing) current.shareQuality = null
          }
          /*
           * Only while they are actually sharing, so this cannot depend on
           * which order the two fields happen to be read in - and a quality
           * arriving alongside "I stopped" does not resurrect the badge.
           */
          if (!current.sharing) {
            current.shareQuality = null
          } else if (typeof msg.shareQuality === 'string' && SHARE_QUALITIES.has(msg.shareQuality)) {
            current.shareQuality = msg.shareQuality
          } else if (msg.shareQuality === null) {
            current.shareQuality = null
          }
          if (typeof msg.camera === 'boolean') current.camera = msg.camera
          announceVoice()
          return
        }

        // ---- screen share signalling ----
        //
        // Screen shares go directly between the two people, not through this
        // server: on a home connection the server would otherwise have to
        // upload a full copy of the screen to every single viewer, and that
        // is the thing that falls over first.
        //
        // All the server does here is carry the introductions. The payload is
        // opaque - an SDP offer, an answer, or an ICE candidate - and it is
        // never inspected, only handed to the one person it is addressed to.
        case 'rtc-signal': {
          const to = String(msg.to ?? '')
          if (!to || to === client.user.id) return

          // Both ends must be sitting in the same voice channel. Without this
          // the relay would forward WebRTC offers to anybody on the server,
          // which is a way to be rung by someone you are not in a call with.
          const mine = voice.get(client.user.id)
          const theirs = voice.get(to)
          if (!mine || !theirs || mine.channelId !== theirs.channelId) return

          // The payload is never inspected, so its size is the only thing we
          // can judge it by. A full SDP offer is a few kB; an ICE candidate is
          // a couple of hundred bytes.
          if (JSON.stringify(msg.data ?? null).length > 16_384) return

          // A tighter budget than the general one: negotiating a screen share
          // is a few dozen messages, not thousands.
          if (!allow(`rtc:${client.user.id}`, 120, 10_000)) return

          pushToUsers([to], {
            t: 'rtc-signal',
            from: client.user.id,
            channelId: mine.channelId,
            data: msg.data,
          })
          return
        }

        case 'voice-moderate': {
          const targetId = String(msg.userId ?? '')
          if (!targetId) return
          /*
           * Server mute and deafen are moderation, not a personal preference:
           * they need a permission, and they are written to the audit log.
           *
           * The permission is claimed in the room they are actually in. Asked
           * without a channel it was answered by the first server, so holding
           * manage_messages there let you silence somebody in a server you
           * are not in - and holding it only in your own server did not let
           * you moderate your own.
           */
          /**
           * Lifting a mute must work on somebody the server cannot see.
           *
           * Requiring them to be in a voice channel meant that anyone who
           * dropped out of the occupancy list while muted stayed muted, with
           * no way back: the mute lives here, not in their session. Applying
           * one still needs them present, so it cannot be used on somebody
           * who is not in a call.
           */
          const lifting = msg.serverMuted === false || msg.serverDeafened === false
          /**
           * And not into a private call.
           *
           * Registering DM calls made everybody on one reachable by this for
           * the first time, which is not what a moderator of a space is for.
           * Lifting still works from anywhere - that is the escape hatch
           * above, and taking it away would strand people.
           */
          const room = voice.get(targetId)
          if (!lifting && (!room || isDirect(room.channelId))) return

          /*
           * Which server this is about, and it is never taken on trust.
           *
           * A mute belongs to one server. When they are sitting in a room,
           * that room decides - a moderator cannot claim to be acting
           * somewhere the person is not. Only lifting, which has to reach
           * somebody who is not in a call at all, falls back to the server
           * the moderator says they are in, and that claim is checked like
           * any other: both the permission and the ranking are measured
           * there, and they have to be in it.
           *
           * Asked without any server at all, this used to fall through to
           * the first one - so holding manage_messages there let you silence
           * somebody in a server you are not in.
           */
          const where = room ? spaceOfChannel(room.channelId) : (String(msg.spaceId ?? '') || null)
          const refuse = (detail: string) => {
            send(socket, { t: 'error', code: 'no_permission', detail })
            return
          }
          if (!where) return refuse('You cannot moderate voice.')
          /* mute_members, not manage_messages: this is a voice room, and
             tidying a channel is not the same trust as silencing somebody
             mid-sentence. Every role that held the old one was given the new
             one at migration, so nobody lost the ability. */
          if (!permissionsFor(client.user.id, where).has('mute_members')) {
            return refuse('You cannot moderate voice.')
          }
          // And somebody can only be moderated in a server they are in.
          if (!isSpaceMember(targetId, where)) return refuse('They are not in that server.')

          // Permission says you may moderate; rank says who. Without this a
          // moderator can silence the owner by sending the frame by hand.
          if (!outranks(client.user.id, targetId, where)) {
            send(socket, { t: 'error', code: 'outranked', detail: 'You cannot moderate them.' })
            return
          }

          const key = modKey(where, targetId)
          if (typeof msg.serverMuted === 'boolean') {
            if (msg.serverMuted) serverMutes.add(key)
            else serverMutes.delete(key)
            // Either way, it is now a decision in its own right.
            impliedMutes.delete(key)
            rememberModeration(where, targetId)
            writeAudit(client.user.id, msg.serverMuted ? 'voice.mute' : 'voice.unmute', targetId, where)
          }
          if (typeof msg.serverDeafened === 'boolean') {
            if (msg.serverDeafened) {
              serverDeafens.add(key)
              // Noted as implied only if they were not already muted, so
              // lifting a deafen can never undo a mute somebody meant.
              if (!serverMutes.has(key)) impliedMutes.add(key)
              serverMutes.add(key)
            } else {
              serverDeafens.delete(key)
              if (impliedMutes.delete(key)) serverMutes.delete(key)
            }
            rememberModeration(where, targetId)
            writeAudit(client.user.id, msg.serverDeafened ? 'voice.deafen' : 'voice.undeafen', targetId, where)
          }

          // The target has to re-mint a token for the new grant to bite, so
          // tell them to reconnect their media rather than only repainting.
          reconnecting.set(targetId, Date.now())
          pushToUsers([targetId], { t: 'voice-regrant' })
          announceVoice()
          return
        }

        case 'voice-disconnect-member': {
          // Either permission: move_members is the one that means this, and
          // manage_messages is what it used to require, so nobody who could
          // do this yesterday is refused today.
          const targetId = String(msg.userId ?? '')
          // In their room, not in the first server in the app.
          const theirRoom = voice.get(targetId)?.channelId
          if (!may(client.user, 'move_members', theirRoom)
            && !may(client.user, 'manage_messages', theirRoom)) return
          if (!outranks(client.user.id, targetId, spaceOfVoice(targetId))) return
          // Not somebody's private call. Moving people out of the channels
          // of a server is moderation; reaching into a conversation between
          // two people and hanging it up is not something this grants.
          const where = voice.get(targetId)
          if (!where || isDirect(where.channelId)) return
          if (!voice.delete(targetId)) return
          forgetStills(targetId)
          writeAudit(client.user.id, 'voice.disconnect', targetId, spaceOfChannel(where.channelId))
          pushToUsers([targetId], { t: 'voice-kick' })
          announceVoice()
          return
        }

        /**
         * Move somebody into another voice channel.
         *
         * The server records the move and tells them to reconnect, because a
         * voice channel is a LiveKit room: nothing actually moves until their
         * own client joins the new one. Recording it here as well is what
         * makes everybody else's list update at once rather than a second
         * later.
         */
        case 'voice-move-member': {
          // In the room they are being moved out of. The destination is
          // checked separately, against their own access to it.
          if (!may(client.user, 'move_members',
            voice.get(String(msg.userId ?? ''))?.channelId)) {
            send(socket, { t: 'error', code: 'no_permission', detail: 'You cannot move people between voice channels.' })
            return
          }
          const targetId = String(msg.userId ?? '')
          const channelId = String(msg.channelId ?? '')
          const current = voice.get(targetId)
          if (!current || current.channelId === channelId) return
          // Dragging somebody out of a private call and into a channel where
          // other people are listening is not a move, it is an ambush.
          if (isDirect(current.channelId)) return
          if (!outranks(client.user.id, targetId, spaceOfVoice(targetId))) {
            send(socket, { t: 'error', code: 'outranked', detail: 'You cannot move them.' })
            return
          }

          const channel = db.prepare("SELECT id FROM channels WHERE id = ? AND kind = 'voice'")
            .get(channelId) as { id: string } | undefined
          if (!channel) return

          /*
           * Into a channel they cannot otherwise see, on purpose.
           *
           * This used to be refused because moving somebody somewhere they
           * cannot see would strand them there - true, and the thing to fix
           * rather than the reason not to. Being placed in a call is now
           * itself the permission to be in it, for exactly as long as they
           * are there, so there is nothing to be stranded by.
           *
           * Membership of the server is still required, and is a different
           * question: somebody who is not in the server at all has no
           * business in a room inside it, and nobody moved them there by
           * accident.
           */
          const target = db.prepare('SELECT id, role FROM users WHERE id = ?')
            .get(targetId) as { id: string; role: string } | undefined
          if (!target) return
          const into = spaceOfChannel(channelId)
          if (!isSpaceMember(target.id, into)) {
            send(socket, { t: 'error', code: 'no_access', detail: 'They are not in that server.' })
            return
          }

          current.channelId = channelId
          passes.set(targetId, { channelId, until: Date.now() + PASS_MS })
          writeAudit(client.user.id, 'voice.move', `${targetId} -> ${channelId}`, spaceOfChannel(channelId))
          pushToUsers([targetId], { t: 'voice-moved', channelId })
          announceVoice()
          return
        }

        /*
         * What this person is watching now.
         *
         * The whole list rather than one key added or removed: two changes
         * arriving out of order cannot then leave the server believing
         * somebody is watching something they closed.
         *
         * Bounded, because it arrives from outside — a client claiming to
         * watch ten thousand things would otherwise be ten thousand strings
         * held per connection and sent to everybody in the room.
         */
        case 'watching': {
          const state = voice.get(client.user.id)
          if (!state) return
          const asked: unknown[] = Array.isArray(msg.keys) ? msg.keys : []
          state.watching = asked
            .filter((k): k is string => typeof k === 'string' && k.length <= 80)
            .slice(0, 32)
          announceVoice()
          return
        }

        // ---- call signalling ----
        // Media is not wired up yet, but ringing, accepting and declining are
        // real: they are just routed events between two members.
        case 'call-ring':
        case 'call-cancel':
        case 'call-accept':
        case 'call-decline': {
          const target = String(msg.to ?? '')
          if (!target || target === client.user.id) return

          /*
           * Only somebody you can actually see.
           *
           * This delivered the ring to whatever user id it was handed, so
           * anybody who could learn an id - everyone sharing any server with
           * them - could make a stranger's app ring, from a server that
           * stranger is not in. The same rule the member list uses: a shared
           * server, a friendship, or a conversation.
           */
          if (!canSeeMember(client.user.id, target)) return

          /*
           * And not somebody either of you has blocked.
           *
           * Ringing is the loudest thing one account can do to another - it
           * makes a noise on a machine somebody may not be sitting at - so
           * it is the single thing a block most obviously has to stop.
           *
           * Silently, like every other refusal on this path. The caller
           * gets call-unavailable below, which is what they would get if
           * the person were offline, and that is the honest answer: this
           * call is not going to connect. Which of the two blocked the
           * other is nobody's business but theirs.
           */
          if (blockedBetween(client.user.id, target)) {
            if (msg.t === 'call-ring') send(socket, { t: 'call-unavailable', to: target })
            return
          }

          /*
           * Write the call into the conversation.
           *
           * Ringing starts a row; hanging up, cancelling or declining ends
           * it. A call that ends without ever being accepted is a missed one,
           * which is the whole reason this exists - somebody who was away had
           * no way of knowing anybody had rung.
           */
          const dm = msg.t === 'call-ring'
            ? dmBetweenOrMake(client.user.id, target)
            : dmBetween(client.user.id, target)
          if (dm) {
            if (msg.t === 'call-ring') openCallRow(dm, client.user.id)
            if (msg.t === 'call-accept') answerCallRow(dm)
            if (msg.t === 'call-cancel' || msg.t === 'call-decline') endCallRow(dm, true)
          }

          const event = {
            t: msg.t === 'call-ring' ? 'call-incoming' : msg.t,
            from: client.user.id,
            to: target,
          }
          // Delivered to every socket that member has open, so the call
          // reaches whichever window they are actually looking at.
          let delivered = false
          for (const c of clients) {
            if (c.user.id !== target) continue
            send(c.socket, event)
            delivered = true
          }
          if (!delivered && msg.t === 'call-ring') {
            send(socket, { t: 'call-unavailable', to: target })
          }
          /**
           * Their own other windows, so answering in one stops the rest
           * ringing. Told as a cancellation, which is what it is from those
           * windows' point of view: this is not the one on the call.
           *
           * Never back to the socket it came from. That client has already
           * acted, and reading its own frame back made it treat itself as
           * the other party - so accepting a call opened a conversation with
           * yourself, joined the call in that, and walked straight back out
           * of the call you had just answered. The person who rang you then
           * watched you vanish from the room a second after you picked up.
           */
          if (msg.t !== 'call-ring') {
            for (const c of clients) {
              if (c.user.id !== client.user.id || c.socket === socket) continue
              send(c.socket, { t: 'call-cancel', from: target, to: client.user.id })
            }
          }
          return
        }

        /*
         * A still from somebody's screen share, for the hover preview.
         *
         * "LIVE" next to a name tells you a stream exists and nothing about
         * whether it is worth walking into. The picture is the whole point:
         * you look, and you know whether they are on the film or still
         * picking one.
         *
         * Asked for rather than pushed. A share nobody is hovering over
         * costs nothing at all, which matters when the answer is a JPEG and
         * the sharer is already sending video over the same connection.
         */
        case 'share-still-want': {
          const target = String(msg.userId)
          // Only for a share you would have been shown anyway - the same
          // rule the occupancy list follows, or a hover becomes a way to
          // look inside a call you are not in.
          const visible = voiceVisibleTo(client.user.id).find((o) => o.userId === target)
          if (!visible?.sharing) return

          const cached = stills.get(target)
          if (cached && Date.now() - cached.at < STILL_FRESH_MS) {
            if (!mayServeStill(client.user.id, target)) return
            send(socket, { t: 'share-still', userId: target, image: cached.image })
            tellSharer(target, client.user.id)
            return
          }

          // Remember who is waiting, so the frame goes to them when it
          // arrives. Several people hovering at once share one capture.
          let waiting = stillWaiters.get(target)
          if (!waiting) stillWaiters.set(target, waiting = new Set())
          waiting.add(client.user.id)

          if (Date.now() - (stillAsked.get(target) ?? 0) < STILL_ASK_MS) return
          stillAsked.set(target, Date.now())
          for (const c of clients) {
            if (c.user.id === target) send(c.socket, { t: 'share-still-ask' })
          }
          return
        }

        case 'share-still': {
          const sharer = client.user.id
          const image = String(msg.image ?? '')
          // A data URL and nothing else: this is handed straight to an
          // <img src>, and the only shape that cannot point somewhere else
          // is one that carries its own bytes.
          if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return
          if (image.length > STILL_MAX) return
          if (!voice.get(sharer)?.sharing) return

          stills.set(sharer, { image, at: Date.now() })
          const waiting = stillWaiters.get(sharer)
          if (!waiting) return
          stillWaiters.delete(sharer)
          const allowed = new Set(
            [...waiting].filter((id) =>
              voiceVisibleTo(id).some((o) => o.userId === sharer && o.sharing)))
          for (const c of clients) {
            if (allowed.has(c.user.id) && mayServeStill(c.user.id, sharer)) {
              send(c.socket, { t: 'share-still', userId: sharer, image })
            }
          }
          for (const id of allowed) tellSharer(sharer, id)
          return
        }

        case 'typing': {
          /*
           * Into a channel you are actually in.
           *
           * This took whatever id it was given, so anybody could put "X is
           * typing" inside a private channel, or somebody else's
           * conversation, without being in either.
           */
          const where = String(msg.channelId ?? '')
          if (!where) return
          if (isDirect(where)) {
            if (!dmMembers(where).includes(client.user.id)) return
          } else if (!canAccessChannel(client.user.id, where)) {
            return
          }
          toChannel(where, { t: 'typing', userId: client.user.id, channelId: where }, socket)
          return
        }

        case 'read': {
          // Your own read state, but only for somewhere you can read: this
          // wrote a row for any id it was handed.
          const readWhere = String(msg.channelId ?? '')
          if (!readWhere) return
          if (isDirect(readWhere)) {
            if (!dmMembers(readWhere).includes(client.user.id)) return
          } else if (!canAccessChannel(client.user.id, readWhere)) {
            return
          }
          const readAt = Date.now()
          db.prepare(
            `INSERT INTO read_state (user_id, channel_id, last_read_at) VALUES (?, ?, ?)
             ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = excluded.last_read_at`
          ).run(client.user.id, readWhere, readAt)

          /*
           * And say so to every other window this person has open.
           *
           * This wrote the row and told nobody, so reading a message on the
           * desktop app left the same message bold in a browser tab until it
           * was reloaded - the server knew, and the only client it never
           * mentioned it to was the one still showing the badge. Reported
           * exactly that way round.
           *
           * Sent to this socket as well. It has already cleared its own
           * badge, so the echo changes nothing - and leaving it out would
           * mean carrying a socket exclusion through pushToUsers for no gain.
           */
          pushToUsers([client.user.id], { t: 'read', channelId: readWhere, at: readAt })
          return
        }

        case 'pong': {
          client.alive = true
          return
        }
      }
    })

    socket.on('close', (code: number) => {
      clearTimeout(authTimer)
      if (!client) return
      const gone = client
      dropClient(gone)
      // Only announce offline once every socket for that user has gone.
      if (!stillConnected(gone.user.id)) {
        /*
         * The question is whether a close frame arrived at all, not which
         * code it carried. 1006 is the one that means none did - the socket
         * vanished - and everything else, 1005 included, is the other end
         * saying goodbye: the tab closed, the window navigated away, the app
         * quit. A socket the heartbeat already gave up on skips the wait too;
         * it has been silent for a full interval and is not coming back.
         *
         * Written first as an allowlist of 1000 and 1001, which is wrong and
         * was caught by presencescope: a close() with no argument - which is
         * what an ordinary tab closing sends - arrives as 1005, so quitting
         * the app took the blip path and sat there for fifteen seconds.
         */
        const vanished = code === 1006 || code === 1015
        if (!vanished || gone.givenUpOn) {
          cancelOffline(gone.user.id)
          pushAboutMember(gone.user.id, { t: 'presence', userId: gone.user.id, online: false })
        } else if (!goingOffline.has(gone.user.id)) {
          const timer = setTimeout(() => announceOffline(gone.user.id), OFFLINE_GRACE_MS)
          timer.unref()
          goingOffline.set(gone.user.id, timer)
        }
        // Whatever they were doing, they are not doing it here any more. Told
        // rather than left to expire: a stale "playing Tarkov" on somebody
        // who closed their laptop an hour ago is worse than nothing.
        if (activities.delete(client.user.id)) {
          pushAboutMember(client.user.id, { t: 'activity', userId: client.user.id, activities: [] })
        }
        // A closed tab should not leave a ghost sitting in a voice channel.
        // Their socket is gone, so nothing is coming back to reconnect.
        reconnecting.delete(client.user.id)
        forgetStills(client.user.id)
        const wasIn = voice.get(client.user.id)?.channelId
        if (voice.delete(client.user.id)) {
          // A closed laptop is one of the things the two minutes are for.
          if (wasIn && isDirect(wasIn)) callMayBeOver(wasIn)
          announceVoice()
        }
      }
    })

    socket.on('error', () => socket.close())
  })

  // Drop sockets that stopped answering. A laptop lid closing does not send a
  // close frame, so without this the member list slowly fills with ghosts.
  setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        /*
         * Marked before the close handler can run, so it knows this socket
         * was not a blip. It has already had a full interval to answer a
         * ping and did not, so there is nothing left to wait for.
         */
        c.givenUpOn = true
        c.socket.terminate()
        dropClient(c)
        continue
      }
      c.alive = false
      send(c.socket, { t: 'ping' })
    }
  }, 30_000).unref()

  console.log('[gateway] listening on /gateway')
}
