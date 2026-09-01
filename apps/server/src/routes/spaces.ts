import type { FastifyInstance } from 'fastify'
import { randomUUID, randomBytes } from 'node:crypto'
import { basename, resolve } from 'node:path'
import { unlinkSync } from 'node:fs'
import { config } from '../config.js'
import {
  db, membersOfContainer, joinContainer, makeContainer, unmakeContainer, leaveContainer, emptyContainer, setRailPosition, setConversationClosed, conversationBetween, membersOfSpace, nicknamesIn, forgetMemberIn, isBanned, isSpaceMember, joinSpace, seedRolesFor, grantOwnerRole, areFriends, dmMembers, hydrateOne,
  type User,
} from '../db.js'
import { pushToUsers, announceJoin, clearVoiceIn, clearVoiceForUserInSpace } from '../gateway.js'
import { writeAudit, permissionsFor } from '../permissions.js'
import { allow } from '../ratelimit.js'
import { canAccessChannel } from '../access.js'

type Authed = (req: unknown) => Promise<User | null>

/**
 * Servers people make for themselves.
 *
 * Until now there was one, and being registered meant being in it. That was
 * fine while this was five friends in a basement and is the thing standing
 * between here and anybody being able to use it: somebody who downloads the
 * app and signs up needs somewhere of their own to put their friends, or an
 * account is a door into an empty room.
 *
 * A space is owned by whoever made it and joined through an invite that
 * belongs to it. Nothing here touches the original space, which keeps working
 * exactly as it did - it is simply no longer the only one.
 */
/**
 * Tell somebody what they may do in a server they have just gained.
 *
 * The permissions for every server arrive in one payload when a client
 * connects, and never again. So a server made or joined after that had no
 * entry at all - and the screen, having nothing for it, fell back to the
 * permissions of a different server, where the person who had just made this
 * one was nobody in particular.
 *
 * Which is why somebody who created a server found no way to add a channel
 * to it: the button is drawn from these, the server itself would have allowed
 * it, and a reload would have fixed it. Reported by exactly that route.
 */
function tellThemWhatTheyMayDo(userId: string, spaceId: string): void {
  pushToUsers([userId], {
    t: 'permissions',
    spaceId,
    permissions: [...permissionsFor(userId, spaceId)],
  })
}

