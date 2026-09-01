import { isConversationKind } from '../kinds.js'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { db, hydrateOne, isInContainer, type User } from '../db.js'
import { pushMessageChange } from '../gateway.js'
import { canIn } from '../permissions.js'
import { allow } from '../ratelimit.js'

type Authed = (req: unknown) => Promise<User | null>

/**
 * Asking a question in a channel, and answering one.
 *
 * A poll is a message, not a thing hanging off one — its id IS the message's
 * id. So it is deleted, pinned, searched and permission checked by everything
 * that already knows what a message is, rather than by a second set of rules
 * that has to be kept in step with the first.
 */

/** As long as a question and an answer may be. Bounded, like every other
 *  string that arrives from outside. */
const MOST_QUESTION = 200
const MOST_ANSWER = 80
const MOST_OPTIONS = 10
const FEWEST_OPTIONS = 2

export function registerPollRoutes(app: FastifyInstance, authed: Authed): void {
  /** Where a channel lives, for the permission check and the broadcast. */
  const channelOf = (id: string) =>
    db.prepare('SELECT id, space_id, kind FROM channels WHERE id = ?').get(id) as
      unknown as { id: string; space_id: string | null; kind: string } | undefined

  app.post('/api/polls', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const body = (req.body ?? {}) as {
      channelId?: string
      question?: string
      options?: unknown
      multi?: unknown
      /** Minutes from now, or nothing for a poll that does not close. */
      minutes?: unknown
    }

    /*
     * A poll is a message everybody in the channel is asked to answer, so
     * one a second is not a mistake anybody makes — it is somebody filling a
     * channel with questions. Ten a minute is more than anybody needs and
     * far less than it takes to be a nuisance.
     */
    if (!allow(`poll:${user.id}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const channel = channelOf(String(body.channelId ?? ''))
    if (!channel) return reply.code(404).send({ error: 'no such channel' })

    /*
     * The same permission the server checks for a message, because that is
     * what this is. A conversation has no roles, so being in it is the whole
     * of the permission — the same rule the message route uses.
     */
    if (!isConversationKind(channel.kind)) {
      if (!canIn(user.id, 'create_polls', channel.id)) {
        return reply.code(403).send({ error: 'you cannot ask a question here' })
      }
    } else {
      const inIt = isInContainer(user.id, channel.id)
      if (!inIt) return reply.code(403).send({ error: 'that conversation is not yours' })
    }

    const question = String(body.question ?? '').trim().slice(0, MOST_QUESTION)
    if (!question) return reply.code(400).send({ error: 'a poll needs a question' })

    const asked: unknown[] = Array.isArray(body.options) ? body.options : []
    const options = asked
      .map((o) => String(o ?? '').trim().slice(0, MOST_ANSWER))
      .filter((o) => o.length > 0)
      .slice(0, MOST_OPTIONS)
    if (options.length < FEWEST_OPTIONS) {
      return reply.code(400).send({ error: 'a poll needs at least two answers' })
    }

    /*
     * A closing time, worked out here rather than taken as one.
     *
     * A client sending an absolute time can send any time at all, including
     * one in the past — which would be a poll that arrives closed. Minutes
     * from now cannot be that, whatever it is given.
     */
    const minutes = Number(body.minutes)
    const closesAt = Number.isFinite(minutes) && minutes > 0
      ? Date.now() + Math.min(minutes, 60 * 24 * 14) * 60_000
      : null

    const id = randomUUID()
    const now = Date.now()
    db.exec('BEGIN')
    try {
      db.prepare(
        `INSERT INTO messages (id, channel_id, author_id, body, created_at, kind)
         VALUES (?, ?, ?, '', ?, 'poll')`
      ).run(id, channel.id, user.id, now)
      db.prepare(
        `INSERT INTO polls (message_id, question, multi, closes_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, question, body.multi ? 1 : 0, closesAt, now)
      const put = db.prepare(
        'INSERT INTO poll_options (message_id, idx, text) VALUES (?, ?, ?)'
      )
      options.forEach((text, i) => put.run(id, i, text))
      db.exec('COMMIT')
    } catch {
      db.exec('ROLLBACK')
      return reply.code(500).send({ error: 'that would not save' })
    }

    pushMessageChange(channel.id, id)
    return { message: hydrateOne(id, user.id) }
  })

  /**
   * Answering one.
   *
   * The whole answer every time rather than one option toggled: two taps
   * arriving out of order cannot then leave somebody counted for something
   * they unticked. Sending none is taking your answer back, which is a thing
   * people want and which a toggle-per-option makes awkward.
   */
  app.post('/api/polls/:id/vote', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /*
     * Every answer is a broadcast to everybody in the channel, so this is
     * rate limited on what it costs other people rather than on what it
     * costs the person voting. Changing your mind a few times is ordinary;
     * sixty times a minute is a way to make everybody else's client redraw.
     */
    if (!allow(`vote:${user.id}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const { id } = req.params as { id: string }
    const row = db.prepare(
      `SELECT p.message_id, p.multi, p.closes_at, m.channel_id
         FROM polls p JOIN messages m ON m.id = p.message_id
        WHERE p.message_id = ? AND m.deleted_at IS NULL`
    ).get(id) as unknown as
      { message_id: string; multi: number; closes_at: number | null; channel_id: string } | undefined
    if (!row) return reply.code(404).send({ error: 'no such poll' })

    /* Closed is a fact about the clock. Checked here as well as drawn on the
       client, because a client with a slow clock is not a permission. */
    if (row.closes_at !== null && row.closes_at <= Date.now()) {
      return reply.code(409).send({ error: 'that poll has closed' })
    }

    const channel = channelOf(row.channel_id)
    if (!channel) return reply.code(404).send({ error: 'no such channel' })
    if (isConversationKind(channel.kind)) {
      const inIt = isInContainer(user.id, channel.id)
      if (!inIt) return reply.code(403).send({ error: 'that conversation is not yours' })
    } else if (!canIn(user.id, 'view_channels', channel.id)) {
      /* Answering needs only being able to see it: somebody who may read the
         channel may say what they think in it. Asking is the permission. */
      return reply.code(403).send({ error: 'you cannot see that channel' })
    }

    const asked: unknown[] = Array.isArray((req.body as { picked?: unknown })?.picked)
      ? ((req.body as { picked: unknown[] }).picked)
      : []
    const real = new Set(
      (db.prepare('SELECT idx FROM poll_options WHERE message_id = ?')
        .all(id) as unknown as Array<{ idx: number }>).map((o) => o.idx)
    )
    let picked = [...new Set(asked.map((n) => Number(n)))].filter((n) => real.has(n))
    /* One answer unless it says otherwise, whatever arrives. */
    if (!row.multi) picked = picked.slice(0, 1)

    db.exec('BEGIN')
    try {
      db.prepare('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?').run(id, user.id)
      const put = db.prepare(
        'INSERT INTO poll_votes (message_id, user_id, idx) VALUES (?, ?, ?)'
      )
      for (const idx of picked) put.run(id, user.id, idx)
      db.exec('COMMIT')
    } catch {
      db.exec('ROLLBACK')
      return reply.code(500).send({ error: 'that would not save' })
    }

    pushMessageChange(channel.id, id)
    return { message: hydrateOne(id, user.id) }
  })
}
