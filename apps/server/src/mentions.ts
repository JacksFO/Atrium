import { db } from './db.js'

/**
 * Who a message was aimed at.
 *
 * Until now this was worked out in the browser, on messages as they arrived,
 * and kept in a Set in memory. That answers "light this channel up now" and
 * nothing else: reload the page and every mention you had not yet looked at
 * was gone, because the only record of it was a variable in a tab you closed.
 *
 * Asked for as wanting the mark to stay on the server and on the channel
 * until the mention itself has been seen. That needs the fact written down,
 * so it is written down here - at the moment the message is accepted, against
 * the people it names.
 *
 * The rules have to agree with the client's, in lib/mentions.ts, or a message
 * would light up on arrival and then lose its mark on reload, or the reverse.
 * Both of these hold:
 *
 *   - the longest name wins, so "@Movie Night" is not read as "@Movie";
 *   - a match ends on a word boundary, so "@jackson" is not a mention of
 *     "@jack" with a stray "son" beside it.
 */

type Target =
  | { kind: 'user'; id: string; token: string }
  | { kind: 'role'; id: string; token: string }
  | { kind: 'all'; token: string }

/**
 * Everything that can be named in one channel.
 *
 * Members of the server the channel belongs to, its mentionable roles, and
 * the two broadcast words. A DM has no server, so its targets are the people
 * in the conversation.
 */
function targetsFor(channelId: string, spaceId: string | null): Target[] {
  /*
   * Everybody in whatever holds this channel.
   *
   * This was a ternary over two tables - the members of the server if there
   * is one, the people in the conversation if there is not - which is the
   * shape containment exists to remove. A server and a conversation are both
   * containers, and the channel names its own: the server it belongs to, or
   * itself when it is the conversation.
   */
  const people = db.prepare(
    `SELECT u.id, u.username
       FROM users u
       JOIN container_members m ON m.user_id = u.id
      WHERE m.container_id = ? AND u.removed_at IS NULL`
  ).all(spaceId ?? channelId) as unknown as Array<{ id: string; username: string }>

  const roles = (spaceId
    ? db.prepare(
        `SELECT id, name FROM roles
          WHERE space_id = ? AND mentionable != 0 AND kind != 'everyone'`
      ).all(spaceId)
    : []) as unknown as Array<{ id: string; name: string }>

  const targets: Target[] = [
    ...people.map((p) => ({ kind: 'user' as const, id: p.id, token: p.username })),
    ...roles.map((r) => ({ kind: 'role' as const, id: r.id, token: r.name })),
    { kind: 'all', token: 'everyone' },
    { kind: 'all', token: 'here' },
  ]
  // Longest first, so a shorter name that is a prefix of a longer one does not
  // win the match. Same reason as the client.
  return targets.sort((a, b) => b.token.length - a.token.length)
}

/** The longest target whose name begins the text, ending on a word boundary. */
function matchAt(targets: Target[], candidate: string): Target | null {
  const lower = candidate.toLowerCase()
  for (const t of targets) {
    const token = t.token.toLowerCase()
    if (!lower.startsWith(token)) continue
    const next = candidate.charAt(token.length)
    if (next && /[\w.-]/.test(next)) continue
    return t
  }
  return null
}

/**
 * Everybody one message names, by user id.
 *
 * The author is never in it: being told you mentioned yourself is noise, and
 * it would leave a mark on a channel nobody else had spoken in.
 *
 * A broadcast names everybody who can see the channel - but only if the
 * sender was allowed one. That permission is checked before the message is
 * accepted, so `broadcastAllowed` is that answer handed on rather than asked
 * again here.
 */
export function mentionedBy(
  body: string,
  opts: {
    channelId: string
    spaceId: string | null
    authorId: string
    broadcastAllowed: boolean
    /** Who can actually see the channel, for a broadcast. */
    audience: string[]
  },
): string[] {
  if (!body) return []
  const targets = targetsFor(opts.channelId, opts.spaceId)
  const named = new Set<string>()

  /*
   * Bounded, like the client's. A body may hold thousands of @s and each one
   * otherwise walks the whole target list - real messages are nowhere near,
   * and this runs on every message the server accepts.
   */
  let budget = 64
  let from = body.indexOf('@')
  while (from !== -1 && budget-- > 0) {
    const hit = matchAt(targets, body.slice(from + 1))
    if (hit) {
      if (hit.kind === 'user') named.add(hit.id)
      else if (hit.kind === 'role') {
        for (const row of db.prepare('SELECT user_id FROM member_roles WHERE role_id = ?')
          .all(hit.id) as unknown as Array<{ user_id: string }>) {
          named.add(row.user_id)
        }
      } else if (hit.kind === 'all' && opts.broadcastAllowed) {
        for (const id of opts.audience) named.add(id)
      }
    }
    from = body.indexOf('@', from + 1)
  }

  named.delete(opts.authorId)
  return [...named]
}

/** Write down who a message named, so the mark survives a reload. */
export function recordMentions(messageId: string, channelId: string, userIds: string[]): void {
  if (userIds.length === 0) return
  const insert = db.prepare(
    'INSERT OR IGNORE INTO mentions (message_id, channel_id, user_id) VALUES (?, ?, ?)'
  )
  for (const id of userIds) insert.run(messageId, channelId, id)
}

/**
 * The channels where somebody has been named and has not read it yet.
 *
 * Against read_state, the same fact the unread counts are measured by, so a
 * channel cannot be unread-with-a-mention and read at the same time. A
 * mention in a channel never opened counts: there is no read row, and the
 * whole point is that it has not been seen.
 */
export function unreadMentionChannels(userId: string): string[] {
  return (db.prepare(
    `SELECT DISTINCT n.channel_id AS channelId
       FROM mentions n
       JOIN messages m ON m.id = n.message_id
       LEFT JOIN read_state r
         ON r.channel_id = n.channel_id AND r.user_id = n.user_id
      WHERE n.user_id = ?
        AND m.deleted_at IS NULL
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
        /*
         * And not named by somebody they have blocked.
         *
         * The live path already refuses these, so without this the dot was
         * right until a reload and wrong afterwards - which is worse than
         * either answer on its own, because it looks like the block
         * lapsing. One clause on a query that runs once per connection.
         */
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE b.blocker_id = n.user_id AND b.blocked_id = m.author_id)`
  ).all(userId) as unknown as Array<{ channelId: string }>).map((r) => r.channelId)
}
