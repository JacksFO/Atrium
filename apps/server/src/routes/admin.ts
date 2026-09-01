import { isConversationKind } from '../kinds.js'
import type { FastifyInstance } from 'fastify'
import { randomUUID, randomBytes } from 'node:crypto'
import { statSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { accessFor, canAccessChannel, channelPermissionsFor, channelsWithViewRules, refreshPrivacy, refreshPrivacyUnder, setAccess, setViewOverride } from '../access.js'
import { db, withReadCache, joinContainer, makeContainer, leaveContainer, membersOfContainer, conversationBetween, ACTIVE_USERS, PUBLIC_USER_COLUMNS, areFriends, banFromSpace, bansOf, blockedBetween, canSeeMember, channelFor, forgetOverrides, forgetSubjectOverrides, forgetMemberIn, isBanned, isSpaceMember, liftBan, setNicknameIn, ownsSpace, rememberUpload, ROLE_ORDER } from '../db.js'
import { config } from '../config.js'
import { reconcileUploads } from '../uploads.js'
import { isProviderUrl } from '../gifs.js'
import { allow } from '../ratelimit.js'
import { PERMISSIONS, CHANNEL_PERMISSIONS, directPermissions, overrideTarget, overridesAt, permissionsAt, permissionsFor, permissionsIn, rolesFor, setOverride, syncChannel, unsyncChannel, writeAudit, canEditRole, filterGrantable, highestPosition, outranks, type Permission, EVERYONE_DEFAULTS } from '../permissions.js'
import { isOperator } from '../auth.js'
import type { User } from '../db.js'
import { pushAboutMember, pushToUsers, pushChannelEvent, clearVoiceForUsers, clearVoiceForUserInSpace, disconnectUser } from '../gateway.js'

type Authed = (req: unknown) => Promise<User | null>

/*
 * How many of a thing one server may hold.
 *
 * Making a server is already capped at twenty an account, with a comment
 * saying why: every one of them is rows on somebody's home machine. The
 * things INSIDE a server had no such limit, and they are worse — a channel
 * and a category go out in the opening frame to every member, so filling a
 * server with them is not a cost the person who made them pays, it is a cost
 * every member pays on every sign-in.
 *
 * Generous enough that nobody real will meet them. The point is that the
 * numbers exist, not where they sit.
 */
const MOST = { channels: 500, categories: 100, roles: 250, invites: 200 } as const

/**
 * Whether a server already holds as many of something as it may.
 *
 * Invites count only the ones that could still be used. Nothing sweeps spent
 * or expired invites - they are deleted by hand or when the whole server goes
 * - so counting every row ever written would let dead invites fill the
 * allowance and leave a server unable to make another, with no way to see
 * why. A cap that cannot be relieved is worse than no cap.
 */
function roomFor(
  table: 'channels' | 'categories' | 'roles' | 'invites',
  spaceId: string,
): boolean {
  const alive = table === 'invites'
    ? ' AND uses_left > 0 AND (expires_at IS NULL OR expires_at > unixepoch() * 1000)'
    : ''
  const row = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE space_id = ?${alive}`)
    .get(spaceId) as { c: number }
  return row.c < MOST[table]
}

export function registerAdminRoutes(app: FastifyInstance, authed: Authed): void {
  /** Resolve the caller, then check one permission. 401 vs 403 are different answers. */
  /**
   * @param spaceId which server the permission is being claimed in. Left off
   * only where the action genuinely is instance-wide - permissions belong to
   * a space now, and holding one in your own must not carry into somebody
   * else's.
   */
  async function guard(req: unknown, reply: any, permission: Permission, spaceId?: string | null) {
    const user = await authed(req)
    if (!user) {
      reply.code(401).send({ error: 'not signed in' })
      return null
    }
    /*
     * In that server at all, before what they may do in it.
     *
     * permissionsFor answers from a server's @everyone whether or not the
     * asker is a member - it describes what the role grants, not who holds
     * it - and nothing here asked the other question. So every signed-in
     * account held @everyone's permissions in every server in the app.
     *
     * @everyone can create invites by default, and POST /api/invites is
     * gated on that permission alone: a stranger could mint themselves a code
     * to a server they had never been in and walk in. Measured, not guessed -
     * it answered 200.
     *
     * Here rather than on that one route, because every route using this
     * guard asks the same thing, and the next one added would have inherited
     * the same hole.
     */
    if (spaceId && !isSpaceMember(user.id, spaceId)) {
      reply.code(403).send({ error: 'you are not in that server' })
      return null
    }
    if (!permissionsFor(user.id, spaceId).has(permission)) {
      reply.code(403).send({ error: `you need the ${permission.replace(/_/g, ' ')} permission` })
      return null
    }
    return user
  }

  /**
   * The same as guard(), but asked of one channel rather than of the server.
   *
   * Every route that acts on a single channel should use this. guard() reads
   * the server-wide answer, so a channel that denies manage_channels to a
   * role did not stop that role renaming or deleting it, and a channel that
   * denied manage_roles did not stop it being rewritten - which made both
   * rows in the permissions panel decoration, and made "hide this room from
   * a moderator" impossible, because the moderator could simply unhide it.
   *
   * Whoever made the server still holds everything in it: permissionsIn
   * short-circuits for them, so no channel can lock its own server's owner
   * out of the settings that would let them back in.
   */
  const channelExists = (id: string): boolean =>
    Boolean(db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id))

  async function guardIn(req: unknown, reply: any, permission: Permission, channelId: string) {
    const user = await authed(req)
    if (!user) {
      reply.code(401).send({ error: 'not signed in' })
      return null
    }
    /*
     * A channel that is not there is a 404, and it is answered here rather
     * than after the permission check.
     *
     * permissionsIn used to fall through to a server-wide lookup for a
     * channel it could not find, which handed the instance owner every
     * permission over a thing that does not exist - so the guard passed and
     * the route said 404 further down. It fails closed now, which is right,
     * and turned that 404 into "you need the manage roles permission here"
     * about a channel nobody can name. Neither answer was true.
     *
     * After authentication, so this cannot be used to ask whether an id
     * exists without an account.
     */
    if (!channelExists(channelId)) {
      reply.code(404).send({ error: 'no such channel' })
      return null
    }
    const space = spaceOfChannel(channelId)
    if (space && !isSpaceMember(user.id, space)) {
      reply.code(403).send({ error: 'you are not in that server' })
      return null
    }
    if (!permissionsIn(user.id, channelId).has(permission)) {
      reply.code(403).send({ error: `you need the ${permission.replace(/_/g, ' ')} permission here` })
      return null
    }
    return user
  }

  /**
   * Which server a channel belongs to.
   *
   * Derived rather than taken from the caller. Every one of these routes
   * already names a channel, and the channel already knows its server - so
   * asking the client to say it again was one more chance to say nothing and
   * have the answer quietly default to the original server. That is how
   * deleting a channel in your own server told you that you needed the manage
   * channels permission: the check was run against somebody else's.
   */
  function spaceOfChannel(channelId: string): string | null {
    const row = db.prepare('SELECT space_id FROM channels WHERE id = ?').get(channelId) as
      { space_id: string | null } | undefined
    /* Null is null. The fallback to the original server was for rows written
       before servers existed, and the database now refuses to hold one: a
       channel that is not a conversation must name its server, by CHECK. So
       this could only ever fire for a conversation or a channel that is not
       there, and for both of those the honest answer is "no server". */
    return row?.space_id ?? null
  }

  /** The same, for a role. */
  function spaceOfRole(roleId: string): string | null {
    const row = db.prepare('SELECT space_id FROM roles WHERE id = ?').get(roleId) as
      { space_id: string | null } | undefined
    /* roles.space_id is NOT NULL, so this is only ever null for a role that
       does not exist - which is a 404, not the original server. */
    return row?.space_id ?? null
  }

  /**
   * The same, for a category - but null when there is no such category.
   *
   * Deliberately unlike the two above, which fall back to the original
   * server for rows that predate spaces. No category predates spaces: they
   * were all made after, they all carry one, and a missing row here means a
   * bad id rather than an old one. Falling back would authorise a request
   * about a category that does not exist against a server that does.
   */
  function spaceOfCategory(categoryId: string): string | null {
    const row = db.prepare('SELECT space_id FROM categories WHERE id = ?').get(categoryId) as
      { space_id: string | null } | undefined
    return row?.space_id ?? null
  }

  function categoriesIn(spaceId: string | null): Array<{ id: string; name: string; position: number }> {
    if (!spaceId) return []
    return db.prepare(
      'SELECT id, space_id, name, position, created_at FROM categories WHERE space_id IS ? ORDER BY position, created_at'
    ).all(spaceId) as unknown as Array<{ id: string; name: string; position: number }>
  }

  /**
   * Read "give this role this, deny it that" out of a request, and refuse it
   * if the asker is not entitled to say it.
   *
   * Three separate refusals, and all three matter:
   *
   * Only permissions the asker holds themselves. This is the rule that
   * closes the escalation, exactly as it does for roles - without it,
   * manage_roles in one channel is a way to mint every other permission in
   * it, and manage_roles is a permission people hand out.
   *
   * Only roles below their own highest, through the same canEditRole that
   * gates the roles screen. Otherwise somebody could not edit a role in
   * settings but could rewrite what it does in every channel one at a time.
   *
   * Only people they outrank. Naming somebody by hand is the escape hatch
   * for "let this one person in", and it is equally the way to take
   * something off one person - which should not reach upwards.
   */
  function subjectAndRules(
    req: any, reply: any, space: string | null, user: User,
    at: { scope: 'channel' | 'category'; id: string },
  ): { kind: 'role' | 'member'; subjectId: string; rules: Record<string, boolean | null> } | null {
    const body = (req.body ?? {}) as {
      kind?: string; subjectId?: string; rules?: Record<string, unknown>
    }
    const kind = body.kind === 'member' ? 'member' : 'role'
    const subjectId = typeof body.subjectId === 'string' ? body.subjectId : ''
    if (!subjectId) {
      reply.code(400).send({ error: 'which role or person?' })
      return null
    }

    if (kind === 'role') {
      if (spaceOfRole(subjectId) !== space) {
        reply.code(400).send({ error: 'that role is not in this server' })
        return null
      }
      if (!canEditRole(user.id, subjectId)) {
        reply.code(403).send({ error: 'that role is above yours' })
        return null
      }
    } else {
      if (!space || !isSpaceMember(subjectId, space)) {
        reply.code(400).send({ error: 'they are not in this server' })
        return null
      }
      if (subjectId !== user.id && !ownsSpace(user.id, space) && !outranks(user.id, subjectId, space)) {
        reply.code(403).send({ error: 'they are not below you' })
        return null
      }
    }

    const rules: Record<string, boolean | null> = {}
    const wanted = Object.entries((body.rules ?? {}) as Record<string, unknown>)
      .filter(([p]) => (CHANNEL_PERMISSIONS as readonly string[]).includes(p))
    const decided = wanted.filter(([, v]) => v === true || v === false).map(([p]) => p)
    /*
     * What they hold HERE, not what they hold across the server.
     *
     * Measured server-wide, the rule said the wrong thing in the one case it
     * exists for: somebody holding send_messages everywhere, denied it in
     * this channel, could allow it straight back to themselves - so every
     * channel-level denial was advisory to anybody with manage_roles. "You
     * can only give what you have" has to mean what you have in the place
     * you are giving it.
     */
    const mine = permissionsAt(user.id, space, at.scope, at.id)
    const mayGive = new Set(
      filterGrantable(user.id, decided, space).filter((p) => mine.has(p))
    )
    const refused = decided.filter((p) => !mayGive.has(p as Permission))
    if (refused.length > 0) {
      reply.code(403).send({ error: `you do not have ${refused[0]!.replace(/_/g, ' ')} yourself` })
      return null
    }
    for (const [permission, state] of wanted) {
      rules[permission] = state === true ? true : state === false ? false : null
    }
    return { kind, subjectId, rules }
  }

  /**
   * Everybody in a server, for telling them something about it changed.
   *
   * Not pushToAll: a role appearing in one server is not news on the other
   * side of the app, and saying so would hand out the names and colours
   * of roles in servers people are not in.
   */
  function membersOf(spaceId: string | null): string[] {
    if (!spaceId) return []
    return membersOfContainer(spaceId)
  }

  /**
   * Tell a server its roles changed.
   *
   * Roles only ever arrived in the gateway's `ready`, so making one, renaming
   * it or deleting it was invisible to everybody else until they happened to
   * reload. Reported twice: a new role missing from the box on somebody's
   * profile, and a role that could not be handed out because no other client
   * knew it existed.
   */
  /**
   * Tell people what they may do here, after something changed what that is.
   *
   * Permissions were worked out once, when a client connected, and never
   * again. So being given a role - or having a role you already hold be given
   * a new permission - did nothing until you happened to reload: the buttons
   * that permission unlocks stayed hidden, and the panes stayed shut, while
   * the server would have allowed every one of them.
   *
   * Worked out per person, because the answer is different for each of them,
   * and sent only to them. A permission set is a description of what somebody
   * may do, and handing everybody else a copy is both noise and a small leak.
   */
  function pushPermissions(spaceId: string | null, userIds?: string[]): void {
    if (!spaceId) return
    /*
     * No lookup per member.
     *
     * This asked the users table for each id in turn, kept `id` and `role`,
     * used neither - `id` is the id it was given, `role` was never read - and
     * threw the row away. It could not fail either: these ids come from
     * container_members, which references users(id) ON DELETE CASCADE, so a
     * membership for somebody who is not there cannot exist.
     *
     * It also compiled the statement again on every pass round the loop.
     * Measured at 1.10ms per push for a hundred-member server, against
     * 0.02ms for not asking - on a path that runs whenever a role changes.
     */
    /*
     * And the same read cache around the whole loop, not just the list.
     *
     * Every member is asked the same questions about the same server - its
     * roles, its @everyone, the overrides on its channels - so the second
     * member onwards is mostly answered without touching the database.
     * Wrapping only the list of ids, which is what this said at first, caches
     * the cheap half and leaves the expensive one exactly as it was.
     */
    withReadCache(() => {
    for (const uid of userIds ?? membersOf(spaceId)) {
      pushToUsers([uid], {
        t: 'permissions',
        spaceId,
        // The union of @everyone and every role they hold, which is what
        // permissionsFor has always answered - roles add up rather than the
        // highest one winning.
        permissions: [...permissionsFor(uid, spaceId)],
        /*
         * And the channels where that is not the answer.
         *
         * Only the ones that differ, which is almost none of them - see
         * channelPermissionsFor. Sent alongside rather than as its own event
         * because the two are one fact: a client that learns it may send
         * here and not that a channel takes it away would put a message box
         * in front of somebody the server is about to refuse.
         */
        channels: channelPermissionsFor(uid, spaceId),
      })
    }
    })
  }

  /**
   * The invite list changed, without saying how.
   *
   * Deliberately empty: an invite code is a way into the server, and every
   * member would be told one they may not make. Whoever has the pane open
   * asks again through the route that checks whether they may - the event is
   * only "look again".
   */
  function pushInvites(spaceId: string | null): void {
    if (!spaceId) return
    pushToUsers(membersOf(spaceId), { t: 'invites-changed', spaceId })
  }

  function pushRoles(spaceId: string | null): void {
    if (!spaceId) return
    const roles = db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`)
      .all(spaceId)
    pushToUsers(membersOf(spaceId), { t: 'roles-changed', spaceId, roles })
    // What a role allows may have just changed, and that changes what
    // everybody holding it may do.
    pushPermissions(spaceId)
  }

  /**
   * Tell a server that somebody's roles in it changed.
   *
   * Carries the ids of every role in that server as well as the ones held, so
   * a client can replace exactly this server's part of what it knows without
   * consulting - and possibly disagreeing with - its own copy of the list.
   */
  function pushMemberRoles(userId: string, spaceId: string | null): void {
    if (!spaceId) return
    const spaceRoles = (db.prepare('SELECT id FROM roles WHERE space_id = ?')
      .all(spaceId) as Array<{ id: string }>).map((r) => r.id)
    pushToUsers(membersOf(spaceId), {
      t: 'member-roles',
      userId,
      spaceId,
      roles: rolesFor(userId, spaceId).map((r) => r.id),
      spaceRoles,
    })
    // Only theirs changed, so only they need a new set.
    pushPermissions(spaceId, [userId])
  }


  /**
   * Who can reach a channel right now, out of the people in its server.
   *
   * Taken before a change and compared with after, because the answer is a
   * question with several inputs - the private flag, the role list, the
   * member list, and manage_channels - and working out "who gained" from the
   * request body alone gets one of them wrong eventually.
   */
  function whoCanReach(channelId: string, spaceId: string | null): Set<string> {
    const out = new Set<string>()
    if (!spaceId) return out
    /*
     * One read cache for the whole pass.
     *
     * Every member is asked the same questions about the same channel - its
     * row, its overrides, the roles in this server - and the answers cannot
     * change while this runs, because node:sqlite is synchronous and a write
     * empties the cache anyway. Measured on a synthetic 500 members and 20
     * restricted channels: 138,437 of 140,000 reads answered without touching
     * the database.
     */
    return withReadCache(() => {
      for (const uid of membersOf(spaceId)) {
        if (canAccessChannel(uid, channelId)) out.add(uid)
      }
      return out
    })
  }

  /**
   * Tell the people whose answer just changed, and only them.
   *
   * The two routes that change a channel's access list both used to push an
   * "access-changed" event whose comment said each client would ask again -
   * and nothing in the client listens for it, because there is no route to
   * ask with: a channel list only ever arrives in the gateway's ready. So
   * letting somebody into a private channel did nothing at all until they
   * next reloaded, which is the whole of what the feature is for.
   *
   * Said as the two things that actually happened to them: a channel
   * appeared, or a channel went away. Both are events the client has handled
   * since long before this, and the second already points the view somewhere
   * else if they were looking at it.
   */
  function pushAccessChange(channelId: string, spaceId: string | null, before: Set<string>): void {
    if (!spaceId) return
    const after = whoCanReach(channelId, spaceId)
    const changed = [...new Set([...before, ...after])]
      .filter((uid) => before.has(uid) !== after.has(uid))
    if (changed.length === 0) return

    /*
     * Out of the call first, if they were in it.
     *
     * Being in a voice channel is held in memory in the gateway and nowhere
     * else, so taking somebody off a private channel's list left them sitting
     * in it and talking: the sidebar entry went and the call did not. Only
     * the people who lost it - everybody else is still allowed to be there.
     *
     * Before the channel is taken off them rather than after, so there is no
     * moment where their app shows them in a call in a room it has just been
     * told it does not have.
     */
    const lost = changed.filter((uid) => !after.has(uid))
    if (lost.length > 0) clearVoiceForUsers(lost, channelId)

    const channel = channelFor(channelId)
    for (const uid of changed) {
      pushToUsers([uid], after.has(uid)
        ? { t: 'channel-created', channel }
        : { t: 'channel-deleted', id: channelId, spaceId })
    }
  }

  /**
   * Every private channel in a server, and who can reach each of them.
   *
   * The wider sibling of whoCanReach, for changes that are not about one
   * channel: handing somebody a role, taking one away, deleting a role, or
   * editing what a role allows. All four can move which private channels
   * somebody can see, and none of them said so - a role that unlocks a
   * channel put nothing in the sidebar until the person next reloaded, which
   * is the same silence that made letting somebody in by name do nothing.
   *
   * Only the channels whose audience is not simply everybody, because an
   * open one is visible to the whole server and no role changes that.
   *
   * That used to read channels.is_private, which means "@everyone is denied
   * view here" - and missed the channel that says "everybody EXCEPT this one
   * role". Handing out such a role closed the channel on the server and left
   * it sitting in the sidebar until a reload.
   */
  function visibilityIn(spaceId: string | null): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    if (!spaceId) return out
    const channels = channelsWithViewRules(spaceId).map((id) => ({ id }))
    if (channels.length === 0) return out
    /*
     * The expensive one, and the same read cache for the same reason.
     *
     * This is members x restricted-channels, and it runs twice on every role
     * change - before and after - to work out whose sidebar changed.
     * Measured on a synthetic 500 members and 20 restricted channels, with
     * real overrides on them: 3.2 seconds a pass, and 1.9 inside the cache.
     *
     * That is still too slow to be comfortable at that size, and the cache is
     * not the answer to it: with 98% of the reads served, what is left is
     * JavaScript rather than SQLite - resolving one person's permissions from
     * scratch for every channel in turn. The answer is to ask the question
     * the other way round, once per channel, rather than once per pair. It is
     * written down here rather than done because no server on this machine
     * has a restricted channel at all, so the whole function returns on the
     * line above, and rewriting how a private channel decides who may see it
     * is not a thing to do speculatively.
     */
    return withReadCache(() => {
      for (const uid of membersOf(spaceId)) {
        const reach = new Set<string>()
        for (const c of channels) {
          if (canAccessChannel(uid, c.id)) reach.add(c.id)
        }
        out.set(uid, reach)
      }
      return out
    })
  }

  /** Tell everybody whose set of private channels just changed, and only them. */
  function pushVisibilityChange(spaceId: string | null, before: Map<string, Set<string>>): void {
    if (!spaceId) return
    const after = visibilityIn(spaceId)
    for (const [uid, now] of after) {
      const was = before.get(uid) ?? new Set<string>()
      for (const id of now) {
        if (!was.has(id)) pushToUsers([uid], { t: 'channel-created', channel: channelFor(id) })
      }
      for (const id of was) {
        if (now.has(id)) continue
        // Out of the call before the room goes, as everywhere else.
        clearVoiceForUsers([uid], id)
        pushToUsers([uid], { t: 'channel-deleted', id, spaceId })
      }
    }
  }

  /**
   * The server a request is about, or nothing.
   *
   * Everything below used to fall back to the oldest server, so a caller
   * that forgot to say which server it meant quietly acted on the original
   * one - creating a role there, kicking somebody out of it, reading its
   * audit log. Every cross-server bug this app has had was that line.
   *
   * The first server anybody made is not special. It is one server among
   * many, so there is no sensible server to fall back to and a request that
   * does not name one is a request we cannot answer. Loud, rather than
   * quietly wrong somewhere else.
   */
  function needSpace(req: any, reply: any): string | null {
    const fromQuery = (req.query ?? {}) as { spaceId?: string }
    const fromBody = (req.body ?? {}) as { spaceId?: string }
    const id = fromQuery.spaceId || fromBody.spaceId
    if (id) return id
    /*
     * One exception, and it is a migration rather than a default: an install
     * with a single server cannot be ambiguous, and older clients still in
     * somebody's browser do not send it. Once nobody is running those this
     * can go too.
     */
    const only = db.prepare('SELECT id FROM spaces LIMIT 2').all() as Array<{ id: string }>
    if (only.length === 1) return only[0]!.id
    reply.code(400).send({ error: 'which server? this request has to say' })
    return null
  }

  // ------------------------------------------------------------- space ----

  app.get('/api/space', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /*
     * The server being asked about, which is no longer always the same one.
     * Falls back to the original for a client that has not been taught to
     * say which it means.
     */
    const target = needSpace(req, reply)
    if (!target) return
    /* The server asked about. There used to be a fallback here to the single
       `space` row from before servers existed; that table is gone, and a
       target that is not a real server is a 404 rather than something to
       substitute for. */
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    return {
      space,
      permissions: [...permissionsFor(user.id, target)],
      /* In the server being looked at, not in whichever one came first -
         which is what this asked for while the argument was optional. */
      myRoles: rolesFor(user.id, target).map((r) => r.id),
    }
  })

  /**
   * Rename a server, or change what it says about itself.
   *
   * This wrote to the old single-row table, which nothing displays any more -
   * the header and the rail read names out of `spaces`. So renaming a server
   * silently did nothing, and on a machine with two it would have been the
   * wrong one anyway. It takes the server being edited, defaulting to the
   * original for anything that has not been told to send one yet.
   */
  app.patch('/api/space', async (req, reply) => {
    const { name, description } = (req.body ?? {}) as Record<string, string>
    const target = needSpace(req, reply)
    if (!target) return
    const user = await guard(req, reply, 'manage_space', target)
    if (!user) return
    if (!target || !isSpaceMember(user.id, target)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    if (typeof name === 'string' && name.trim()) {
      const clean = name.trim().slice(0, 60)
      db.prepare('UPDATE spaces SET name = ? WHERE id = ?').run(clean, target)
    }
    if (typeof description === 'string') {
      const clean = description.slice(0, 300)
      db.prepare('UPDATE spaces SET description = ? WHERE id = ?').run(clean, target)
    }
    writeAudit(user.id, 'space.update', name ?? '', target)

    // Tell everybody, rather than only whoever typed it. Renaming the space
    // has always been invisible to the rest of the room until they happened
    // to reload; the icon route below was written to broadcast and made the
    // omission here obvious.
    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    // Only the people in it. A rename is not news to somebody who cannot see
    // the server it happened in.
    const who = membersOfContainer(target)
    pushToUsers(who, { t: 'space-update', space })
    return { space }
  })

  /**
   * What somebody is called here, set by somebody else.
   *
   * Its own permission rather than manage_space: renaming people and renaming
   * the place are not the same job, and one is a great deal more personal.
   * Rank still applies, so nobody can rename somebody above them.
   */
  app.post('/api/admin/members/:id/nickname', async (req, reply) => {
    /*
     * In the server the nickname is for.
     *
     * Who may set it is a question about a server, and asking it without one
     * meant the answer came from the original - so renaming somebody in your
     * own server was refused unless you could also rename them in somebody
     * else's.
     *
     * The space now decides where the name lands as well as who may set it.
     * This comment used to end "a nickname is still one name per person here
     * rather than per server", which stopped being true the moment the write
     * below changed and is the kind of line that sends the next person
     * looking for a bug that is gone.
     */
    const forSpace = needSpace(req, reply)
    if (!forSpace) return
    const user = await guard(req, reply, 'manage_nicknames', forSpace)
    if (!user) return

    const { id } = req.params as { id: string }
    const { nickname } = (req.body ?? {}) as { nickname?: string }
    if (typeof nickname !== 'string') {
      return reply.code(400).send({ error: 'nickname must be text' })
    }

    /*
     * Budgeted, for the same reason as banning: renaming somebody is one
     * row and a frame to every member of the server. Higher than the ban
     * budget because typing a name in and changing your mind is ordinary,
     * and because nothing here disconnects anybody.
     */
    if (!allow(`nickname:${user.id}`, 60, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const target = db.prepare('SELECT id, role FROM users WHERE id = ? AND removed_at IS NULL')
      .get(id) as { id: string; role: string } | undefined
    if (!target) return reply.code(404).send({ error: 'no such member' })
    /*
     * And somebody who is actually in this server.
     *
     * It checked that the account existed and that you outrank them, and
     * not that they are here - so a nickname could be written for somebody
     * who is not a member, sitting in the table until the day they join and
     * arriving under a name chosen by a stranger. The same check the kick
     * route makes, one line above the same kind of write.
     */
    if (!isSpaceMember(id, forSpace)) {
      return reply.code(404).send({ error: 'they are not in that server' })
    }
    if (!outranks(user.id, target.id, forSpace)) {
      return reply.code(403).send({ error: 'you cannot rename them' })
    }

    /*
     * Into this server, and no other.
     *
     * It used to be `UPDATE users SET nickname`, which is the whole of what
     * was wrong: the route took a spaceId - it had to, because who may
     * rename somebody is a question about a server - and then wrote a value
     * that belonged to no server at all. Being renamed here renamed you in
     * every other server, and in conversations with people who had never
     * heard of this one.
     */
    const clean = setNicknameIn(forSpace, id, nickname)
    writeAudit(user.id, clean ? 'member.nickname' : 'member.nickname.clear', `${id} -> ${clean}`, forSpace)

    /*
     * To the members of this server, and only them.
     *
     * It was pushAboutMember with the whole user row, which is now both too
     * wide and the wrong shape: too wide because a nickname here is not news
     * to somebody who shares only a conversation with them, and the wrong
     * shape because the name is no longer on the row - it is a fact about
     * the pair, and the frame has to say which server it is about or the
     * client cannot file it.
     */
    pushToUsers(membersOfContainer(forSpace), {
      t: 'nickname-changed', spaceId: forSpace, userId: id, nickname: clean,
    })
    return { nickname: clean }
  })

  // ------------------------------------------------------------- roles ----

  /**
   * The roles of one server.
   *
   * This returned every role in the app. Harmless while one server was
   * the whole server and wrong the moment somebody else has roles of their
   * own - it would list them, and colour people by them.
   */
  app.get('/api/roles', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    const target = needSpace(req, reply)
    if (!target) return
    if (!target || !isSpaceMember(user.id, target)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    const roles = db.prepare(
      `SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`
    ).all(target) as Array<{ id: string }>
    // Only assignments of those roles, so who holds what elsewhere stays there.
    const ids = roles.map((r) => r.id)
    const assignments = ids.length
      ? db.prepare(
          `SELECT user_id, role_id FROM member_roles WHERE role_id IN (${ids.map(() => '?').join(',')})`
        ).all(...ids)
      : []
    return { roles, assignments, available: PERMISSIONS }
  })

  app.post('/api/roles', async (req, reply) => {
    const { name, colour } = (req.body ?? {}) as Record<string, string>
    const target = needSpace(req, reply)
    if (!target) return
    const user = await guard(req, reply, 'manage_roles', target)
    if (!user) return
    if (!target || !isSpaceMember(user.id, target)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    if (!roomFor('roles', target)) {
      return reply.code(429).send({ error: 'this server already has as many roles as it may' })
    }
    const id = randomUUID()

    // A new role sits just below the creator, never above, so it cannot be
    // used to manufacture authority its creator does not have.
    /*
     * Below the creator, always - and running the app is not a rank inside it.
     *
     * This still read `user.role === 'owner' || ownsSpace(...)`, so whoever
     * runs the app created roles at the top of anybody's server. That is how
     * a role ended up above the person who made it, in a server they do not
     * own, leaving them unable to touch the thing they had just created.
     */
    const ceiling = ownsSpace(user.id, target)
      ? 99
      : highestPosition(user.id, target) - 1
    if (ceiling < 1) {
      return reply.code(403).send({ error: 'your role is not high enough to create roles' })
    }
    const top = (db.prepare('SELECT MAX(position) AS p FROM roles WHERE position < ? AND space_id = ?')
      .get(ceiling + 1, target) as unknown as { p: number | null }).p ?? 0

    /*
     * A new role starts where @everyone does.
     *
     * Empty was the literal truth and a poor default: roles stack, so one
     * granting nothing takes nothing away - but the panel then shows every
     * switch off, and the first thing anybody does is turn the ordinary ones
     * back on. Starting from what everyone in this server already has makes a
     * role additive from the first click, which is how people think of them.
     */
    const everyone = db.prepare(
      "SELECT permissions FROM roles WHERE space_id = ? AND kind = 'everyone'"
    ).get(target) as { permissions: string } | undefined
    const startsWith = everyone?.permissions ?? JSON.stringify(EVERYONE_DEFAULTS)

    /*
     * The same hex the edit route insists on.
     *
     * That one refuses anything else and says "only a hex literal ever
     * reaches the stylesheet"; this one took whatever it was given. So the
     * invariant held for every role except the moment one was made, which is
     * the one moment a colour is chosen.
     */
    if (typeof colour === 'string' && colour && !/^#[0-9a-f]{6}$/i.test(colour)) {
      return reply.code(400).send({ error: 'colour must be a hex value like #4C8DFF' })
    }

    db.prepare(
      `INSERT INTO roles (id, name, colour, position, permissions, hoist, mentionable, created_at, space_id, kind)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, 'custom')`
    ).run(id, (name || 'New role').slice(0, 40), colour || '#8395A6',
          Math.min(top + 1, ceiling), startsWith, Date.now(), target)

    writeAudit(user.id, 'role.create', name ?? 'New role', target)
    pushRoles(target)
    return { roles: db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`).all(target) }
  })

  app.patch('/api/roles/:id', async (req, reply) => {
    const { id: roleBeingEdited } = req.params as { id: string }
    const role = db.prepare('SELECT id, kind, space_id FROM roles WHERE id = ?')
      .get(roleBeingEdited) as { id: string; kind: string; space_id: string | null } | undefined
    if (!role) return reply.code(404).send({ error: 'no such role' })
    // The permission is claimed in the role's own server.
    const user = await guard(req, reply, 'manage_roles', role.space_id)
    if (!user) return

    const { id } = req.params as { id: string }

    /*
     * What may change on an Owner role: how it looks, and nothing else.
     *
     * Its permissions are the literal "everything" the ordering is built on,
     * and its position is the ceiling every other role is measured against.
     * The name and the colour are presentation, and an owner being unable to
     * rename the one role that is theirs by definition made no sense.
     */
    if (role.kind === 'owner') {
      const asked = Object.keys((req.body ?? {}) as Record<string, unknown>)
      const allowed = new Set(['name', 'colour', 'hoist', 'mentionable'])
      const refused = asked.filter((k) => !allowed.has(k))
      if (refused.length) {
        return reply.code(400).send({
          error: `the Owner role's ${refused.join(' and ')} cannot be changed`,
        })
      }
    }

    /*
     * The default role keeps its name and does not get its own heading.
     *
     * The panel said so and stopped there - and it decided by the literal id
     * 'everyone', which only the original server's row has. So in every
     * server made since, the field was editable and the switch was offered.
     * A rule the client alone enforces is not a rule; this is where it holds.
     *
     * Its permissions are very much editable: that is the whole point of it.
     */
    if (role.kind === 'everyone') {
      const asked = Object.keys((req.body ?? {}) as Record<string, unknown>)
      const refused = asked.filter((k) => k === 'name' || k === 'hoist')
      if (refused.length) {
        return reply.code(400).send({
          error: `the default role's ${refused.join(' and ')} cannot be changed`,
        })
      }
    }

    // You may only edit roles below your own. Without this, one holder of
    // manage_roles could rewrite every role including the one above them.
    if (!canEditRole(user.id, id)) {
      return reply.code(403).send({ error: 'that role is at or above your own' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    // Taken before anything is written, because what a role allows can
    // include manage_channels, and that is a way into every private channel
    // in the server.
    const seenBefore = visibilityIn(role.space_id)

    if (typeof body.name === 'string' && id !== 'everyone') {
      db.prepare('UPDATE roles SET name = ? WHERE id = ?').run(body.name.slice(0, 40), id)
    }
    if (typeof body.colour === 'string') {
      // Only a hex literal ever reaches the stylesheet.
      if (!/^#[0-9a-f]{6}$/i.test(body.colour)) {
        return reply.code(400).send({ error: 'colour must be a hex value like #4C8DFF' })
      }
      db.prepare('UPDATE roles SET colour = ? WHERE id = ?').run(body.colour, id)
    }
    if (typeof body.hoist === 'boolean') {
      db.prepare('UPDATE roles SET hoist = ? WHERE id = ?').run(body.hoist ? 1 : 0, id)
    }
    if (typeof body.mentionable === 'boolean') {
      db.prepare('UPDATE roles SET mentionable = ? WHERE id = ?').run(body.mentionable ? 1 : 0, id)
    }
    if (Array.isArray(body.permissions)) {
      const asked = (body.permissions as string[]).filter((p) => typeof p === 'string')

      // A name this server has never heard of is not an attempt at anything -
      // it is a permission that was removed, or one the interface offers and
      // nothing enforces. Dropping it silently is right.
      //
      // Treating those two cases as one is what broke role editing entirely:
      // @everyone was seeded with a permission missing from the list below, so
      // saving the role always failed on a name the server itself had granted,
      // and the default role could never be edited again by anybody.
      const known = asked.filter((p) => (PERMISSIONS as readonly string[]).includes(p))

      // Asking for a real permission you do not hold is different, and is the
      // rule that actually closes escalation: even editing @everyone cannot
      // mint something you do not have. Refuse without writing anything - an
      // earlier version saved the filtered set and then returned 403, which
      // quietly emptied the role.
      const grantable = filterGrantable(user.id, known, role.space_id)
      if (grantable.length !== known.length) {
        return reply.code(403).send({
          error: 'you cannot grant a permission you do not have yourself',
        })
      }
      db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(grantable), id)
    }

    writeAudit(user.id, 'role.update', id, role.space_id)
    pushRoles(role.space_id)
    // What a role allows can include manage_channels, which opens every
    // private channel in the server to everybody holding it.
    pushVisibilityChange(role.space_id, seenBefore)
    /* And to everybody, because what a role allows is what everybody holding
       it may now do - the same fact the route above pushes to one person. */
    pushPermissions(role.space_id)
    return { roles: db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`).all(role.space_id) }
  })

  /**
   * Move a role up or down the order.
   *
   * The order is not decoration. `position` is what `outranks` and
   * `canEditRole` measure, so moving a role is changing who may act on whom -
   * which is why this swaps with a neighbour rather than taking a position to
   * write. Handing a number to the client means validating an arbitrary
   * destination; swapping means the only reachable outcomes are ones where
   * both roles were already below the person asking.
   *
   * The three checks that close the hole, in order:
   *
   *   manage_roles      the ordinary permission, in this role's own server
   *   canEditRole(it)   strictly below the asker, so nobody moves their own
   *                     role or one level with it
   *   canEditRole(the   the same of whatever it would swap with - without
   *   neighbour)        this, somebody could walk a role they control up past
   *                     one they do not, and end up above themselves
   *
   * Owner is the ceiling the whole ordering is measured from and @everyone is
   * the floor, so neither moves and neither is a swap candidate.
   */
  /**
   * Put the roles in a given order, for dragging one to where you want it.
   *
   * The arrows moved a role one place at a time, which is fine for a nudge
   * and tedious for anything else. A drag hands over the whole order instead,
   * and the rule that keeps it safe is different in shape from the swap's:
   *
   * Sorted highest first, the roles somebody may not touch are always a
   * prefix - everything at or above their own rank comes before everything
   * below it. So the check is that the prefix is untouched, and only the
   * suffix has been rearranged. That says, in one comparison, both "you did
   * not move a role you do not outrank" and "you did not move one you do
   * outrank above one you do not".
   */
  app.post('/api/roles/reorder', async (req, reply) => {
    const { order, spaceId } = (req.body ?? {}) as { order?: unknown; spaceId?: string | null }
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'order must be a list of ids' })

    const space = order[0]
      ? (db.prepare('SELECT space_id FROM roles WHERE id = ?').get(String(order[0])) as
          unknown as { space_id: string | null } | undefined)?.space_id ?? null
      : (spaceId ?? null)

    const user = await guard(req, reply, 'manage_roles', space)
    if (!user) return

    const current = db.prepare(
      `SELECT id FROM roles
        WHERE space_id IS ? AND kind NOT IN ('owner', 'everyone') ${ROLE_ORDER}`,
    ).all(space) as unknown as Array<{ id: string }>

    const asked = order.map((id) => String(id))
    /*
     * The same roles, rearranged - not a different set. Anything else is a
     * list built against a server that has changed since, and applying it
     * would drop or invent an ordering for roles nobody asked about.
     */
    const same = asked.length === current.length
      && new Set(asked).size === asked.length
      && asked.every((id) => current.some((r) => r.id === id))
    if (!same) {
      return reply.code(400).send({
        error: 'those are not the roles in this server, or one of them is missing',
      })
    }

    /* Where their own reach ends. Everything before this they may not move. */
    const firstMovable = current.findIndex((r) => canEditRole(user.id, r.id))
    const fixedCount = firstMovable === -1 ? current.length : firstMovable
    for (let i = 0; i < fixedCount; i++) {
      if (asked[i] !== current[i]!.id) {
        return reply.code(403).send({ error: 'that would move a role that is not below yours' })
      }
    }

    if (asked.length > 90) {
      return reply.code(400).send({ error: 'that is more roles than the order can hold' })
    }

    const write = db.prepare('UPDATE roles SET position = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      asked.forEach((id, i) => write.run(asked.length - i, id))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    writeAudit(user.id, 'role.reorder', `${asked.length} roles`, space)
    pushPermissions(space)
    return { roles: db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`).all(space) }
  })

  app.post('/api/roles/:id/move', async (req, reply) => {
    const { id } = req.params as { id: string }
    const role = db.prepare('SELECT id, kind, space_id, position FROM roles WHERE id = ?')
      .get(id) as { id: string; kind: string; space_id: string | null; position: number } | undefined
    if (!role) return reply.code(404).send({ error: 'no such role' })

    const user = await guard(req, reply, 'manage_roles', role.space_id)
    if (!user) return

    if (role.kind === 'owner' || role.kind === 'everyone') {
      return reply.code(400).send({
        error: role.kind === 'owner'
          ? 'the Owner role is the top of the order and does not move'
          : 'the default role is the bottom of the order and does not move',
      })
    }
    if (!canEditRole(user.id, role.id)) {
      return reply.code(403).send({ error: 'that role is not below yours' })
    }

    const up = (req.body as { direction?: string } | undefined)?.direction !== 'down'

    /*
     * The movable roles, in the order the app shows them.
     *
     * Worked out from the list rather than from arithmetic on `position`,
     * because two roles can share one. A role is created at
     * `min(top + 1, ceiling)`, and a moderator's ceiling is one below their
     * own rank - so roles they make pile up against it and tie. An earlier
     * version of this looked for a neighbour at a strictly greater position
     * and found none, which left two tied roles permanently unable to move
     * past each other with the buttons giving no hint why.
     */
    const movable = db.prepare(
      `SELECT id FROM roles
        WHERE space_id IS ? AND kind NOT IN ('owner', 'everyone') ${ROLE_ORDER}`,
    ).all(role.space_id) as unknown as Array<{ id: string }>

    const at = movable.findIndex((r) => r.id === role.id)
    // Highest position first, so up the list is earlier in it.
    const to = up ? at - 1 : at + 1
    if (at === -1) return reply.code(404).send({ error: 'no such role' })
    if (to < 0 || to >= movable.length) {
      return reply.code(400).send({
        error: up ? 'it is already at the top' : 'it is already at the bottom',
      })
    }

    const neighbour = movable[to]!
    if (!canEditRole(user.id, neighbour.id)) {
      return reply.code(403).send({
        error: up ? 'the role above it is not below yours' : 'the role below it is not below yours',
      })
    }

    /*
     * Renumbered rather than swapped, which is what makes a tie impossible
     * from here on. Only the two being exchanged change places, so every
     * other outranking relationship is exactly what it was - and @everyone
     * stays at 0 underneath because these start at 1.
     */
    const next = movable.slice()
    next[at] = neighbour
    next[to] = movable[at]!

    // The Owner role sits at 99 and everything else has to stay under it.
    if (next.length > 90) {
      return reply.code(400).send({ error: 'that is more roles than the order can hold' })
    }

    const write = db.prepare('UPDATE roles SET position = ? WHERE id = ?')
    db.exec('BEGIN')
    try {
      next.forEach((r, i) => write.run(next.length - i, r.id))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    writeAudit(user.id, 'role.move', `${role.id} ${up ? 'up' : 'down'}`, role.space_id)
    pushPermissions(role.space_id)
    return { roles: db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`).all(role.space_id) }
  })

  app.delete('/api/roles/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const role = db.prepare('SELECT id, kind, space_id FROM roles WHERE id = ?')
      .get(id) as { id: string; kind: string; space_id: string | null } | undefined
    if (!role) return reply.code(404).send({ error: 'no such role' })
    const user = await guard(req, reply, 'manage_roles', role.space_id)
    if (!user) return

    // By kind, not by a fixed id: every server has a pair of its own now.
    if (role.kind !== 'custom') {
      return reply.code(400).send({ error: 'that role cannot be deleted' })
    }
    if (!canEditRole(user.id, id)) {
      return reply.code(403).send({ error: 'that role is at or above your own' })
    }
    const seen = visibilityIn(role.space_id)
    db.prepare('DELETE FROM roles WHERE id = ?').run(id)
    // And every channel rule that named it. Before the after-picture below,
    // so a channel that was only closed to this role is seen to reopen.
    forgetSubjectOverrides('role', id)
    writeAudit(user.id, 'role.delete', id, role.space_id)
    pushRoles(role.space_id)
    // A deleted role can have been the only way into a private channel.
    pushVisibilityChange(role.space_id, seen)
    return { roles: db.prepare(`SELECT * FROM roles WHERE space_id = ? ${ROLE_ORDER}`).all(role.space_id) }
  })

  // ----------------------------------------------------------- members ----

  /**
   * The member list, with each person's roles.
   *
   * Deliberately open to every member, not just admins: the Members pane is
   * part of the ordinary UI, and the role categories in the sidebar are built
   * from it. It carries public profile fields only - the same ones /api/members
   * already returns - and no password material.
   *
   * It lives here rather than under /api/admin/ precisely so that prefix keeps
   * meaning "guarded". A route that says admin and checks nothing is how the
   * next person to edit it puts something private in it by mistake.
   */
  app.get('/api/members/roles', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /*
     * The members of one server, with the roles they hold in it.
     *
     * This returned every active account in the app and every role each
     * of them held anywhere - so the members panel of a server somebody had
     * just made listed people who had never joined it, each with a Remove
     * button beside them. A server is not a view onto the whole app.
     */
    const target = needSpace(req, reply)
    if (!target) return
    if (!target) return { members: [] }
    if (!isSpaceMember(user.id, target)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    const members = db.prepare(
      `SELECT ${PUBLIC_USER_COLUMNS} FROM users u
         JOIN container_members m ON m.user_id = u.id AND m.container_id = ?
        WHERE ${ACTIVE_USERS}`
    ).all(target) as unknown as User[]

    return {
      members: members.map((m) => ({
        ...m,
        roles: rolesFor(m.id, target).map((r) => r.id),
        // Permissions given to them personally rather than through a role.
        // Sent to every member, the way their roles already are: what
        // somebody may do here is not a secret from the people they may do
        // it to.
        extras: directPermissions(m.id, target),
      })),
    }
  })

  app.post('/api/admin/members/:id/roles', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { roleId, grant } = (req.body ?? {}) as { roleId?: string; grant?: boolean }
    if (!roleId) return reply.code(400).send({ error: 'which role?' })

    /*
     * The permission is claimed in the role's own server.
     *
     * Checked against the original server before, so handing somebody a role
     * in a server you own was refused unless you also had manage_roles in
     * somebody else's - which is precisely backwards.
     */
    const user = await guard(req, reply, 'manage_roles', spaceOfRole(roleId))
    if (!user) return

    const kindOf = db.prepare('SELECT kind FROM roles WHERE id = ?').get(roleId) as
      { kind: string } | undefined
    // By kind, not by id: only the original server's roles are called
    // 'owner' and 'everyone', so every other server's were assignable.
    if (!kindOf || kindOf.kind === 'owner' || kindOf.kind === 'everyone') {
      return reply.code(400).send({ error: 'that role cannot be assigned' })
    }
    // Otherwise manage_roles would let anyone hand themselves the top role.
    if (!canEditRole(user.id, roleId)) {
      return reply.code(403).send({ error: 'that role is at or above your own' })
    }

    const changedIn = spaceOfRole(roleId)
    const seen = visibilityIn(changedIn)
    if (grant) {
      db.prepare('INSERT OR IGNORE INTO member_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId)
    } else {
      db.prepare('DELETE FROM member_roles WHERE user_id = ? AND role_id = ?').run(id, roleId)
    }
    // A role can be what lets somebody into a private channel, so handing one
    // over has to put the channel in their sidebar - not leave it until they
    // next reload.
    pushVisibilityChange(changedIn, seen)
    writeAudit(user.id, grant ? 'member.role.grant' : 'member.role.revoke', `${id} ${roleId}`, changedIn)
    /*
     * Everybody in that server hears about it, and the reply describes that
     * server.
     *
     * Unscoped, this answered with the roles they hold in the original server
     * - so the settings panel, which replaces a member's roles with whatever
     * came back, wrote another server's list into this one. And with nothing
     * pushed at all, every other client kept believing what it was told when
     * it connected, which is why a role could be handed out and then not
     * taken back: the tick was stale, so the next click asked to grant a role
     * they already had rather than to remove it.
     */
    pushMemberRoles(id, changedIn)
    /*
     * And what they may now do, to them.
     *
     * The list of roles somebody holds is not the same fact as the list of
     * things they may do, and only the second one gates anything on screen.
     * Pushing the first alone left the person themselves believing whatever
     * they had been told when they connected - so a role handed to somebody
     * arrived as a tick in a list and changed nothing they could see or press
     * until they reloaded. Reported as permissions not being live.
     *
     * To that one person: nobody else's answer changed.
     */
    pushPermissions(changedIn, [id])
    return { roles: rolesFor(id, changedIn).map((r) => r.id) }
  })

  /**
   * Give one person one permission, without making a role for it.
   *
   * Asked for as "instead of giving them a role I can just give them some
   * perms I want to give them specifically". A role for one person is a role
   * that then has to be named, coloured, ordered and explained, and every
   * server ends up with three of them called things like "trusted".
   *
   * Grant only, and it stacks with their roles the way a second role would.
   * Nothing here takes anything away: if they already have it through
   * @everyone or through a role, removing the grant leaves them holding it,
   * and the panel says as much rather than pretending the switch did nothing.
   */
  app.post('/api/admin/members/:id/permissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { permission, grant } = (req.body ?? {}) as
      { permission?: string; grant?: boolean }

    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'manage_roles', target_space)
    if (!user) return

    if (!permission || !(PERMISSIONS as readonly string[]).includes(permission)) {
      return reply.code(400).send({ error: 'no such permission' })
    }
    if (!isSpaceMember(id, target_space)) {
      return reply.code(404).send({ error: 'they are not in that server' })
    }
    /*
     * The owner of a server already holds everything in it, by definition
     * rather than by a row - so a grant would be a no-op that looks like it
     * worked, and a revoke would be a switch that turns off and changes
     * nothing. Say so instead.
     */
    if (ownsSpace(id, target_space)) {
      return reply.code(400).send({ error: 'the owner of a server already has every permission in it' })
    }

    /*
     * Rank, the same rule role assignment follows.
     *
     * Without it manage_roles is equivalent to owner by another door: you
     * could hand yourself every remaining permission directly, no role
     * involved. outranks is strictly greater, so this also refuses granting
     * to yourself - which is the case that matters.
     */
    if (!outranks(user.id, id, target_space)) {
      return reply.code(403).send({ error: 'you cannot change what they may do' })
    }

    if (grant) {
      // And you can only give away what you hold yourself. The same rule that
      // stops @everyone being edited into a ladder.
      const allowed = filterGrantable(user.id, [permission], target_space)
      if (allowed.length === 0) {
        return reply.code(403).send({
          error: 'you cannot grant a permission you do not have yourself',
        })
      }
      db.prepare(
        `INSERT OR IGNORE INTO member_permissions (space_id, user_id, permission, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(target_space, id, permission, user.id, Date.now())
    } else {
      // Taking one back is not an escalation, so it needs rank and nothing
      // more: somebody who cannot grant a permission can still remove one.
      db.prepare(
        'DELETE FROM member_permissions WHERE space_id = ? AND user_id = ? AND permission = ?'
      ).run(target_space, id, permission)
    }

    writeAudit(
      user.id,
      grant ? 'member.permission.grant' : 'member.permission.revoke',
      `${id} ${permission}`,
      target_space,
    )
    // What they may do just changed, so their own client needs to hear it -
    // otherwise the pane stays shut on something the server would allow.
    pushPermissions(target_space, [id])
    return { permissions: directPermissions(id, target_space) }
  })

  /**
   * The private channels of this server, and which of them this person has
   * been let into by name.
   *
   * The same fact the channel's own "Who can see" dialog writes, read from
   * the other end. Asked for as wanting to let somebody into one channel
   * without making a role for it - which the channel side has always been
   * able to do, from a dialog you have to already be thinking about the
   * channel to find.
   *
   * manage_channels to read, matching that dialog: the list names who has
   * quietly been given access to what.
   */
  app.get('/api/admin/members/:id/channels', async (req, reply) => {
    const { id } = req.params as { id: string }
    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'manage_channels', target_space)
    if (!user) return
    if (!isSpaceMember(id, target_space)) {
      return reply.code(404).send({ error: 'they are not in that server' })
    }

    /*
     * Matching space_id literally, which it used to be wrong to do.
     *
     * A null space_id meant the original server - the one that predates
     * servers existing - so asking for a particular one missed every channel
     * made before then. That is no longer a shape the database will hold: a
     * room has a server if and only if it is not a conversation, as a CHECK,
     * so a text channel with no server cannot be written and there are none.
     */
    /*
     * The same wider question the sidebar asks: channels whose audience is
     * decided by a rule, rather than only the ones @everyone is shut out of.
     * A channel that is open to all but one role is one somebody can
     * sensibly be named on, and naming them beats the role's denial.
     */
    const ruled = new Set(channelsWithViewRules(target_space))
    /* This asked for every text and voice channel on the instance and then
       kept the handful belonging to this server. The answer was right - the
       filter below is scoped - but the work was the whole machine's, on a
       request about one server. Scoped in the query, where idx_channels_space
       answers it. */
    const channels = (db.prepare(
      `SELECT id, name, kind FROM channels
        WHERE space_id = ? AND kind IN ('text', 'voice') ORDER BY position, name`
    ).all(target_space) as Array<{ id: string; name: string; kind: string }>)
      .filter((c) => ruled.has(c.id))

    // Named on the channel itself, which is now a view_channels rule rather
    // than a row in a list of its own. Asked per channel because that is
    // where the answer lives - and because a channel following a category
    // has its answer somewhere else entirely.
    return {
      channels: channels.map((c) => ({
        ...c, allowed: accessFor(c.id).members.includes(id),
      })),
    }
  })

  /**
   * Let one person into one private channel, or take that back.
   *
   * A targeted row rather than a rewrite of the whole access list: the
   * channel dialog sends everything it knows, which is fine when it has just
   * read it and a race waiting to happen from anywhere else.
   */
  app.post('/api/admin/members/:id/channels', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { channelId, grant } = (req.body ?? {}) as { channelId?: string; grant?: boolean }
    if (!channelId) return reply.code(400).send({ error: 'which channel?' })

    // In the channel's own server, which the channel already knows - not
    // whichever one the request happened to name.
    const here = spaceOfChannel(channelId)
    const user = await guard(req, reply, 'manage_channels', here)
    if (!user) return

    const row = db.prepare('SELECT id, kind, is_private FROM channels WHERE id = ?').get(channelId) as
      unknown as { id: string; kind: string; is_private: number | null } | undefined
    if (!row) return reply.code(404).send({ error: 'no such channel' })
    if (isConversationKind(row.kind)) {
      return reply.code(400).send({ error: 'a conversation is private by its members' })
    }
    /*
     * Naming somebody on an open channel would store a row that means
     * nothing: everybody can already see it, and if it is later made private
     * that row silently decides who kept access. Refuse rather than leave
     * that behind.
     */
    if (!channelsWithViewRules(here).includes(channelId)) {
      return reply.code(400).send({ error: 'that channel is already open to everybody here' })
    }
    if (!isSpaceMember(id, here)) {
      return reply.code(404).send({ error: 'they are not in that server' })
    }

    const before = whoCanReach(channelId, here)
    // Taking it back clears the rule rather than denying them, so they fall
    // back to whatever their roles say. Writing a denial would put them below
    // @everyone here, which is a stronger thing than the button offers.
    setViewOverride(channelId, 'member', id, grant ? true : null)

    writeAudit(user.id, grant ? 'channel.access.add' : 'channel.access.remove', `${id} ${channelId}`, here)
    // The channel appears in their sidebar, or goes from it, without a
    // reload. Anybody whose answer did not change hears nothing.
    pushAccessChange(channelId, here, before)
    return { allowed: Boolean(grant) }
  })

  /**
   * Take somebody out of a server, and everything that goes with them.
   *
   * Shared by the kick route and the ban route, which differ in exactly one
   * fact - whether they may come back - and in nothing else. Written out
   * twice they would differ in more than that inside a month: the personal
   * grants, the dropped socket and the list of people told are each easy to
   * leave off a second copy, and each omission is silent. Whoever adds the
   * next thing that has to be cleared will add it here, once.
   *
   * The checks stay with the callers, because the checks are the part that
   * genuinely differs.
   */
  function removeFromSpace(id: string, target_space: string): void {
    /*
     * Who to tell, worked out before they are removed.
     *
     * Afterwards they share nothing with this server, so asking then would
     * answer "nobody" and the member list would keep them until a reload.
     * The other people in the server are the ones who had them on screen.
     */
    const toTell = membersOfContainer(target_space)

    leaveContainer(id, target_space)
    /*
     * And everything the membership carried: their roles here, anything
     * given to them personally here, their name on a private channel's list,
     * and any per-channel or per-category grant made for them.
     *
     * Otherwise removing somebody is not the whole of removing them - the
     * grants sit waiting, and letting them back in silently restores what
     * whoever kicked them had just taken away. In db.ts because leaving of
     * your own accord has to clear exactly the same things, and two copies
     * of a list like this is how two of them end up different.
     */
    forgetMemberIn(target_space, id)

    /*
     * Out of the call before the socket goes.
     *
     * Closing the socket is not leaving the room: being in a call is held in
     * the gateway's map and nowhere else, so a person removed while sitting
     * in one of this server's voice channels stayed in it - audible to
     * everybody, and still listed in the room - while the member list showed
     * them gone. Losing a private channel has cleared the call for a long
     * time; losing the whole server did not.
     *
     * Before the disconnect, so the frame telling their app to hang up
     * reaches a socket that is still open.
     */
    clearVoiceForUserInSpace(id, target_space)

    // Drop any socket they still have open, so the channels they can no
    // longer reach stop arriving before they happen to reload.
    disconnectUser(id)
    pushToUsers([id], { t: 'spaces-changed' })
    /*
     * The people who were in the server with them, not everybody connected.
     *
     * This was pushToAll, so an account that had never seen this server, or
     * this person, was told that a stranger had been removed from somewhere -
     * which is both none of their business and one message per account on the
     * machine for something that concerns a handful of them.
     */
    pushToUsers(toTell, { t: 'member-removed', id })
  }

  /**
   * The refusals a kick and a ban share, asked in the same order.
   *
   * Returns what to send back, or null to go ahead. The order matters and is
   * the reason this is one function: "no such member" before "you cannot
   * touch them" leaks nothing, and the other way round tells anybody holding
   * the permission which ids exist.
   *
   * Not whether they are currently in the server - that is the one condition
   * the two disagree about, and it belongs to the caller.
   */
  function refuseActingOn(
    actorId: string, id: string, target_space: string, verb: 'remove' | 'ban',
  ): { code: number; error: string } | null {
    const past = verb === 'ban' ? 'banned' : 'removed'
    if (id === actorId) return { code: 400, error: `you cannot ${verb} yourself` }
    const target = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as
      unknown as { username: string } | undefined
    if (!target) return { code: 404, error: 'no such member' }
    if (ownsSpace(id, target_space)) {
      return { code: 400, error: `the owner of a server cannot be ${past} from it` }
    }
    // Rank inside this server, not somewhere else.
    if (!outranks(actorId, id, target_space)) {
      return { code: 403, error: `you cannot ${verb} them` }
    }
    return null
  }

  /** The username to write into the audit, or the id if the account is gone. */
  function nameOf(id: string): string {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as
      unknown as { username: string } | undefined
    return row?.username ?? id
  }

  /**
   * Remove somebody from a server.
   *
   * From a server, not from the app. This set removed_at on the account,
   * which deactivated it everywhere - the same thing, for as long as one
   * server was the whole server, and now a way for the owner of any server to
   * take away somebody's account, their own servers and their conversations.
   * It also cannot be undone from anywhere in the app.
   *
   * So it deletes the membership and the roles they held there. Their account,
   * their other servers and everything they have ever said are none of this
   * button's business.
   *
   * And it does not stop them coming back - the same invite works a second
   * later. That is what a kick is, and it is why ban is a separate route
   * rather than a flag on this one.
   */
  app.delete('/api/admin/members/:id', async (req, reply) => {
    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'kick_members', target_space)
    if (!user) return
    if (!target_space || !isSpaceMember(user.id, target_space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    const { id } = req.params as { id: string }
    const refuse = refuseActingOn(user.id, id, target_space, 'remove')
    if (refuse) return reply.code(refuse.code).send({ error: refuse.error })
    if (!isSpaceMember(id, target_space)) {
      return reply.code(404).send({ error: 'they are not in that server' })
    }

    const username = nameOf(id)
    removeFromSpace(id, target_space)
    writeAudit(user.id, 'member.remove', username, target_space)
    return { ok: true }
  })

  // -------------------------------------------------------------- bans ----

  /**
   * Bar somebody from a server.
   *
   * The thing a kick was quietly not. Removing somebody cleared their roles,
   * cleared their personal grants and dropped their socket, and then the
   * invite link they already had let them walk straight back in - so the
   * only servers where a removal meant anything were the ones with no live
   * invite, which is almost none of them.
   *
   * Somebody who has already left can be banned, and that is the ordinary
   * case rather than an edge one: the argument ends, they leave, and the
   * decision gets made afterwards. So membership is not required, and the
   * removal is simply skipped when there is nothing to remove.
   */
  app.post('/api/admin/members/:id/ban', async (req, reply) => {
    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'ban_members', target_space)
    if (!user) return
    if (!isSpaceMember(user.id, target_space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    const { id } = req.params as { id: string }
    const { reason } = (req.body ?? {}) as { reason?: string }
    if (reason !== undefined && typeof reason !== 'string') {
      return reply.code(400).send({ error: 'reason must be text' })
    }

    const refuse = refuseActingOn(user.id, id, target_space, 'ban')
    if (refuse) return reply.code(refuse.code).send({ error: refuse.error })

    /*
     * Budgeted, because one call is a message to everybody in the server.
     *
     * The row is one write; the announcement is a send per member, plus a
     * socket dropped. At a hundred members that is a hundred frames a
     * request, and nothing above this stops a moderator - or a stolen
     * moderator's session - looping it. Generous enough that banning a raid
     * by hand never meets it.
     */
    if (!allow(`ban:${user.id}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }

    const username = nameOf(id)
    const why = (reason ?? '').trim().slice(0, 500)
    /*
     * The row first, then the removal.
     *
     * The other order has a window - however short - where they are out of
     * the server and not yet barred from it, and a client sitting on an
     * invite link retries. Written this way it cannot happen: by the time
     * anything else can run, the answer to "may they join" is already no.
     */
    banFromSpace(target_space, id, user.id, why)
    if (isSpaceMember(id, target_space)) removeFromSpace(id, target_space)
    writeAudit(user.id, 'member.ban', why ? `${username} - ${why}` : username, target_space)
    return { ok: true }
  })

  /**
   * Who is barred, so a ban can be found again to lift it.
   *
   * On ban_members rather than on view_audit_log: this is the list you work
   * from to undo one, and somebody who may bar people has to be able to see
   * whom they have barred. The audit says who decided it and when; this says
   * what is in force now, which is a different question.
   */
  app.get('/api/admin/bans', async (req, reply) => {
    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'ban_members', target_space)
    if (!user) return
    if (!isSpaceMember(user.id, target_space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    return { bans: bansOf(target_space) }
  })

  /**
   * Lift one.
   *
   * It does not put them back in the server - being allowed to return is not
   * the same as returning, and quietly re-joining somebody to a place they
   * were thrown out of is a decision neither of them made. They need an
   * invite, like anybody else.
   *
   * No rank check: the person being unbanned holds nothing here, having no
   * membership and no roles, so there is nobody to outrank. What guards this
   * is the permission and, above it, who may hold the permission.
   */
  app.delete('/api/admin/bans/:id', async (req, reply) => {
    const target_space = needSpace(req, reply)
    if (!target_space) return
    const user = await guard(req, reply, 'ban_members', target_space)
    if (!user) return
    if (!isSpaceMember(user.id, target_space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }

    const { id } = req.params as { id: string }
    /* The same budget as banning, and for the same reason - ban and unban
       in a loop is the same fan-out as banning twice. */
    if (!allow(`ban:${user.id}`, 30, 60_000)) {
      return reply.code(429).send({ error: 'slow down a moment' })
    }
    if (!isBanned(id, target_space)) {
      return reply.code(404).send({ error: 'they are not banned from that server' })
    }
    liftBan(target_space, id)
    writeAudit(user.id, 'member.unban', nameOf(id), target_space)
    return { ok: true }
  })

  // ----------------------------------------------------------- invites ----

  app.get('/api/invites', async (req, reply) => {
    /*
     * The invites of one server.
     *
     * This listed every invite in the app. An invite is a key, and
     * create_invite is one of the permissions everybody has by default - so
     * any member could read the codes for servers they had never been told
     * about and let themselves in. It was the same set of codes for as long
     * as one server was the whole server.
     */
    const target = needSpace(req, reply)
    if (!target) return
    const user = await guard(req, reply, 'create_invite', target)
    if (!user) return
    if (!target || !isSpaceMember(user.id, target)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    /*
     * One server's invites, and only its own.
     *
     * This used to also take the ones with no server at all, on the grounds
     * that an invite written before servers existed belonged to the original
     * one - which meant the original server's list quietly included every
     * unattributed invite in the app. `invites.space_id` is NOT NULL now
     * and the backfill gave the old ones a home, so there is nothing left for
     * that arm to match but a row the database will not accept.
     */
    return {
      invites: db
        .prepare(
          `SELECT * FROM invites
             WHERE (space_id = ?)
             ORDER BY created_at DESC LIMIT 50`
        )
        .all(target),
    }
  })

  app.post('/api/invites', async (req, reply) => {
    // An invite belongs to the server it lets somebody into, so the
    // permission is claimed there.
    const forSpace = needSpace(req, reply)
    if (!forSpace) return
    const user = await guard(req, reply, 'create_invite', forSpace)
    if (!user) return
    if (!roomFor('invites', forSpace)) {
      return reply.code(429).send({ error: 'this server already has as many invites open as it may' })
    }

    const { uses, days } = (req.body ?? {}) as { uses?: number; days?: number }
    const code = `at-${randomBytes(9).toString('hex')}`
    const expires = days && days > 0 ? Date.now() + days * 86_400_000 : null

    /*
     * The server it lets somebody into, written down.
     *
     * This asked which server the permission was being claimed in, checked it
     * there, and then stored the invite without it - so every code made from
     * an Invites pane had a null space and fell back to the first server on
     * the app. Somebody making an invite to their own server was handing
     * out a way into the seeded server, and would have found out when whoever used
     * it turned up in the wrong place.
     *
     * The other two places an invite is made have always stored it. This was
     * the one that did not.
     */
    db.prepare(
      'INSERT INTO invites (code, created_by, uses_left, expires_at, created_at, space_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(code, user.id, Math.max(1, Math.min(Number(uses ?? 1), 100)), expires, Date.now(), forSpace)

    writeAudit(user.id, 'invite.create', code, forSpace)
    /* Anybody with the pane open is looking at a list that just changed. */
    pushInvites(forSpace)
    return { code }
  })

  /**
   * Take back an invite.
   *
   * Yours, or anyone's if you may manage the server.
   *
   * It used to be create_invite alone, which every member holds by default -
   * so anybody who could make one could revoke everybody else's. Somebody
   * who has just been given permission to invite a friend should not be able
   * to quietly close the door the owner left open, and the two acts are not
   * the same size: making a key is yours to do, and taking back a key
   * somebody else cut is a decision about their doing.
   *
   * The wider arm is not decoration. created_by is ON DELETE SET NULL, so an
   * invite made by somebody who has since been removed belongs to nobody -
   * and a strictly-your-own rule would leave a live way into the server that
   * no one on earth could revoke. That is the case the exception exists for,
   * and manage_space is the permission that already means "this server is
   * yours to see to".
   */
  app.delete('/api/invites/:code', async (req, reply) => {
    const { code: revoking } = req.params as { code: string }
    const invite = db.prepare('SELECT space_id, created_by FROM invites WHERE code = ?')
      .get(revoking) as { space_id: string | null; created_by: string | null } | undefined
    // Derived from the invite, so there is nothing for a caller to omit.
    /* Its own server or none. An invite that names none cannot exist, and a
       code that is not there must not be judged against somebody else's. */
    const user = await guard(req, reply, 'create_invite', invite?.space_id ?? null)
    if (!user) return

    /*
     * Asked after the permission check and not before.
     *
     * Answering "no such invite" to somebody who may not touch this server's
     * invites at all would let them ask, one code at a time, which of them
     * exist - the check above is what makes that a question they are entitled
     * to have answered.
     */
    if (!invite) return reply.code(404).send({ error: 'no such invite' })

    const mine = invite.created_by !== null && invite.created_by === user.id
    if (!mine && !permissionsFor(user.id, invite.space_id).has('manage_space')) {
      return reply.code(403).send({ error: 'that invite is not yours to take back' })
    }

    db.prepare('DELETE FROM invites WHERE code = ?').run(revoking)
    /* Whose it was, in the audit line: "revoked an invite" and "revoked
       somebody else's invite" are different things to read back later. */
    writeAudit(
      user.id,
      'invite.revoke',
      mine ? revoking : `${revoking} (made by ${invite.created_by ?? 'nobody'})`,
      invite.space_id,
    )
    pushInvites(invite.space_id)
    return { ok: true }
  })

  // ---------------------------------------------------------- channels ----

  /** A DM is not an administrable channel, whatever permissions you hold. */
  function refuseIfPrivate(id: string, reply: any): boolean {
    const row = db.prepare('SELECT kind FROM channels WHERE id = ?').get(id) as
      unknown as { kind: string } | undefined
    if (row && (isConversationKind(row.kind))) {
      reply.code(403).send({ error: 'that is a private conversation, not a channel' })
      return true
    }
    return false
  }

  app.post('/api/channels', async (req, reply) => {
    const { name, kind, topic, categoryId } = (req.body ?? {}) as Record<string, string>
    // Whose server this channel is for decides who may make it.
    const space = needSpace(req, reply)
    if (!space) return
    const user = await guard(req, reply, 'manage_channels', space)
    if (!user) return
    if (!space || !isSpaceMember(user.id, space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    if (!roomFor('channels', space)) {
      return reply.code(429).send({ error: 'this server already has as many channels as it may' })
    }
    const clean = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)
    if (!clean) return reply.code(400).send({ error: 'a channel needs a name' })

    /*
     * The heading it was made under, if it was made under one.
     *
     * A brand new channel is synced, which is the whole reason the plus sits
     * on the heading rather than only at the top of the list: adding a
     * channel to a locked-down category should give you a locked-down
     * channel, without anybody having to remember to lock it afterwards.
     */
    const category = typeof categoryId === 'string' && categoryId ? categoryId : null
    if (category && spaceOfCategory(category) !== space) {
      return reply.code(400).send({ error: 'that category is in a different server' })
    }

    const id = randomUUID()
    /*
     * Where it lands.
     *
     * Inside a heading it goes after whatever is already under it, which is
     * where somebody who pressed the plus on that heading is looking.
     *
     * With no heading it goes to the *top* instead. One made from the empty
     * space under the list belongs to nobody yet, and the bottom of a long
     * server is the one place its author will not think to look - so it
     * arrives where it can be seen and then dragged wherever it belongs.
     */
    const ends = db.prepare(
      'SELECT MIN(position) AS lo, MAX(position) AS hi FROM channels WHERE kind = ? AND space_id IS ?'
    ).get(kind === 'voice' ? 'voice' : 'text', space) as unknown as
      { lo: number | null; hi: number | null }
    const place = category ? (ends.hi ?? 0) + 1 : (ends.lo ?? 0) - 1

    db.prepare(
      'INSERT INTO channels (id, name, topic, kind, position, created_at, space_id, category_id, perms_synced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(id, clean, (topic ?? '').slice(0, 200), kind === 'voice' ? 'voice' : 'text', place, Date.now(), space, category)
    // A channel made under a locked-down heading is private from the moment
    // it exists, and the lists that read the flag have to know that now
    // rather than the next time somebody edits it.
    refreshPrivacy(id)

    writeAudit(user.id, 'channel.create', clean, space)
    const channel = channelFor(id)
    pushChannelEvent({ t: 'channel-created', channel })
    return { channel }
  })

  app.patch('/api/channels/:id', async (req, reply) => {
    const { id: channelBeingChanged } = req.params as { id: string }
    // In this channel, not merely in its server: a channel that denies
    // manage_channels to a role is not that role's to rename.
    const user = await guardIn(req, reply, 'manage_channels', channelBeingChanged)
    if (!user) return
    const { id } = req.params as { id: string }
    if (refuseIfPrivate(id, reply)) return
    const body = (req.body ?? {}) as Record<string, unknown>
    const { name, topic } = body as Record<string, string>

    if (typeof name === 'string' && name.trim()) {
      const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)
      db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(clean, id)
    }
    if (typeof topic === 'string') {
      db.prepare('UPDATE channels SET topic = ? WHERE id = ?').run(topic.slice(0, 200), id)
    }

    /*
     * The colour of a voice room, or nothing to go back to the one its id
     * gives it.
     *
     * Only when the field is present, and null is a real value here meaning
     * "the default one" - the same rule categoryId below is written to, and
     * for the same reason: a missing field must not clear something somebody
     * set while they were renaming.
     *
     * Checked against a plain hex rather than trusted, because this ends up
     * in a style attribute on everybody's screen and the one thing that must
     * never reach there is somebody else's choice of characters.
     */
    if ('colour' in body) {
      const wanted = typeof body.colour === 'string' ? body.colour.trim() : ''
      if (wanted && !/^#[0-9a-f]{6}$/i.test(wanted)) {
        return reply.code(400).send({ error: 'that is not a colour' })
      }
      db.prepare('UPDATE channels SET colour = ? WHERE id = ?').run(wanted || null, id)
    }

    /*
     * Moving a channel under a different heading, or out from under one.
     *
     * Only when the field is actually present - null is a real value here,
     * meaning the loose group at the top, and treating a missing field as
     * null would drop a channel out of its category every time somebody
     * renamed it.
     *
     * A channel arriving under a new heading keeps whatever it already had:
     * it is unsynced first, so its own rules are written down before the
     * category it is now under can start answering for it. Being dragged
     * into a heading is not consent to that heading's permissions, and the
     * alternative is a channel silently opening or closing as it moves.
     * Sync it deliberately afterwards and it will follow.
     */
    if ('categoryId' in body) {
      const wanted = typeof body.categoryId === 'string' ? body.categoryId : null
      if (wanted && spaceOfCategory(wanted) !== spaceOfChannel(id)) {
        return reply.code(400).send({ error: 'that category is in a different server' })
      }
      const wasIn = (db.prepare('SELECT category_id FROM channels WHERE id = ?').get(id) as
        { category_id: string | null } | undefined)?.category_id ?? null
      if (wasIn !== wanted) {
        unsyncChannel(id)
        db.prepare('UPDATE channels SET category_id = ? WHERE id = ?').run(wanted, id)
      }
    }

    writeAudit(user.id, 'channel.update', id, spaceOfChannel(id))
    const channel = channelFor(id)
    pushChannelEvent({ t: 'channel-updated', channel })
    return { channel }
  })

  app.post('/api/channels/reorder', async (req, reply) => {
    const { order: wantedOrder } = (req.body ?? {}) as { order?: string[] }
    // Every channel in the list belongs to one server; the first tells us
    // which, and the loop below refuses any that disagree.
    /* An empty order names no server, and is refused rather than judged
       against whichever one happens to be oldest. */
    const firstOf = Array.isArray(wantedOrder) && wantedOrder[0]
      ? spaceOfChannel(String(wantedOrder[0]))
      : null
    const user = await guard(req, reply, 'manage_channels', firstOf)
    if (!user) return

    const { order } = (req.body ?? {}) as { order?: string[] }
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'order must be a list of ids' })
    if (order.length > 200) return reply.code(400).send({ error: 'that is more channels than exist' })

    // Positions are rewritten from the list the client sends, so the order it
    // shows and the order it stores can never drift apart. Restricted to
    // public channels so a DM cannot be shuffled by an administrator.
    const update = db.prepare(
      "UPDATE channels SET position = ? WHERE id = ? AND kind IN ('text', 'voice')"
    )
    /*
     * Only channels of the server this was authorised against.
     *
     * The comment above claimed the loop refused any that disagreed. It did
     * not: every id in the list was written. So somebody holding
     * manage_channels in a server of their own could reorder the channels of
     * any server in the app - including private ones they cannot see -
     * by putting one of their own channel ids first and anybody else's after
     * it. The guard read the first id and nothing checked the rest.
     */
    const mine = new Set(
      (db.prepare("SELECT id FROM channels WHERE space_id IS ? AND kind IN ('text', 'voice')")
        .all(firstOf) as Array<{ id: string }>).map((r) => r.id)
    )
    const refused = order.filter((id) => !mine.has(String(id)))
    if (refused.length) {
      return reply.code(400).send({ error: 'those channels are not all in the same server' })
    }
    /*
     * And manage_channels in every one of them, not merely in the server.
     *
     * The guard above answered the server-wide question once. A channel that
     * denies manage_channels is not that role's to move about the list -
     * which is a small thing on its own, and the sort of small thing that
     * makes the row above it look untrustworthy.
     */
    const notTheirs = order.filter(
      (id) => !permissionsIn(user.id, String(id)).has('manage_channels')
    )
    if (notTheirs.length) {
      return reply.code(403).send({ error: 'you cannot manage all of those channels' })
    }
    order.forEach((id, i) => update.run(i, String(id)))
    writeAudit(user.id, 'channel.reorder', String(order.length), firstOf)
    // That server's channels, named to that server. Sending every channel on
    // the app told everybody connected the id and position of channels in
    // servers they are not in.
    pushChannelEvent({
      t: 'channels-reordered',
      spaceId: firstOf,
      channels: db.prepare(
        "SELECT id, position FROM channels WHERE space_id IS ? AND kind IN ('text','voice')"
      ).all(firstOf),
    })
    return { ok: true }
  })

  app.delete('/api/channels/:id', async (req, reply) => {
    const { id: channelBeingChanged } = req.params as { id: string }
    // In this channel. Deleting one is the heaviest thing manage_channels
    // allows, so it is the last place to read a wider answer than asked for.
    const user = await guardIn(req, reply, 'manage_channels', channelBeingChanged)
    if (!user) return
    const { id } = req.params as { id: string }
    if (refuseIfPrivate(id, reply)) return

    /*
     * A server must keep somewhere to talk, so its last text channel stays.
     *
     * Only when the channel being deleted is a text one. This counted the
     * server's text channels and refused whatever was being deleted - so in a
     * server with a single text channel, deleting a *voice* channel was
     * turned down for a reason that had nothing to do with it, which is
     * exactly how it was reported.
     */
    const being = db.prepare('SELECT kind, space_id FROM channels WHERE id = ?').get(id) as
      { kind: string; space_id: string | null } | undefined
    if (!being) return reply.code(404).send({ error: 'no such channel' })

    if (being.kind === 'text') {
      const remaining = db.prepare(
        "SELECT COUNT(*) AS n FROM channels WHERE kind = 'text' AND space_id IS ?"
      ).get(being.space_id) as unknown as { n: number }
      if (remaining.n <= 1) {
        return reply.code(400).send({ error: 'the last text channel cannot be deleted' })
      }
    }
    db.prepare('DELETE FROM channels WHERE id = ?').run(id)
    // No foreign key reaches these - the target column holds a channel id or
    // a category id, so nothing can cascade. Left behind, they would be
    // inherited by whatever next held this id.
    forgetOverrides('channel', id)
    writeAudit(user.id, 'channel.delete', id, being.space_id)
    pushChannelEvent({ t: 'channel-deleted', id, spaceId: being.space_id })
    return { ok: true }
  })

  // --------------------------------------------------------------- DMs ----

  /**
   * Who can get into a channel.
   *
   * Reading the list needs manage_channels, the same permission as changing
   * it: the list names people and roles, and somebody who cannot edit it has
   * no reason to see who has been quietly given access to what.
   */
  app.get('/api/channels/:id/access', async (req, reply) => {
    const { id: channelBeingChanged } = req.params as { id: string }
    const user = await guardIn(req, reply, 'manage_channels', channelBeingChanged)
    if (!user) return
    const { id } = req.params as { id: string }
    return { access: accessFor(id) }
  })

  app.put('/api/channels/:id/access', async (req, reply) => {
    const { id: channelBeingChanged } = req.params as { id: string }
    const user = await guardIn(req, reply, 'manage_channels', channelBeingChanged)
    if (!user) return

    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT id, kind FROM channels WHERE id = ?').get(id) as
      unknown as { id: string; kind: string } | undefined
    if (!row) return reply.code(404).send({ error: 'no such channel' })
    if (isConversationKind(row.kind)) {
      return reply.code(400).send({ error: 'a conversation is private by its members' })
    }

    const body = (req.body ?? {}) as { private?: boolean; roles?: string[]; members?: string[] }
    /*
     * Roles and people of this server, and nobody else's.
     *
     * Whatever ids were sent used to be stored. So one server's private
     * channel could be opened to "whoever holds this role", naming a role in
     * a completely different server - which is meaningless to say and, with
     * the role lookup below being machine-wide, was very nearly meaningful to
     * act on.
     */
    const here = spaceOfChannel(id)
    const rolesHere = new Set(
      (db.prepare('SELECT id FROM roles WHERE space_id IS ?').all(here) as Array<{ id: string }>)
        .map((r) => r.id)
    )
    const roles = (body.roles ?? [])
      .filter((r) => typeof r === 'string' && rolesHere.has(r))
    const members = (body.members ?? [])
      .filter((m) => typeof m === 'string' && isSpaceMember(m, here))

    const before = whoCanReach(id, here)
    setAccess(id, Boolean(body.private), roles, members)
    writeAudit(user.id, 'channel.access', `${id} ${body.private ? 'private' : 'open'}`, spaceOfChannel(id))

    // Only the people whose answer changed, and told as the thing that
    // happened to them rather than as an event nothing listens for.
    pushAccessChange(id, here, before)
    pushPermissions(here)
    pushChannelEvent({ t: 'channel-updated', channel: channelFor(id) })
    return { access: accessFor(id) }
  })

  // ------------------------------------------------------- categories ----

  /**
   * The headings channels are arranged under.
   *
   * Readable by anybody in the server, unlike the permission rows below: a
   * heading is what the sidebar draws, and a client that cannot read them
   * cannot draw the list at all. What a category *allows* is a different
   * question and needs manage_roles, the same as a role's own permissions.
   */
  /** Where Text and Voice sit, for a client drawing the list. */
  const loosePositions = (space: string | null) => {
    const row = db.prepare('SELECT loose_text_pos AS text, loose_voice_pos AS voice FROM spaces WHERE id = ?')
      .get(space) as unknown as { text: number; voice: number } | undefined
    return { text: row?.text ?? -2, voice: row?.voice ?? -1 }
  }

  app.get('/api/categories', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })
    const space = needSpace(req, reply)
    if (!space) return
    if (!isSpaceMember(user.id, space)) {
      return reply.code(403).send({ error: 'you are not in that server' })
    }
    return { categories: categoriesIn(space), loose: loosePositions(space) }
  })

  app.post('/api/categories', async (req, reply) => {
    const space = needSpace(req, reply)
    if (!space) return
    const user = await guard(req, reply, 'manage_channels', space)
    if (!user) return
    if (!roomFor('categories', space)) {
      return reply.code(429).send({ error: 'this server already has as many headings as it may' })
    }

    const { name } = (req.body ?? {}) as Record<string, string>
    /*
     * A heading keeps the case somebody typed, unlike a channel name.
     *
     * Channel names are lowercased and hyphenated because they are addresses
     * - you type them after a hash. A category is only ever read, so
     * flattening "Board Games" into "board-games" would be taking something
     * away for a consistency nobody benefits from.
     */
    const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!clean) return reply.code(400).send({ error: 'a category needs a name' })

    const id = randomUUID()
    const top = (db.prepare('SELECT MAX(position) AS p FROM categories WHERE space_id IS ?')
      .get(space) as unknown as { p: number | null }).p ?? -1
    db.prepare(
      'INSERT INTO categories (id, space_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, space, clean, top + 1, Date.now())

    writeAudit(user.id, 'category.create', clean, space)
    pushToUsers(membersOf(space), { t: 'categories-changed', spaceId: space, categories: categoriesIn(space) })
    return { category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) }
  })

  app.patch('/api/categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    /*
     * Signed in before the lookup, not after.
     *
     * Reading the category first answered "no such category" to somebody who
     * had not said who they were - which is a small oracle, category ids
     * being random, and an inconsistent front door. Everything else here
     * refuses a stranger before it looks anything up; these four did not.
     */
    if (!(await authed(req))) return reply.code(401).send({ error: 'not signed in' })
    const space = spaceOfCategory(id)
    if (!space) return reply.code(404).send({ error: 'no such category' })
    const user = await guard(req, reply, 'manage_channels', space)
    if (!user) return

    const { name } = (req.body ?? {}) as Record<string, string>
    const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!clean) return reply.code(400).send({ error: 'a category needs a name' })
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(clean, id)

    writeAudit(user.id, 'category.update', `${id} ${clean}`, space)
    pushToUsers(membersOf(space), { t: 'categories-changed', spaceId: space, categories: categoriesIn(space) })
    return { category: db.prepare('SELECT * FROM categories WHERE id = ?').get(id) }
  })

  /**
   * Delete a heading. Its channels come loose rather than going with it.
   *
   * Deleting a category in Discord takes the channels with it, and that is
   * the single most reported accident in it. A heading is a way of arranging
   * things; removing the arrangement should not remove the things.
   *
   * A channel that was synced has to be given the rules it was reading,
   * before the rows it was reading them from go. Otherwise a private channel
   * quietly becomes an open one at the moment somebody tidies up the
   * sidebar, which is about as bad as this gets.
   */
  app.delete('/api/categories/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!(await authed(req))) return reply.code(401).send({ error: 'not signed in' })
    const space = spaceOfCategory(id)
    if (!space) return reply.code(404).send({ error: 'no such category' })
    const user = await guard(req, reply, 'manage_channels', space)
    if (!user) return

    const under = db.prepare('SELECT id FROM channels WHERE category_id = ?')
      .all(id) as unknown as Array<{ id: string }>
    for (const c of under) unsyncChannel(c.id)
    db.prepare('UPDATE channels SET category_id = NULL WHERE category_id = ?').run(id)
    forgetOverrides('category', id)
    db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    for (const c of under) refreshPrivacy(c.id)

    writeAudit(user.id, 'category.delete', id, space)
    pushToUsers(membersOf(space), { t: 'categories-changed', spaceId: space, categories: categoriesIn(space) })
    for (const c of under) pushChannelEvent({ t: 'channel-updated', channel: channelFor(c.id) })
    return { ok: true }
  })

  /**
   * The order of the headings, including the two that are not categories.
   *
   * Text and Voice hold whatever nobody has filed. They are not rows in the
   * categories table, so they had no position and could not be moved - they
   * were simply drawn first. They are named here by two reserved ids and
   * their positions live on the space, which is the cheapest way to give
   * them a place in an order they are not really part of.
   */
  app.post('/api/categories/reorder', async (req, reply) => {
    const { order, spaceId } = (req.body ?? {}) as { order?: string[]; spaceId?: string | null }
    if (!Array.isArray(order)) return reply.code(400).send({ error: 'order must be a list of ids' })
    if (order.length > 100) return reply.code(400).send({ error: 'that is more categories than exist' })

    const LOOSE = new Set(['loose:text', 'loose:voice'])
    const ids = order.map((id) => String(id))
    const realFirst = ids.find((id) => !LOOSE.has(id))

    /*
     * The space comes from a real category when there is one. A list of
     * nothing but the two loose groups names no category at all, so the body
     * has to say which server it means.
     */
    const space = realFirst ? spaceOfCategory(realFirst) : (spaceId ?? needSpace(req, reply))
    if (!space) return reply.code(404).send({ error: 'no such category' })
    const user = await guard(req, reply, 'manage_channels', space)
    if (!user) return

    // Every id has to be in the server this was authorised against, the same
    // check channel reordering learned to make: one of your own ids first
    // and somebody else's after it would otherwise rearrange their server.
    const mine = new Set(categoriesIn(space).map((c) => c.id))
    if (ids.some((id) => !LOOSE.has(id) && !mine.has(id))) {
      return reply.code(400).send({ error: 'those categories are not all in the same server' })
    }

    const update = db.prepare('UPDATE categories SET position = ? WHERE id = ?')
    const loose = db.prepare('UPDATE spaces SET loose_text_pos = ?, loose_voice_pos = ? WHERE id = ?')
    let textAt: number | null = null
    let voiceAt: number | null = null

    db.exec('BEGIN')
    try {
      ids.forEach((id, i) => {
        if (id === 'loose:text') textAt = i
        else if (id === 'loose:voice') voiceAt = i
        else update.run(i, id)
      })
      /*
       * Only when the list actually carried them. A caller that sends the
       * categories alone is not asking to move Text and Voice to the top.
       */
      if (textAt !== null || voiceAt !== null) {
        const now = db.prepare('SELECT loose_text_pos AS t, loose_voice_pos AS v FROM spaces WHERE id = ?')
          .get(space) as unknown as { t: number; v: number } | undefined
        loose.run(textAt ?? now?.t ?? -2, voiceAt ?? now?.v ?? -1, space)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }

    writeAudit(user.id, 'category.reorder', String(ids.length), space)
    pushToUsers(membersOf(space), {
      t: 'categories-changed', spaceId: space, categories: categoriesIn(space),
      loose: loosePositions(space),
    })
    return { ok: true, loose: loosePositions(space) }
  })

  // ---------------------------------------------- per-channel overrides ----

  /**
   * What one channel or category says, over and above the server's roles.
   *
   * Needs manage_roles, not manage_channels. Renaming a channel and deciding
   * who may speak in it are different sizes of act: the first is tidying,
   * the second is authority, and the permission that says "you may change
   * what people can do" is the one that should gate it.
   */
  function readOverrides(scope: 'channel' | 'category', targetId: string) {
    return overridesAt(scope, targetId).map((o) => ({
      kind: o.kind, subjectId: o.subject_id, permission: o.permission, allow: o.allow === 1,
    }))
  }

  app.get('/api/channels/:id/permissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = await guardIn(req, reply, 'manage_roles', id)
    if (!user) return
    const row = db.prepare(
      'SELECT id, kind, category_id, perms_synced FROM channels WHERE id = ?'
    ).get(id) as unknown as
      { id: string; kind: string; category_id: string | null; perms_synced: number } | undefined
    if (!row) return reply.code(404).send({ error: 'no such channel' })
    if (isConversationKind(row.kind)) {
      return reply.code(400).send({ error: 'a conversation is private by its members' })
    }
    const at = overrideTarget(id)
    const category = row.category_id
      ? db.prepare('SELECT id, name FROM categories WHERE id = ?').get(row.category_id)
      : null
    return {
      scope: at.scope,
      targetId: at.id,
      synced: Boolean(row.category_id) && row.perms_synced !== 0,
      category,
      overrides: readOverrides(at.scope, at.id),
    }
  })

  /**
   * Set everything one role or one person is given in one channel.
   *
   * A whole subject at a time rather than a permission at a time, because
   * that is the unit the panel edits and because it makes clearing one
   * obvious: send no rules and the subject goes back to inheriting, with
   * nothing stale left behind quietly saying yes.
   *
   * Editing a synced channel breaks the sync first. The alternative is
   * writing to the category, and then changing one thing about one channel
   * would change it about ten.
   */
  app.put('/api/channels/:id/permissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const space = spaceOfChannel(id)
    /*
     * Asked of the channel. This is the check that makes a channel closable
     * to a moderator at all - measured server-wide, somebody denied
     * manage_roles here could simply delete the denial and carry on.
     */
    const user = await guardIn(req, reply, 'manage_roles', id)
    if (!user) return
    const row = db.prepare('SELECT id, kind FROM channels WHERE id = ?').get(id) as
      unknown as { id: string; kind: string } | undefined
    if (!row) return reply.code(404).send({ error: 'no such channel' })
    if (isConversationKind(row.kind)) {
      return reply.code(400).send({ error: 'a conversation is private by its members' })
    }
    const asked = subjectAndRules(req, reply, space, user, overrideTarget(id))
    if (!asked) return

    const before = whoCanReach(id, space)
    unsyncChannel(id)
    setOverride('channel', id, asked.kind, asked.subjectId, asked.rules)
    refreshPrivacy(id)
    writeAudit(user.id, 'channel.permissions', `${id} ${asked.kind} ${asked.subjectId}`, space)

    pushAccessChange(id, space, before)
    pushPermissions(space)
    pushChannelEvent({ t: 'channel-updated', channel: channelFor(id) })
    const at = overrideTarget(id)
    return { scope: at.scope, targetId: at.id, synced: false, overrides: readOverrides(at.scope, at.id) }
  })

  /** Follow the category again, or stop following it and keep what you had. */
  app.post('/api/channels/:id/permissions/sync', async (req, reply) => {
    const { id } = req.params as { id: string }
    const space = spaceOfChannel(id)
    // Syncing is a way of replacing this channel's rules wholesale, so it
    // needs exactly what replacing one of them needs.
    const user = await guardIn(req, reply, 'manage_roles', id)
    if (!user) return
    const row = db.prepare('SELECT id, category_id FROM channels WHERE id = ?').get(id) as
      unknown as { id: string; category_id: string | null } | undefined
    if (!row) return reply.code(404).send({ error: 'no such channel' })
    if (!row.category_id) {
      return reply.code(400).send({ error: 'that channel is not in a category' })
    }
    const { synced } = (req.body ?? {}) as { synced?: boolean }

    const before = whoCanReach(id, space)
    if (synced) syncChannel(id)
    else unsyncChannel(id)
    refreshPrivacy(id)
    writeAudit(user.id, 'channel.permissions.sync', `${id} ${synced ? 'on' : 'off'}`, space)

    pushAccessChange(id, space, before)
    pushPermissions(space)
    pushChannelEvent({ t: 'channel-updated', channel: channelFor(id) })
    const at = overrideTarget(id)
    return { scope: at.scope, targetId: at.id, synced: Boolean(synced), overrides: readOverrides(at.scope, at.id) }
  })

  app.get('/api/categories/:id/permissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!(await authed(req))) return reply.code(401).send({ error: 'not signed in' })
    const space = spaceOfCategory(id)
    if (!space) return reply.code(404).send({ error: 'no such category' })
    const user = await guard(req, reply, 'manage_roles', space)
    if (!user) return
    return { scope: 'category', targetId: id, overrides: readOverrides('category', id) }
  })

  /**
   * The same, for a heading - and so for every channel still following it.
   *
   * Which is the point of categories carrying permissions at all: one edit
   * that moves ten channels, instead of ten edits that have to agree.
   */
  app.put('/api/categories/:id/permissions', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!(await authed(req))) return reply.code(401).send({ error: 'not signed in' })
    const space = spaceOfCategory(id)
    if (!space) return reply.code(404).send({ error: 'no such category' })
    const user = await guard(req, reply, 'manage_roles', space)
    if (!user) return
    const asked = subjectAndRules(req, reply, space, user, { scope: 'category', id })
    if (!asked) return

    /*
     * Who could reach each following channel, before and after.
     *
     * Per channel rather than for the category, because the category is not
     * a place anybody can be: what changed is which rooms opened and closed,
     * and that is what has to be told to whom.
     */
    const following = db.prepare(
      "SELECT id FROM channels WHERE category_id = ? AND perms_synced = 1 AND kind IN ('text', 'voice')"
    ).all(id) as unknown as Array<{ id: string }>
    const before = new Map(following.map((c) => [c.id, whoCanReach(c.id, space)]))

    setOverride('category', id, asked.kind, asked.subjectId, asked.rules)
    refreshPrivacyUnder(id)
    writeAudit(user.id, 'category.permissions', `${id} ${asked.kind} ${asked.subjectId}`, space)

    for (const c of following) {
      pushAccessChange(c.id, space, before.get(c.id) ?? new Set())
      pushChannelEvent({ t: 'channel-updated', channel: channelFor(c.id) })
    }
    pushPermissions(space)
    return { scope: 'category', targetId: id, overrides: readOverrides('category', id) }
  })

  app.get('/api/dms', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    /*
     * With when something was last said in each.
     *
     * Ordered by when the conversation was MADE before this, and carrying no
     * other time - so after a reload the client had nothing to sort by and
     * the list came back in the order the conversations had been created.
     * Somebody you spoke to a minute ago sat wherever they had always sat,
     * and only a message arriving live moved anything.
     *
     * Sorted here as well, so a client that does not sort still gets a
     * sensible list, and a conversation with nothing in it yet falls back to
     * when it was made rather than to the bottom for ever.
     */
    const rows = db
      .prepare(
        `SELECT c.*,
                COALESCE((SELECT MAX(m.created_at) FROM messages m
                           WHERE m.channel_id = c.id AND m.deleted_at IS NULL),
                         c.created_at) AS last_at
           FROM channels c
           JOIN container_members m ON m.container_id = c.id
           JOIN containers k ON k.id = m.container_id AND k.kind IN ('dm','group')
          WHERE m.user_id = ?
          ORDER BY last_at DESC`
      )
      .all(user.id) as unknown as Array<Record<string, unknown>>

    return {
      dms: rows.map((c) => ({
        ...c,
        members: membersOfContainer(String(c.id)).map((user_id) => ({ user_id })),
      })),
    }
  })

  /** Do these two already have a one-to-one conversation? */
  function existingDm(a: string, b: string): boolean {
    return Boolean(conversationBetween(a, b))
  }

  app.post('/api/dms', async (req, reply) => {
    const user = await authed(req)
    if (!user) return reply.code(401).send({ error: 'not signed in' })

    // One person or several: dm_members has always been a join table with no
    // limit of two, so a group is the same shape with more rows in it.
    const body = (req.body ?? {}) as { userId?: string; userIds?: string[] }
    const wanted = [...new Set(
      (body.userIds ?? (body.userId ? [body.userId] : []))
        .filter((id) => typeof id === 'string' && id !== user.id)
    )]

    if (wanted.length === 0) return reply.code(400).send({ error: 'pick someone else' })
    // Beyond this a group conversation wants a channel, not a DM.
    if (wanted.length > 9) return reply.code(400).send({ error: 'a group DM holds ten people at most' })

    const others = wanted.map((id) =>
      db.prepare(`SELECT id, display_name FROM users WHERE id = ? AND ${ACTIVE_USERS}`).get(id) as
        unknown as { id: string; display_name: string } | undefined
    )
    if (others.some((o) => !o)) return reply.code(404).send({ error: 'no such member' })

    /*
     * And somebody you may actually contact.
     *
     * This checked that the people existed and that there were not too many,
     * and nothing else - so any account could open a conversation with any
     * other account in the app, given an id, whether or not the two had
     * ever agreed to hear from each other. The picker in the client only ever
     * offers friends, but the route is what decides.
     *
     * Found by audit. It predates group conversations and applied to
     * one-to-one ones just the same; what the group route changed is the
     * scale, since one call can now name nine people at once.
     *
     * canSeeMember is the rule the rest of the app already uses for whether
     * two people know of each other at all: friends, or sharing a server, or
     * already in a conversation together. Somebody you can see is somebody
     * you may write to.
     */
    const unreachable = wanted.filter((id) => !canSeeMember(user.id, id))
    if (unreachable.length > 0) {
      return reply.code(403).send({
        error: 'you can only start a conversation with friends, or people you share a server with',
      })
    }

    /*
     * And somebody neither of you has blocked.
     *
     * Underneath canSeeMember rather than folded into it. Being blocked is
     * not the same as being invisible: a block does not take somebody out of
     * the member list, off their own messages, or out of a server you share
     * - it stops one person reaching another, and that is a different
     * question with a different answer.
     *
     * Either direction. Blocking somebody and finding they can still open a
     * conversation with you is not blocking them.
     */
    const stopped = wanted.filter((id) => blockedBetween(user.id, id))
    if (stopped.length > 0) {
      return reply.code(403).send({
        error: wanted.length > 1
          ? 'somebody in that group has been blocked, or has blocked you'
          : 'you cannot start a conversation with them',
      })
    }

    /*
     * A group asks for more than that: friends, or somebody already talking
     * to you.
     *
     * Sharing a server is how you meet somebody, and it is the right rule for
     * writing to one person - a new member nobody has added yet has to be
     * reachable, or nobody can say hello to them and they cannot say it back.
     * It is the wrong rule for a group. Being in a server with eight people
     * is not agreeing to be put in a room with them, and one call names nine.
     *
     * "Already talking to you" rather than only friends because it is the
     * same consent said a different way: a one-to-one conversation that
     * exists is two people who have written to each other.
     */
    if (wanted.length > 1) {
      const strangers = wanted.filter(
        (id) => !areFriends(user.id, id) && !existingDm(user.id, id)
      )
      if (strangers.length > 0) {
        return reply.code(403).send({
          error: 'a group is for friends, or people you already have a conversation with',
        })
      }
    }
    const named = others as Array<{ id: string; display_name: string }>
    const other = named[0]!

    /*
     * Reuse an existing one-to-one conversation rather than making a second.
     *
     * Only for a pair, which the comment here has always said and the code
     * did not do: it asked for the conversation between you and the first
     * person named, whether one person was named or five. So asking for a
     * group with bob and cass handed back the conversation you already had
     * with bob, cass was silently not in it, and the caller was told it had
     * worked.
     *
     * Two groups with overlapping members are different conversations, so
     * there is nothing to reuse for a group - matching on membership would
     * conflate them.
     */
    if (wanted.length === 1) {
      const found = conversationBetween(user.id, wanted[0]!)
      if (found) return { channel: channelFor(found) }
    }

    const id = randomUUID()
    // A group is named after its members, because it has no other name.
    const name = named.length === 1
      ? other.display_name
      : named.map((o) => o.display_name).join(', ').slice(0, 80)

    const now = Date.now()
    db.prepare(
      "INSERT INTO channels (id, name, topic, kind, position, created_at) VALUES (?, ?, '', 'dm', 0, ?)"
    ).run(id, name, now)
    makeContainer(id, 'dm', now)
    joinContainer(user.id, id)
    for (const o of named) joinContainer(o.id, id)

    const channel = channelFor(id)

    // Both sides get the conversation immediately. The other person's client
    // needs it before the first message arrives, or the message lands in a
    // channel they do not know exists.
    pushToUsers([user.id, ...named.map((o) => o.id)], { t: 'channel-created', channel })
    return { channel }
  })

  // --------------------------------------------------------- audit log ----

  app.get('/api/audit', async (req, reply) => {
    const auditOf = needSpace(req, reply)
    if (!auditOf) return
    const user = await guard(req, reply, 'view_audit_log', auditOf)
    if (!user) return

    return {
      /*
       * This server's entries, and only this server's.
       *
       * The gate above already asked which server and checked the permission
       * in it - and then this read the whole table, so the answer to "who may
       * read this log" was enforced while the log itself was everybody's.
       */
      entries: db
        .prepare(
          `SELECT a.*, u.display_name AS actor_name
             FROM audit a LEFT JOIN users u ON u.id = a.actor_id
            WHERE a.space_id = ?
            ORDER BY a.created_at DESC LIMIT 100`
        )
        .all(auditOf),
    }
  })

  // ----------------------------------------------------------- storage ----

  app.get('/api/admin/storage', async (req, reply) => {
    /*
     * The disk, which belongs to the hardware and not to a server.
     *
     * This was gated on manage_space, which everybody holds inside a server
     * they made - so making one was enough to read how much space everybody
     * else's uploads were taking. Then on the account that had claimed the
     * install, which was the same mistake further back: running the app is
     * not a rank inside it.
     *
     * A secret now, and no sign-in: this is not about who anybody is.
     */
    if (!isOperator(req.headers)) {
      return reply.code(404).send({ error: 'not found' })
    }

    let images = 0, video = 0, other = 0, files = 0
    try {
      for (const name of readdirSync(config.uploadDir)) {
        const size = statSync(resolve(config.uploadDir, name)).size
        files += 1
        if (/\.(png|jpe?g|webp|gif)$/i.test(name)) images += size
        else if (/\.(mp4|webm)$/i.test(name)) video += size
        else other += size
      }
    } catch { /* upload dir may not exist yet */ }

    // The -wal file beside it holds most of what has been written recently;
    // counting only the main file reported a few kilobytes for the lot.
    const dbSize = (() => {
      const base = resolve(config.dataDir, 'atrium.db')
      let total = 0
      for (const suffix of ['', '-wal', '-shm']) {
        try { total += statSync(base + suffix).size } catch { /* may not exist */ }
      }
      return total
    })()

    const counts = db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL) AS messages,
         (SELECT COUNT(*) FROM users) AS members,
         (SELECT COUNT(*) FROM attachments) AS attachments`
    ).get()

    /*
     * And the two directions the folder and the database can disagree in.
     *
     * Reported here as well as in the daily log line because this is the
     * page somebody actually opens. `missing` is the troubling one: a record
     * pointing at a file that is not there is somebody being told they still
     * have something they do not.
     */
    const { unreferenced, missing } = reconcileUploads()

    return {
      files, images, video, other, database: dbSize,
      total: images + video + other + dbSize,
      maxUploadBytes: config.maxUploadBytes,
      counts,
      missing: missing.length,
      unreferenced: unreferenced.length,
    }
  })
}

/**
 * Avatar and banner uploads.
 *
 * Kept separate from /api/upload because these replace a previous file and
 * write a path onto the user row, and because only images are ever valid
 * here - a PDF avatar is not a thing.
 */
/**
 * What goes in the database: the path, never the signed link.
 *
 * saveImage hands back a signed url, because that is what the uploader needs
 * to draw the picture immediately. Storing it verbatim puts an expiry and a
 * signature into a column that every lookup matches by name - so the orphan
 * sweep cannot recognise the file and may remove one still in use, and the
 * picture stops loading the day the signature runs out.
 *
 * It was stripped for a server icon and not for an avatar. Three accounts
 * were found holding links due to expire a week later, which would have read
 * as their picture simply vanishing. One definition now, used by all three,
 * so the next route cannot get it wrong either.
 */
/**
 * How large a profile picture from the GIF picker may be.
 *
 * Matches ANIMATED_LIMIT in the browser's shrinkimage.ts, which refuses an
 * animated file chosen off disk for the same reason: a canvas resizes one by
 * drawing a single frame, so shrinking an animation destroys it. This is the
 * server's half of the same rule, and it has to exist separately because the
 * picker never sends a file - it sends a URL for the server to fetch.
 */
const ANIMATED_PROFILE_LIMIT = 2 * 1024 * 1024

function storedPath(url: string): string {
  return String(url).split('?')[0] ?? ''
}

export function registerAvatarRoutes(
  app: FastifyInstance,
  authed: Authed,
  /** Takes the uploader, so the upload can be recorded against them. */
  saveImage: (req: unknown, mime: string, uploaderId: string) => Promise<{ url: string; bytes: number }>,
  /**
   * Fetch a picture from elsewhere and keep our own copy of it.
   *
   * Passed in rather than written here for the same reason saveImage is: the
   * size ceiling and the never-trust-what-it-claims-to-be rule live in one
   * place, next to the upload path they were written for.
   */
  saveFromUrl: (url: string) => Promise<{ url: string; bytes: number }>
): void {
  const IMAGE_ONLY = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

  /** Delete a file this server wrote, and only ever that. */
  function removeStored(path: string | null): void {
    if (!path || !path.startsWith('/uploads/')) return
    const stale = resolve(config.uploadDir, path.replace('/uploads/', ''))
    if (!stale.startsWith(resolve(config.uploadDir))) return
    try { unlinkSync(stale) } catch { /* already gone */ }
  }

  /** Whoever may rename the space may also change its picture. */
  /**
   * May this person change this server?
   *
   * The server was hardcoded to the original one, so somebody setting an icon
   * on a server they own was refused unless they could also manage somebody
   * else's - which is how "you cannot change the space" came back for a
   * server whose owner was asking.
   */
  async function mayManageSpace(req: any, reply: any) {
    const user = await authed(req)
    if (!user) { reply.code(401).send({ error: 'not signed in' }); return null }
    /*
     * Which server, said explicitly - or the only one there is.
     *
     * Out of reach of needSpace, which lives inside the route registration,
     * so it repeats the rule rather than importing a default it should not
     * have: an install with one server cannot be ambiguous, and more than one
     * means the caller has to say.
     */
    const asked = ((req.query ?? {}) as { spaceId?: string }).spaceId
    const only = db.prepare('SELECT id FROM spaces LIMIT 2').all() as Array<{ id: string }>
    const target = asked || (only.length === 1 ? only[0]!.id : null)
    if (!target) {
      reply.code(400).send({ error: 'which server? this request has to say' })
      return null
    }
    if (!permissionsFor(user.id, target).has('manage_space')) {
      reply.code(403).send({ error: 'you cannot change that server' })
      return null
    }
    return { user, spaceId: target }
  }

  /**
   * The picture on the space itself, in place of its initials.
   *
   * Here rather than in PATCH /api/space because it is a raw image body
   * rather than a JSON field - the same reason avatars have their own route.
   */
  app.post('/api/space/icon', async (req: any, reply: any) => {
    const who = await mayManageSpace(req, reply)
    if (!who) return
    const { user, spaceId: target } = who

    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim()
    if (!IMAGE_ONLY.has(mime)) {
      return reply.code(415).send({ error: 'that needs to be a PNG, JPEG, WebP or GIF' })
    }

    // From the server being changed, not the single row the original used.
    const previous = (db.prepare('SELECT icon_path AS p FROM spaces WHERE id = ?').get(target) as
      unknown as { p: string | null } | undefined)?.p ?? null

    let saved
    try {
      saved = await saveImage(req, mime, user.id)
    } catch (err) {
      return reply.code(413).send({ error: err instanceof Error ? err.message : 'upload failed' })
    }

    const iconPath = storedPath(saved.url)
    db.prepare('UPDATE spaces SET icon_path = ? WHERE id = ?').run(iconPath, target)
    removeStored(previous)
    writeAudit(user.id, 'space.icon', saved.url, target)

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    // Only the people in it: a server's icon is not news to anybody else.
    const who2 = membersOfContainer(target)
    pushToUsers(who2, { t: 'space-update', space })
    return { space }
  })

  /**
   * The picture across the top of the channel list.
   *
   * The same shape as the icon above, and deliberately a separate picture:
   * an icon is a small square read at thirty pixels and a banner is a wide
   * strip read at three hundred, so one image cannot be both. The strip used
   * to stretch the icon, which looks exactly like a small square blown up.
   */
  app.post('/api/space/banner', async (req: any, reply: any) => {
    const who = await mayManageSpace(req, reply)
    if (!who) return
    const { user, spaceId: target } = who

    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim()
    if (!IMAGE_ONLY.has(mime)) {
      return reply.code(415).send({ error: 'that needs to be a PNG, JPEG, WebP or GIF' })
    }

    const previous = (db.prepare('SELECT banner_path AS p FROM spaces WHERE id = ?').get(target) as
      unknown as { p: string | null } | undefined)?.p ?? null

    let saved
    try {
      saved = await saveImage(req, mime, user.id)
    } catch (err) {
      return reply.code(413).send({ error: err instanceof Error ? err.message : 'upload failed' })
    }

    db.prepare('UPDATE spaces SET banner_path = ? WHERE id = ?')
      .run(storedPath(saved.url), target)
    removeStored(previous)
    writeAudit(user.id, 'space.banner', saved.url, target)

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    pushToUsers(membersOfContainer(target), { t: 'space-update', space })
    return { space }
  })

  /** Take it off again, which puts the art back. */
  app.delete('/api/space/banner', async (req: any, reply: any) => {
    const who = await mayManageSpace(req, reply)
    if (!who) return
    const { user, spaceId: target } = who

    const previous = (db.prepare('SELECT banner_path AS p FROM spaces WHERE id = ?').get(target) as
      unknown as { p: string | null } | undefined)?.p ?? null
    db.prepare('UPDATE spaces SET banner_path = NULL WHERE id = ?').run(target)
    removeStored(previous)
    writeAudit(user.id, 'space.banner.clear', '', target)

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    pushToUsers(membersOfContainer(target), { t: 'space-update', space })
    return { space }
  })

  app.delete('/api/space/icon', async (req: any, reply: any) => {
    const who = await mayManageSpace(req, reply)
    if (!who) return
    const { user, spaceId: target } = who

    const previous = (db.prepare('SELECT icon_path AS p FROM spaces WHERE id = ?').get(target) as
      unknown as { p: string | null } | undefined)?.p ?? null
    db.prepare('UPDATE spaces SET icon_path = NULL WHERE id = ?').run(target)
    removeStored(previous)
    writeAudit(user.id, 'space.icon.clear', '', target)

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(target)
    const who2 = membersOfContainer(target)
    pushToUsers(who2, { t: 'space-update', space })
    return { space }
  })

  for (const kind of ['avatar', 'banner'] as const) {
    app.post(`/api/me/${kind}`, async (req: any, reply: any) => {
      const user = await authed(req)
      if (!user) return reply.code(401).send({ error: 'not signed in' })

      const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim()
      if (!IMAGE_ONLY.has(mime)) {
        return reply.code(415).send({ error: 'that needs to be a PNG, JPEG, WebP or GIF' })
      }

      const column = kind === 'avatar' ? 'avatar_path' : 'banner_path'
      const previous = (db.prepare(`SELECT ${column} AS p FROM users WHERE id = ?`).get(user.id) as
        unknown as { p: string | null } | undefined)?.p ?? null

      let saved
      try {
        saved = await saveImage(req, mime, user.id)
      } catch (err) {
        return reply.code(413).send({ error: err instanceof Error ? err.message : 'upload failed' })
      }

      /*
       * The browser refuses an oversized animated one before sending, and the
       * browser is not the enforcement point. A canvas cannot resize an
       * animation without flattening it, so there is no shrinking this on the
       * way in - the only answer is not to store it.
       *
       * Only animated formats: a large PNG is shrunk on the way in and, if it
       * somehow arrives whole, costs one profile rather than every member
       * list.
       */
      if (mime === 'image/gif' && saved.bytes > ANIMATED_PROFILE_LIMIT) {
        removeStored(storedPath(saved.url))
        const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
        return reply.code(413).send({
          error: `That ${kind} is ${mb(saved.bytes)}. An animated picture cannot be made `
            + `smaller without losing the animation, so the limit for one is `
            + `${mb(ANIMATED_PROFILE_LIMIT)}.`,
        })
      }

      db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`)
        .run(storedPath(saved.url), user.id)

      // Remove the file this one replaced, so avatars do not accumulate
      // forever. Only ever a path we wrote ourselves.
      if (previous && previous.startsWith('/uploads/')) {
        const stale = resolve(config.uploadDir, previous.replace('/uploads/', ''))
        if (stale.startsWith(resolve(config.uploadDir))) {
          try { unlinkSync(stale) } catch { /* already gone */ }
        }
      }

      // The people who can see them, for the same reason the nickname route
      // above says: a profile is not a stranger's to be handed.
      pushAboutMember(user.id, {
        t: 'member-update',
        user: db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(user.id),
      })
      return { url: saved.url, bytes: saved.bytes }
    })

    /**
     * The same thing, from a GIF somebody chose rather than a file.
     *
     * Asked for as picking one from GIPHY instead of uploading. The server
     * fetches it and keeps its own copy rather than writing the provider's
     * address onto the row: an avatar is drawn for
     * everybody who can see you, so hotlinking one would hand GIPHY the
     * address of every person who so much as scrolled past your name. That is
     * the same reason images and link previews already go through the proxy.
     *
     * Which means the server fetches a URL a member named, so the guard on
     * which URLs is the whole of the security of this route.
     */
    app.post(`/api/me/${kind}/gif`, async (req: any, reply: any) => {
      const user = await authed(req)
      if (!user) return reply.code(401).send({ error: 'not signed in' })

      const { url } = (req.body ?? {}) as { url?: string }
      if (typeof url !== 'string' || !isProviderUrl(url)) {
        return reply.code(400).send({ error: 'that is not a picture from the GIF picker' })
      }
      // A member can ask for a lot of these cheaply, and each one is a
      // request this machine makes to somewhere else.
      if (!allow(`gif-image:${user.id}`, 20, 60_000)) {
        return reply.code(429).send({ error: 'slow down a moment' })
      }

      let saved
      try {
        saved = await saveFromUrl(url)
      } catch (err) {
        const why = err instanceof Error ? err.message : 'could not fetch that'
        return reply.code(/not a|too large/.test(why) ? 415 : 502).send({ error: why })
      }
      /*
       * The same ceiling an uploaded one answers to.
       *
       * A file chosen off disk is shrunk in the browser before it is sent,
       * and an animated one is refused above ANIMATED_LIMIT because a canvas
       * cannot resize it without flattening it. A picture taken from the GIF
       * picker skips all of that - it is fetched here - so without this the
       * easier path was also the one with no limit at all: 3 MB refused from
       * a file picker, 20 MB accepted from the grid beside it.
       */
      if (saved.bytes > ANIMATED_PROFILE_LIMIT) {
        removeStored(storedPath(saved.url))
        const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
        return reply.code(413).send({
          error: `That one is ${mb(saved.bytes)}. An animated picture cannot be made smaller `
            + `without losing the animation, so the limit for one is ${mb(ANIMATED_PROFILE_LIMIT)}.`,
        })
      }

      const column = kind === 'avatar' ? 'avatar_path' : 'banner_path'
      const previous = (db.prepare(`SELECT ${column} AS p FROM users WHERE id = ?`).get(user.id) as
        unknown as { p: string | null } | undefined)?.p ?? null

      db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`)
        .run(storedPath(saved.url), user.id)
      // Recorded like any other upload. A profile picture is never attached
      // to a message, so nothing breaks without it - but a file this server
      // wrote with no record of who asked for it is the gap the ledger
      // exists to close, and leaving one open invites the next one.
      rememberUpload(
        (saved.url.split('?')[0] ?? '').split('/').pop() ?? '', user.id, '', saved.bytes,
      )
      removeStored(previous)

      // The people who can see them, for the same reason the nickname route
      // above says: a profile is not a stranger's to be handed.
      pushAboutMember(user.id, {
        t: 'member-update',
        user: db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(user.id),
      })
      return { url: saved.url, bytes: saved.bytes }
    })

    app.delete(`/api/me/${kind}`, async (req: any, reply: any) => {
      const user = await authed(req)
      if (!user) return reply.code(401).send({ error: 'not signed in' })
      const column = kind === 'avatar' ? 'avatar_path' : 'banner_path'
      db.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?`).run(user.id)
      // The people who can see them, for the same reason the nickname route
      // above says: a profile is not a stranger's to be handed.
      pushAboutMember(user.id, {
        t: 'member-update',
        user: db.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`).get(user.id),
      })
      return { ok: true }
    })
  }
}