export function registerSpaceRoutes(app: FastifyInstance, authed: Authed): void {
  /**
   * Hand somebody the channels of a server they have just made or joined.
   *
   * The gateway sends your channels once, when you connect. A server created
   * or joined after that never reaches the open window: the icon appeared in
   * the rail and clicking it showed nothing, because the client was still
   * holding the list it was given at connect. Found by making a server in the
   * app and watching the channel list stay empty.
   */
  function sendChannelsOf(spaceId: string, userId: string): void {
    const rows = db.prepare(
      "SELECT * FROM channels WHERE space_id = ? AND kind IN ('text','voice') ORDER BY position"
    ).all(spaceId) as Array<{ id: string }>
    for (const channel of rows) pushToUsers([userId], { t: 'channel-created', channel })
  }

  /** Their conversation, made if they have not had one yet. */
  function openDm(a: string, b: string): string | null {
    const existing = { id: conversationBetween(a, b) }
    if (existing?.id) {
      // A conversation somebody closed comes back when something arrives in
      // it, which is exactly what is about to happen.
      setConversationClosed(null, existing.id, null)
      return existing.id
    }

    const other = db.prepare('SELECT display_name FROM users WHERE id = ?').get(b) as
      { display_name: string } | undefined
    if (!other) return null

    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      "INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, ?, '', 'dm', 0, ?)"
    ).run(id, other.display_name, now)
    makeContainer(id, 'dm', now)
    joinContainer(a, id)
    joinContainer(b, id)
    return id
  }

  /** Put the invite in the conversation, as a message from whoever sent it. */
  function postInvite(channelId: string, from: string, body: string): void {
    const id = randomUUID()
    db.prepare(
      'INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, channelId, from, body, Date.now())
    for (const member of dmMembers(channelId)) {
      const message = hydrateOne(id, member)
      if (!message) return
      pushToUsers([member], { t: 'message', message })
    }
  }

  /**
   * What a brand new server starts with, so it is not an empty room.
   *
   * Two headings with a channel each, and they are ordinary categories —
   * rows in the table, renameable, movable and deletable like any other. They
   * used to be neither: a channel with no category was drawn under an
   * invented heading called "Text" or "Voice", which is why those two could
   * not be touched. A template is a starting point, not a fixture.
   *
   * A category is not tied to a kind, here or anywhere. These start with one
   * of each because that is the shape of a new server, and nothing stops
   * somebody putting a voice room under Text or renaming both to something
   * else entirely.
   */
  function seedChannels(spaceId: string): void {
    const category = db.prepare(
      `INSERT INTO categories (id, space_id, name, position, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    const insert = db.prepare(
      `INSERT INTO channels (id, name, topic, kind, position, created_at, space_id, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const now = Date.now()
    /*
     * Named so they cannot be mistaken for the headings the client invents.
     *
     * A channel filed under nothing is drawn under a heading worked out from
     * its kind — "Text" or "Voice" — which is not a row in this table and
     * cannot be renamed. Seeding categories with those same two words meant
     * a server could show two headings called "Text": the one that came with
     * it, and the one holding whatever was made outside a category. Making a
     * channel from the empty space in the list is enough to see it.
     *
     * The seeded ones move because they are the ones somebody can rename or
     * throw away. Servers made before this keep the names they have.
     */
    const defaults: Array<[string, string, string, string]> = [
      ['Text Channels', 'general', '', 'text'],
      ['Voice Channels', 'Voice', '', 'voice'],
    ]
    defaults.forEach(([heading, name, topic, kind], i) => {
      const catId = randomUUID()
      category.run(catId, spaceId, heading, i, now)
      insert.run(randomUUID(), name, topic, kind, i, now, spaceId, catId)
    })
  }

  /**
   * Rearrange your own rail.
   *
   * Yours alone. The position is written on the membership row, so this can
   * only ever move servers for the person asking - there is no way to express
   * "and move it for everybody else too", which is what makes it safe to let
   * anybody do it in a server they merely belong to.
   *
   * Positions are rewritten from the list the client sends, so the order on
   * screen and the order stored cannot drift apart. An id that is not theirs
   * updates nothing rather than being refused: the client sends what it is
   * showing, and one stale entry is not worth failing a drag over.
   */
  app.post('/api/spaces/reorder', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { order } = (req.body ?? {}) as { order?: string[] }
    if (!Array.isArray(order)) {
      return reply.code(400).send({ error: 'order must be a list of ids' })
    }
    // More than anybody has, and a bound on the work either way.
    if (order.length > 200) {
      return reply.code(400).send({ error: 'that is more servers than exist' })
    }

    db.exec('BEGIN')
    try {
      order.forEach((id, i) => {
        if (typeof id !== 'string') return
        setRailPosition(user.id, id, i)
      })
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    /* Your own other windows: where a server sits on the rail is yours and
       nobody else's, and it was also only this window's until a reload. */
    pushToUsers([user.id], { t: 'spaces-changed' })
    return { ok: true }
  })

  /** Everywhere this person is, and whether it is theirs. */
  app.get('/api/spaces', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const rows = db.prepare(
      `SELECT s.id, s.name, s.description, s.icon_path, s.banner_path, s.owner_id, s.created_at
         FROM spaces s
         JOIN container_members m ON m.container_id = s.id
        WHERE m.user_id = ?
        /*
         * The reader's own arrangement, falling back to when they joined.
         *
         * position is theirs, on the membership rather than on the server -
         * two people in the same servers order them differently. Null until
         * they drag something, and COALESCE keeps the rail exactly as it was
         * until then rather than collapsing every untouched server onto one rung.
         *
         * The column moved here with the membership it belongs to, and a
         * drag is an UPDATE of it - a case the insert and delete triggers
         * do not cover. Switching this query before that trigger existed
         * threw "no such column", and switching it before the trigger
         * would have lost every arrangement on the next reorder.
         */
        ORDER BY COALESCE(m.position, m.joined_at), m.joined_at`
    ).all(user.id) as Array<{ id: string; owner_id: string | null }>

    return { spaces: rows.map((s) => ({ ...s, mine: s.owner_id === user.id })) }
  })

  /**
   * The channels of one server.
   *
   * There was no way to ask this at all. A channel list reached a client once,
   * in the frame the socket opens with, and never again - so a server you had
   * just made, or an invite you had just accepted, arrived in the rail with
   * its headings and nothing under them. Both of those push only
   * `spaces-changed`, which reloads the server rows and the headings, and a
   * heading with no channels is what "the channels took a while to show up"
   * actually was: they were not slow, they were absent until something else
   * dropped the socket and the opening frame was built again.
   *
   * Both gates the opening frame applies, applied here for the one server:
   * whether this person may view channels in it at all, and then which of
   * those channels they can reach. A private channel is left out entirely -
   * somebody who cannot enter one has no reason to learn it exists - and this
   * is the route a member list or a heading would otherwise be joined against,
   * so getting it wrong here is how a channel leaks.
   */
  app.get('/api/channels', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const spaceId = String((req.query as { spaceId?: string })?.spaceId ?? '')
    if (!spaceId) return reply.code(400).send({ error: 'which server' })

    /* Not a member is not a 403 with a hint in it: the answer to "what is in
       that server" is the same whether it exists or not. */
    if (!isSpaceMember(user.id, spaceId)) return { channels: [] }
    if (!permissionsFor(user.id, spaceId).has('view_channels')) return { channels: [] }

    const rows = db.prepare(
      `SELECT * FROM channels
        WHERE space_id IS ? AND kind IN ('text', 'voice')
        ORDER BY kind DESC, position ASC`
    ).all(spaceId) as Array<{ id: string }>

    /*
     * Asked of these channels, not of every channel in the app.
     *
     * This used accessibleChannelIds, which walks every text and voice
     * channel that exists and works out reachability for each - and then all
     * but one server's worth was thrown away. Right, and priced by the size
     * of the whole machine rather than by the size of the answer. One server
     * of ten is ten times the work it needs for the same result.
     */
    return { channels: rows.filter((c) => canAccessChannel(user.id, c.id)) }
  })

  /**
   * Make one.
   *
   * The maker owns it, is in it, and it arrives with somewhere to talk -
   * a server with no channels is a screen that looks broken rather than new.
   */
  app.post('/api/spaces', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { name } = (req.body ?? {}) as { name?: string }
    const clean = String(name ?? '').trim().slice(0, 48)
    if (!clean) return reply.code(400).send({ error: 'a name is required' })

    /*
     * A cap, because this is somebody's home connection.
     *
     * Every space is rows, channels and a slice of the member list, and an
     * account that can make them without limit is an account that can fill
     * the disk. Generous enough that nobody real will meet it.
     */
    const mine = db.prepare('SELECT COUNT(*) c FROM spaces WHERE owner_id = ?').get(user.id) as { c: number }
    if (mine.c >= 20) return reply.code(429).send({ error: 'you have made as many servers as one account may' })

    const id = randomUUID()
    const now = Date.now()
    db.exec('BEGIN')
    try {
      db.prepare(
        'INSERT INTO spaces (id, name, description, icon_path, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, clean, '', null, user.id, now)
      makeContainer(id, 'space', now)
      joinContainer(user.id, id, now)
      seedChannels(id)
      // Its own @everyone and Owner, so its owner is editing this server
      // rather than the original one.
      seedRolesFor(id)
      // And the Owner role actually held by the owner. Without this the role
      // existed and belonged to nobody, so whoever made a server appeared in
      // their own member list under @everyone with no sign it was theirs.
      grantOwnerRole(id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      return reply.code(500).send({ error: 'could not create that server' })
    }

    writeAudit(user.id, 'space.create', clean, id)
    // The channels exist now; the window that made them has to be told.
    sendChannelsOf(id, user.id)
    // Their own other windows need to know, so the new server appears there
    // too rather than only where it was made.
    pushToUsers([user.id], { t: 'spaces-changed' })
    // And what they may do in it, which is everything - they made it.
    tellThemWhatTheyMayDo(user.id, id)
    return { space: { id, name: clean, description: '', icon_path: null, owner_id: user.id, created_at: now, mine: true } }
  })

  /**
   * A code that lets somebody into this server.
   *
   * Any member may make one, which is the only way a server grows without
   * its owner having to be awake. The invite belongs to
   * the space, so redeeming it can only ever put somebody in that one.
   */
  app.post('/api/spaces/:id/invites', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    if (!isSpaceMember(user.id, id)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    /*
     * A budget, because every code is a row that lives until it is spent.
     *
     * Any member may mint one, which is the point - a server should not need
     * its owner awake to grow. Unlimited is a different thing: one account in
     * a loop is unbounded rows in a table nothing prunes.
     */
    if (!allow(`invite-new:${user.id}`, 20, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const { uses, days } = (req.body ?? {}) as { uses?: number; days?: number }
    const code = `at-${randomBytes(9).toString('hex')}`
    const expires = days && days > 0 ? Date.now() + days * 86_400_000 : null

    db.prepare(
      'INSERT INTO invites (code, created_by, uses_left, expires_at, created_at, space_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code, user.id, Math.max(1, Math.min(Number(uses ?? 10), 100)), expires, Date.now(), id)

    writeAudit(user.id, 'invite.create', code, id)
    /* Whoever has the invites pane open is looking at a list that just
       changed. Nothing about the invite goes with it: a code is a way into
       the server, and the pane asks again through the route that checks
       whether they may see one. */
    pushToUsers(membersOfContainer(id), { t: 'invites-changed', spaceId: id })
    return { code }
  })

  /**
   * Send an invite straight to somebody's conversation.
   *
   * Copying a code and pasting it into a chat is two steps and a clipboard,
   * and the clipboard is where invite codes go to be lost. This puts it where
   * they will actually see it, in the conversation they already have.
   *
   * Only to friends. An endpoint that posts into a stranger's conversation on
   * request is a way to send unsolicited messages to anybody whose id you can
   * guess, and it would be the only one in the app.
   */
  app.post('/api/spaces/:id/invites/send', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    const { userId } = (req.body ?? {}) as { userId?: string }
    if (!userId) return reply.code(400).send({ error: 'userId required' })

    if (!isSpaceMember(user.id, id)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    if (!areFriends(user.id, userId)) {
      return reply.code(403).send({ error: 'you can only send invites to friends' })
    }
    if (isSpaceMember(userId, id)) {
      return reply.code(409).send({ error: 'they are already in that server' })
    }
    // Friends decides who may; this decides how often. Every other path that
    // puts a message in somebody's conversation is limited, and this one
    // writes into a conversation that is not the sender's alone.
    if (!allow(`invite-send:${user.id}`, 10, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const space = db.prepare('SELECT name FROM spaces WHERE id = ?').get(id) as
      { name: string } | undefined
    if (!space) return reply.code(404).send({ error: 'no such server' })

    const code = `at-${randomBytes(9).toString('hex')}`
    db.prepare(
      'INSERT INTO invites (code, created_by, uses_left, expires_at, created_at, space_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code, user.id, 1, Date.now() + 7 * 86_400_000, Date.now(), id)

    // The conversation they already have, or a new one - either way it lands
    // somewhere they will look rather than in a clipboard.
    const channelId = openDm(user.id, userId)
    if (!channelId) return reply.code(500).send({ error: 'could not open a conversation' })

    postInvite(channelId, user.id, `Join ${space.name}: ${code}`)
    writeAudit(user.id, 'invite.send', `${code} to ${userId}`, id)
    return { ok: true, code }
  })

  /** What an invite is for, before deciding whether to take it. */
  app.get('/api/invites/:code', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /*
     * A budget on looking one up, not only on making one.
     *
     * The code is the whole credential for joining a server, and this route
     * says whether a given one is real. Guessing is not a practical attack at
     * seventy-two bits - it was not at thirty-two either - but an unlimited
     * oracle against a bearer token is the sort of thing that stops being
     * fine the day the token gets shorter for some other reason.
     */
    if (!allow(`invite-look:${user.id}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const { code } = req.params as { code: string }
    const row = db.prepare(
      `SELECT i.space_id, i.uses_left, i.expires_at, s.name, s.icon_path, s.description
         FROM invites i LEFT JOIN spaces s ON s.id = i.space_id
        WHERE i.code = ?`
    ).get(code) as {
      space_id: string | null; uses_left: number; expires_at: number | null
      name: string | null; icon_path: string | null; description: string | null
    } | undefined

    if (!row || row.uses_left <= 0 || (row.expires_at && row.expires_at < Date.now())) {
      return reply.code(404).send({ error: 'that invite is not valid' })
    }
    /* Null rather than the oldest server: a channel that is not a
       conversation must name its own, and the database now enforces it. */
    const spaceId = row.space_id ?? null
    /*
     * Enough to recognise the place before agreeing to walk into it.
     *
     * The name alone was enough while the only way to use an invite was to
     * type the code into a box, because by then you had been told what it
     * was for. A card offering a button has to say for itself: whose server,
     * what it looks like, and how many people are already in it.
     *
     * Nothing here is private - it is the answer to "what is this invite
     * for", asked by somebody holding the invite.
     */
    const members = spaceId
      ? (db.prepare('SELECT COUNT(*) AS c FROM container_members WHERE container_id = ?')
          .get(spaceId) as { c: number }).c
      : 0
    return {
      space: {
        id: spaceId,
        name: row.name ?? 'Atrium',
        icon: row.icon_path ?? null,
        description: row.description ?? '',
        members,
      },
      already: spaceId ? isSpaceMember(user.id, spaceId) : false,
      /*
       * Said here so the card can say it instead of offering a button that
       * will not work.
       *
       * Not a leak: they are being told a fact about themselves, by a server
       * they already hold an invite to, and the alternative is pressing Join
       * and getting an error with no explanation. The name and icon are
       * shown either way, which is what makes it recognisable enough to
       * understand - "you were barred from this place" needs the place.
       */
      banned: spaceId ? isBanned(user.id, spaceId) : false,
    }
  })

  /**
   * Take an invite.
   *
   * A use is only spent on somebody who was not already in - otherwise
   * clicking the same link twice quietly burns a use, and a ten-use invite
   * lets in four people.
   */
  app.post('/api/invites/:code/accept', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { code } = req.params as { code: string }
    const row = db.prepare('SELECT space_id, uses_left, expires_at FROM invites WHERE code = ?')
      .get(code) as { space_id: string | null; uses_left: number; expires_at: number | null } | undefined

    if (!row || row.uses_left <= 0 || (row.expires_at && row.expires_at < Date.now())) {
      return reply.code(404).send({ error: 'that invite is not valid' })
    }

    /* Null rather than the oldest server: a channel that is not a
       conversation must name its own, and the database now enforces it. */
    const spaceId = row.space_id ?? null
    if (!spaceId) return reply.code(404).send({ error: 'that invite is not valid' })

    if (isSpaceMember(user.id, spaceId)) return { ok: true, spaceId, already: true }

    /*
     * Barred, and told so before a use is spent.
     *
     * Above the UPDATE deliberately. Refusing after it would burn one of the
     * invite's uses on somebody who cannot join - so a banned person holding
     * a ten-use link could quietly empty it, and whoever made it would find
     * it dead with nobody let in.
     *
     * joinSpace refuses this too. This is here to say why.
     */
    if (isBanned(user.id, spaceId)) {
      return reply.code(403).send({ error: 'you cannot join that server' })
    }

    // Conditional so two people redeeming the last use at once cannot both win.
    const spent = db.prepare(
      `UPDATE invites SET uses_left = uses_left - 1
        WHERE code = ? AND uses_left > 0 AND (expires_at IS NULL OR expires_at > ?)`
    ).run(code, Date.now())
    if (Number(spent.changes) !== 1) {
      return reply.code(404).send({ error: 'that invite is not valid' })
    }

    joinSpace(user.id, spaceId)
    writeAudit(user.id, 'space.join', spaceId, spaceId)
    sendChannelsOf(spaceId, user.id)
    pushToUsers([user.id], { t: 'spaces-changed' })
    // The same for somebody arriving on an invite: without it their first
    // minutes in a server are spent with somebody else's permissions.
    tellThemWhatTheyMayDo(user.id, spaceId)
    announceJoin(spaceId, user.id)
    return { ok: true, spaceId }
  })

  /**
   * Leave.
   *
   * The owner cannot, because a server with nobody able to manage it is a
   * room nobody can unlock - deleting it is a different decision, made
   * deliberately, and not the same button as walking out.
   */
  /**
   * Delete a server, and only that server.
   *
   * Owning one used to be a one-way door: an owner cannot leave their own
   * server - the route above refuses, and rightly, because leaving would
   * abandon it - and there was nothing to delete it with. So a server made by
   * mistake stayed for ever.
   *
   * Everything belonging to it goes, and the word "belonging" is doing real
   * work here. Only space_members has a foreign key to spaces; channels,
   * roles, invites and the audit log carry a space_id that was added later
   * and cascades nothing. Deleting the row alone would leave all of it
   * orphaned - visible to the queries that do not filter by space, invisible
   * to the ones that do.
   *
   * Conversations are untouched by construction: a DM has no space_id, so
   * none of these deletes can match one. Friendships, accounts and every
   * other server are not referenced here at all.
   */
  app.delete('/api/spaces/:id', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    const space = db.prepare('SELECT id, name, owner_id, icon_path FROM spaces WHERE id = ?')
      .get(id) as { id: string; name: string; owner_id: string | null; icon_path: string | null } | undefined
    if (!space) return reply.code(404).send({ error: 'no such server' })

    // Only the person who made it. Not manage_space, which somebody can be
    // given - deleting the room is not the same kind of act as renaming it.
    if (space.owner_id !== user.id) {
      return reply.code(403).send({ error: 'only the owner can delete this server' })
    }

    // Read before writing: after the deletes there is nobody left to tell,
    // and no way to find the files that need removing.
    const members = membersOfContainer(id)
    const files = (db.prepare(
      `SELECT a.path FROM attachments a
         JOIN messages m ON m.id = a.message_id
         JOIN channels c ON c.id = m.channel_id
        WHERE c.space_id = ?`
    ).all(id) as Array<{ path: string }>).map((r) => r.path)
    // Read now, because afterwards nothing remembers which channels were this
    // server's - and somebody sitting in one has to be told it has gone.
    const rooms = (db.prepare("SELECT id FROM channels WHERE space_id = ? AND kind = 'voice'")
      .all(id) as Array<{ id: string }>).map((r) => r.id)

    db.exec('BEGIN')
    try {
      // Channels first: messages, attachments, reactions, read state,
      // per-channel settings and the search index all hang off them and go
      // with them. A DM has no space_id, so none of this can reach one.
      db.prepare('DELETE FROM channels WHERE space_id = ?').run(id)
      // Roles, and with them who held them.
      db.prepare('DELETE FROM roles WHERE space_id = ?').run(id)
      db.prepare('DELETE FROM invites WHERE space_id = ?').run(id)
      db.prepare('DELETE FROM audit WHERE space_id = ?').run(id)
      emptyContainer(id)
      unmakeContainer(id)
      db.prepare('DELETE FROM spaces WHERE id = ?').run(id)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      app.log.error({ err }, 'could not delete a server')
      return reply.code(500).send({ error: 'could not delete that server' })
    }

    // The cache of "which space came first" can now name a row that is gone.
    // And nobody is left in a room that no longer exists.
    clearVoiceIn(rooms)

    // Files last, and outside the transaction: a failed unlink must not undo
    // a delete that has already happened, and a file with no row is rubbish
    // the sweep will take anyway.
    for (const path of [space.icon_path, ...files]) {
      if (!path || !path.startsWith('/uploads/')) continue
      const name = basename(path.split('?')[0] ?? '')
      const full = resolve(config.uploadDir, name)
      if (!full.startsWith(resolve(config.uploadDir))) continue
      try { unlinkSync(full) } catch { /* already gone */ }
    }

    // Everybody who was in it, including whoever deleted it, so the rail and
    // the member column stop showing something that no longer exists.
    pushToUsers(members, { t: 'spaces-changed' })
    // No space to file this under - it is gone, and an entry pointing at a
    // deleted server would be shown to nobody anyway.
    writeAudit(user.id, 'space.delete', space.name, null)
    return { ok: true }
  })

  app.post('/api/spaces/:id/leave', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    const space = db.prepare('SELECT owner_id FROM spaces WHERE id = ?').get(id) as
      { owner_id: string | null } | undefined
    if (!space) return reply.code(404).send({ error: 'no such server' })
    if (space.owner_id === user.id) {
      return reply.code(409).send({ error: 'you own this server, so you cannot leave it' })
    }

    leaveContainer(user.id, id)
    /* Leaving takes with it everything the membership carried, the same as
       being removed does - and through the same function, because the two
       lists drifting apart is how walking out came to clear less than being
       shown out. Coming back should not restore authority somebody gave
       them once. */
    forgetMemberIn(id, user.id)
    /*
     * And out of any call of this server's they were in.
     *
     * The same gap as being removed had: being in a call is held in the
     * gateway's map and nowhere else, so walking out of a server left you
     * sitting in its voice room - listed there and audible - with the server
     * gone from your own rail. Reported as nothing here, because the person
     * it happens to is the one who left and stops looking.
     */
    clearVoiceForUserInSpace(user.id, id)
    pushToUsers([user.id], { t: 'spaces-changed' })
    return { ok: true }
  })

  /**
   * Servers you and somebody else are both in.
   *
   * Only ever servers the person asking is already in, so it discloses
   * nothing: they could have read the same list off their own sidebar. It is
   * the answer to "how do I know this person", which is the actual question
   * somebody has when they click a name they half recognise.
   *
   * Mutual friends are deliberately not here. It reads as the same kind of
   * fact and is not: it would tell you who somebody else is friends with,
   * which is theirs to say rather than the app's.
   */
  app.get('/api/users/:id/mutual', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    const spaces = db.prepare(
      /*
       * The icon comes too. Without it every server in the list drew its
       * initials, including ones whose owner had set a picture - the client
       * had nothing else to draw with, so it looked like the icon had been
       * lost rather than never sent.
       */
      `SELECT s.id, s.name, s.icon_path FROM spaces s
         JOIN container_members a ON a.container_id = s.id AND a.user_id = ?
         JOIN container_members b ON b.container_id = s.id AND b.user_id = ?
        ORDER BY s.created_at`
    ).all(user.id, id)

    /*
     * Friends the two of you have in common - the intersection, not either
     * person's count.
     *
     * Only the overlap goes out, and every name in it is already somebody
     * the asker is friends with, so this discloses nothing they could not
     * see by opening their own friend list. Their *other* friends are not
     * anybody else's business and never leave the server.
     */
    /*
     * Their own names, and no nickname.
     *
     * This hand-wrote its column list and asked for u.nickname, which was an
     * account-wide column when it was written. Two things were wrong with it
     * once nicknames became per server: on a database old enough to still
     * have the column it sent the stale global name, which is exactly the
     * leak the change removed - and on a database made since, where the
     * column does not exist, the whole route throws `no such column` and the
     * profile card's mutual section fails for every new install.
     *
     * Caught by an audit rather than by the compiler: this is a SQL string,
     * so nothing typechecked it, and useMutual on the client declares its
     * own row shape with an optional nickname, so nothing there objected
     * either.
     *
     * Their own name is also the right answer here. Mutual friends are not a
     * fact about any one server, so there is no server whose nickname would
     * apply.
     */
    const friends = id === user.id ? [] : db.prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_path
         FROM users u
        WHERE u.removed_at IS NULL
          AND u.id != ? AND u.id != ?
          AND u.id IN (SELECT CASE WHEN low = ? THEN high ELSE low END
                         FROM friendships WHERE low = ? OR high = ?)
          AND u.id IN (SELECT CASE WHEN low = ? THEN high ELSE low END
                         FROM friendships WHERE low = ? OR high = ?)
        ORDER BY u.username`
    ).all(user.id, id, user.id, user.id, user.id, id, id, id)

    return { spaces, friends }
  })

  /** Who is in a server, for its member list. */
  app.get('/api/spaces/:id/members', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const { id } = req.params as { id: string }
    if (!isSpaceMember(user.id, id)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    /*
     * And what they are called here.
     *
     * Beside the records rather than on them, because a nickname is a fact
     * about a pair and the records are shared - the same person's row is in
     * the directory once and drawn in every server they are in. Hanging the
     * name off the row is what let one nickname follow somebody everywhere.
     *
     * Only the ones that are set, so a server where nobody has been renamed
     * sends an empty object. That is almost every server.
     */
    return { members: membersOfSpace(id), nicknames: nicknamesIn(id) }
  })
}
