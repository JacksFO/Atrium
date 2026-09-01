import { isConversationKind } from './kinds.js'
import { db, isSpaceMember, ownsSpace, everyoneRoleId, ROLE_ORDER_R, EVERYONE_DEFAULTS } from './db.js'

/**
 * Permissions are stored as a JSON array of strings on each role.
 *
 * A bitfield would be smaller, but at this scale readability wins: you can
 * open the database and see exactly what a role can do without a lookup table.
 */
export const PERMISSIONS = [
  /*
   * Everything, without listing everything.
   *
   * Held rather than expanded on the row: a role carries `administrator` and
   * permissionsFor turns it into the whole set, so a permission added later
   * is held by every administrator the moment it exists rather than the day
   * somebody remembers to tick it in twelve servers.
   *
   * It is not ownership. Deleting the server, and editing the Owner role,
   * are guarded on being the owner rather than on holding anything - see
   * mayEditRole and the delete route - so this cannot reach either.
   */
  'administrator',
  // General
  'view_channels',
  'manage_channels',
  'manage_roles',
  'manage_space',
  'view_audit_log',
  // Membership
  'create_invite',
  'kick_members',
  /*
   * Barring somebody rather than showing them out.
   *
   * Separate from kick_members because they are different decisions with
   * different lifetimes: a kick ends the moment they click the invite again,
   * and this one does not end until somebody lifts it. Trusting a moderator
   * to break up an argument is not the same as trusting them to decide who
   * is never coming back.
   *
   * It does not imply kick_members, and holding it is enough on its own -
   * banning somebody who is in the server takes them out as part of the same
   * act, and needing two permissions to do one thing is how a role ends up
   * granting the stronger one to get at the weaker.
   */
  'ban_members',
  // Voice
  'move_members',
  /*
   * Silencing somebody in a call.
   *
   * Its own permission because it was manage_messages, which is "delete
   * anybody's messages" - so somebody trusted to tidy up a channel could
   * also mute a person mid-sentence in a voice room, and there was no way to
   * give one without the other. Two different rooms and two different acts.
   *
   * Mute and deafen together rather than one each. Deafening is the stronger
   * form of the same decision - you may not hear them, they may not hear you
   * - and two switches for it would be two switches nobody distinguishes
   * between. Moving people is still move_members: taking somebody's voice
   * and carrying them into another room are not the same thing either.
   */
  'mute_members',
  // Names
  'manage_nicknames',
  // Messages
  'send_messages',
  'attach_files',
  'add_reactions',
  'mention_everyone',
  /*
   * Asking a question, which is not quite the same as saying something.
   *
   * A poll persists, collects answers from everybody and sits at the top of
   * what a channel is for while it runs — so it is worth being able to allow
   * somebody to talk without letting them do that. Given to @everyone by
   * default, because the ordinary case is that anybody may ask.
   */
  'create_polls',
  'manage_messages',
  'read_history',
  /*
   * Pinning, on its own.
   *
   * It used to ride on manage_messages, which is "delete anybody's messages"
   * - a far heavier thing than putting a message on a list, and the only way
   * to let somebody pin was to let them delete. Asked for as being able to
   * allow people and roles to pin, unpin and clear up the line that says so.
   *
   * manage_messages still allows it, so nobody who could pin this morning has
   * lost the ability: the new permission adds a way to have it without the
   * heavier one, rather than taking the old way away.
   */
  'manage_pins',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * The permissions a single channel can have an opinion about.
 *
 * Not all of them. Kicking somebody, renaming the server and reading the
 * audit log happen to a server rather than in a room, and offering a row for
 * them per channel would be offering a switch that does nothing - which
 * reads as broken rather than as absent, the same reason the channel menu
 * has no "copy link".
 *
 * Everything here is enforced against a channel somewhere. If a permission
 * is added to this list, the place that checks it has to start asking
 * permissionsIn() rather than permissionsFor(), or the switch will be honest
 * about its intent and wrong about its effect.
 */
export const CHANNEL_PERMISSIONS: Permission[] = [
  'view_channels',
  'manage_channels',
  'manage_roles',
  /*
   * create_invite is deliberately NOT here.
   *
   * It was, for one commit, copied across from the app this borrows its
   * shape from - where an invite is a link to a channel and a channel can
   * therefore have an opinion about who makes one. Here an invite belongs to
   * the server: POST /api/invites names a space and nothing else, and there
   * is no per-channel invite for a rule to govern. So the row was a switch
   * with nothing behind it, which reads as broken rather than as absent -
   * the same reason the channel menu has no "copy link".
   */
  'send_messages',
  'attach_files',
  'add_reactions',
  'mention_everyone',
  'create_polls',
  'manage_messages',
  'manage_pins',
  'read_history',
  'move_members',
]

/**
 * Which of those are worth showing against a voice channel.
 *
 * send_messages is in this list because it is what decides who may talk. The
 * voice token is minted with canPublish set from permissionsIn(user, channel)
 * .has('send_messages') - the same permission, read in the same channel, on
 * the grounds that speaking in a room is saying something in it. That has
 * always been the rule; what was missing was any way to set it, because this
 * list is what the permissions pane offers and it was not on it. So a voice
 * channel could be made listen-only by the server and by nobody using it.
 */
export const VOICE_CHANNEL_PERMISSIONS: Permission[] = [
  'view_channels',
  'send_messages',
  'manage_channels',
  'manage_roles',
  'move_members',
]

/* What a brand new member can do before any role is granted. It lives in
   db.ts, beside the two places that seed an @everyone role with it - keeping
   the list here and the seeds there is how they came apart. Re-exported so
   every caller can go on asking this file about permissions. */
export { EVERYONE_DEFAULTS } from './db.js'

/**
 * What being in a conversation lets you do.
 *
 * A DM has no server, and until now that meant it had no answer either: the
 * permission lookup fell through to the oldest server, so what two people could
 * do inside their own private conversation was decided by the @everyone role
 * of the first server anybody made - one neither of them need ever have
 * joined. Editing a role in that server silently changed moderation inside
 * strangers' private messages, and whoever owned it held every permission in
 * every conversation they were part of, by inheritance rather than by
 * anybody's decision.
 *
 * So a conversation grants a fixed set instead, and the set is the same for
 * both people in it. Being in it is the whole of the permission.
 *
 * manage_messages is deliberately not here. You may delete what you sent -
 * that is checked against the author, not against a permission - and nobody
 * may delete what you sent. The answer to something you did not want to
 * receive is to close or block the conversation, not to edit somebody else's
 * side of it.
 *
 * Nor is mention_everyone, which names nobody here, or anything about
 * managing channels, roles or invites - a conversation has none of them.
 */
export const CONVERSATION_PERMISSIONS: Permission[] = [
  'view_channels', 'send_messages', 'attach_files',
  'add_reactions', 'create_polls', 'read_history', 'manage_pins',
]

export type Role = {
  id: string
  name: string
  colour: string
  position: number
  permissions: string
  hoist: number
  mentionable: number
  created_at: number
}


/**
 * The roles somebody holds, in one server.
 *
 * Roles belong to a space now, so holding one in your own server must not
 * give you anything in somebody else's.
 *
 * There used to be an "or no space at all" allowance here for roles made
 * before servers existed. A migration gave every one of them a server at boot
 * and nothing has created a role without a space since, so it matched
 * nothing - checked against the live database: no role, and no text or voice
 * channel, has a null space.
 */
export function rolesFor(userId: string, spaceId?: string | null): Role[] {
  /*
   * No server means no server.
   *
   * This used to fall back to the oldest server: asked about nothing, it answered
   * about whichever server happened to be created first. That is a leftover
   * from when there was exactly one, and it is a wrong answer rather than a
   * missing one - which is the worse kind, because it looks like an answer.
   */
  const space = spaceId ?? null
  return db
    .prepare(
      `SELECT r.* FROM roles r
         JOIN member_roles mr ON mr.role_id = r.id
        WHERE mr.user_id = ? AND r.space_id = ?
        ${ROLE_ORDER_R}`
    )
    .all(userId, space) as unknown as Role[]
}

/**
 * Permissions given to one person directly, in one server.
 *
 * The escape hatch for "just let them do this one thing" - a role made for a
 * single person is a role that then has to be named, coloured, ordered and
 * explained to everybody else.
 *
 * Grant only, and it stacks: this adds to whatever their roles already allow
 * and can never subtract from it. A permission with no row here is not denied,
 * it is simply not given by this route.
 *
 * Unknown names are dropped rather than trusted. A permission that has since
 * been removed from the list leaves its rows behind, and those rows must not
 * quietly become something else if a name is ever reused.
 */
export function directPermissions(userId: string, spaceId?: string | null): Permission[] {
  /*
   * No server means no server.
   *
   * This used to fall back to the oldest server: asked about nothing, it answered
   * about whichever server happened to be created first. That is a leftover
   * from when there was exactly one, and it is a wrong answer rather than a
   * missing one - which is the worse kind, because it looks like an answer.
   */
  const space = spaceId ?? null
  if (!space) return []
  const rows = db
    .prepare('SELECT permission FROM member_permissions WHERE user_id = ? AND space_id = ?')
    .all(userId, space) as unknown as Array<{ permission: string }>
  return rows
    .map((r) => r.permission)
    .filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p))
}

function parse(json: string): Permission[] {
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? (list as Permission[]) : []
  } catch {
    return []
  }
}

/**
 * Everything a member may do: the union of @everyone and each granted role.
 *
 * Roles stack rather than override — a member gets the sum of what their roles
 * allow, which is what "highest role wins" servers get wrong and then have to
 * explain to people.
 */
/*
 * isHost is gone, and with it the last account that meant anything outside a
 * server.
 *
 * It answered "is this the account that claimed the install", which opened
 * the health and storage pages. Narrow, and still the wrong shape: running
 * Atrium is not a rank inside Atrium, any more than the people who run any
 * other app are a role in somebody's group on it. Those two pages are proved
 * with a secret now - see isOperator in auth.ts - and no account is special.
 *
 * Further back it was worse: whoever ran the app held every permission in
 * every space, outranked every member and could edit any role, so somebody
 * who made a server of their own found a stranger sitting at the top of it.
 */

/*
 * userRole used to be threaded in here, and nothing has read it since the
 * instance owner stopped holding rights inside other people's servers. It is
 * worse than dead: a reader of `permissionsFor(id, role, space)` reasonably
 * concludes that the global role feeds the answer, which is exactly the bug
 * that was fixed - "a friend who made a server of their own found the app's
 * owner sitting at the top of it".
 *
 * There is no global role left to feed it. The status and storage pages,
 * the last two things that ever read one, are proved with the operator's
 * secret now - see isOperator - because they are about the hardware and not
 * about anybody's server.
 */
export function permissionsFor(
  userId: string,
  spaceId?: string | null,
): Set<Permission> {
  /*
   * And whoever made a server has every right inside it.
   *
   * Without this, making your own server got you a room you could not manage:
   * permissions came from a single instance-wide role, so an ordinary account
   * that created a space could not add a channel to it. The feature would have
   * shipped looking complete and doing nothing.
   */
  if (ownsSpace(userId, spaceId ?? null)) return new Set(PERMISSIONS)

  /*
   * A server somebody is not in grants them nothing.
   *
   * This read the named server's @everyone role and handed those permissions
   * to whoever asked, member or not - so a stranger came back holding
   * view_channels, send_messages and five more, in a server they had never
   * joined.
   *
   * Nothing leaked. The channel list is filtered again by canAccessChannel,
   * and that does check membership, so the answer people actually saw was
   * right. But it meant the whole of that guarantee rested on the second
   * check while the first returned a confidently wrong answer - and the next
   * person to reach for this with a server in their hand would have been told
   * yes. Two checks, one wrong, one load-bearing, is how a leak arrives
   * later.
   *
   * Only when a server is actually named. `null` here means "no server" -
   * a conversation, or a caller with nothing in its hand - and that still
   * falls through to the older behaviour below, because unpicking it is a
   * separate job with its own 29 call sites.
   */
  if (spaceId && !isSpaceMember(userId, spaceId)) return new Set()

  /*
   * This server's own @everyone.
   *
   * Written when the original space was the only one that had roles, so it
   * read the row literally called 'everyone' and used the built-in defaults
   * for anywhere else. Every server has had its own @everyone since - so
   * editing it in your own server changed nothing whatsoever, and every
   * member of it kept the defaults for ever no matter what the panel showed.
   *
   * By space and by kind. The literal id 'everyone' used to be matched as
   * well, because the original server's row predates kinds - but a migration
   * sets kind on that row at every boot, and the space backfill gives it a
   * space, so both halves of the special case matched nothing. Verified
   * against the live database: every @everyone row has kind and a space.
   */
  const everyone = db.prepare(
    `SELECT permissions FROM roles
      WHERE space_id = ? AND kind = 'everyone'
      LIMIT 1`
  ).get(spaceId ?? null) as unknown as { permissions: string } | undefined

  const granted = new Set<Permission>(everyone ? parse(everyone.permissions) : EVERYONE_DEFAULTS)
  for (const role of rolesFor(userId, spaceId)) {
    for (const p of parse(role.permissions)) granted.add(p)
  }

  /*
   * Administrator is the rest of the list, by definition.
   *
   * Expanded here, in the one place that answers "what may they do", so
   * every caller gets the same answer without any of them having to know
   * the rule. What it deliberately does not confer is ownership: the two
   * things it cannot reach - deleting the server, and rewriting the Owner
   * role - are guarded on being the owner, not on holding a permission.
   */
  if (granted.has('administrator' as Permission)) return new Set(PERMISSIONS)
  // And anything given to them personally, which stacks the same way a second
  // role would. Last because it reads as "on top of", not because order
  // matters - a set of grants has no precedence to get wrong.
  for (const p of directPermissions(userId, spaceId)) granted.add(p)
  return granted
}

export function can(
  userId: string,
  permission: Permission,
  spaceId?: string | null,
): boolean {
  return permissionsFor(userId, spaceId).has(permission)
}

// ------------------------------------------------- per-channel overrides ---

export type OverrideScope = 'channel' | 'category'

export type Override = {
  kind: 'role' | 'member'
  subject_id: string
  permission: Permission
  /** 1 allows, 0 denies. There is no row for "neither". */
  allow: number
}

type ChannelShape = {
  id: string
  kind: string
  space_id: string | null
  category_id: string | null
  perms_synced: number | null
}

function channelShape(channelId: string): ChannelShape | undefined {
  return db.prepare(
    'SELECT id, kind, space_id, category_id, perms_synced FROM channels WHERE id = ?'
  ).get(channelId) as unknown as ChannelShape | undefined
}

/**
 * Where a channel's overrides actually live.
 *
 * Its category while it is synced, itself once it is not. Nothing is copied
 * to keep a synced channel in step: it simply reads the category's rows, so
 * editing the category moves everything under it at once and the two have no
 * way to drift into disagreeing.
 *
 * A channel with no category is always its own, whatever the flag says.
 * Synced to nothing is not a state worth having - it would mean a channel
 * with no permissions of its own and nowhere to get any.
 */
export function overrideTarget(channelId: string): { scope: OverrideScope; id: string } {
  const row = channelShape(channelId)
  if (row?.category_id && row.perms_synced !== 0) return { scope: 'category', id: row.category_id }
  return { scope: 'channel', id: channelId }
}

export function overridesAt(scope: OverrideScope, targetId: string): Override[] {
  const rows = db.prepare(
    `SELECT kind, subject_id, permission, allow FROM permission_overrides
      WHERE scope = ? AND target_id = ?`
  ).all(scope, targetId) as unknown as Array<{
    kind: string; subject_id: string; permission: string; allow: number
  }>
  // Unknown names are dropped rather than trusted, for the same reason
  // directPermissions drops them: a permission removed from the list leaves
  // its rows behind, and they must not become something else if a name is
  // ever reused.
  return rows
    .filter((r) => (CHANNEL_PERMISSIONS as readonly string[]).includes(r.permission))
    .map((r) => ({
      kind: r.kind === 'member' ? 'member' : 'role',
      subject_id: r.subject_id,
      permission: r.permission as Permission,
      allow: r.allow ? 1 : 0,
    }))
}

/** Everything said about one channel, wherever it is currently reading from. */
export function overridesForChannel(channelId: string): Override[] {
  const at = overrideTarget(channelId)
  return overridesAt(at.scope, at.id)
}

/**
 * What somebody may do IN one channel.
 *
 * The server-wide answer first, then the channel's exceptions to it, in a
 * fixed order that is the whole reason this can be reasoned about:
 *
 *   1. everything their roles and grants allow across the server
 *   2. what @everyone is denied here, then allowed here
 *   3. what any role they hold is denied here, then allowed here
 *   4. what they personally are denied here, then allowed here
 *
 * Two rules are doing the work. Allow beats deny at the same level, so a
 * role that opens a channel wins over one that closes it and nobody is shut
 * out by holding an extra role. And a narrower level beats a wider one, so
 * naming one person overrules every role they hold - which is the request
 * this exists for: everybody may speak here except them.
 *
 * Roles are collected before either is applied, rather than role by role.
 * Applied in turn, the last role read would win, and which role that is
 * depends on the order rows come back in - so the same two roles would give
 * two different answers on two different days.
 */
export function permissionsIn(
  userId: string,
  channelId: string,
): Set<Permission> {
  const row = channelShape(channelId)
  const space = row?.space_id ?? null

  // A channel that is not there grants nothing. This used to fall through to
  // the same lookup as a conversation, which answered with a server's roles
  // for a channel that does not exist.
  if (!row) return new Set()

  /*
   * A conversation answers for itself. See CONVERSATION_PERMISSIONS: it has
   * no roles to override, and no server whose roles could sensibly apply.
   */
  if (isConversationKind(row.kind)) {
    return new Set(CONVERSATION_PERMISSIONS)
  }
  const at = overrideTarget(channelId)
  return permissionsAt(userId, space, at.scope, at.id)
}

/**
 * The same, measured against a category rather than a channel.
 *
 * A category is not a place anybody can be, so this is not "what may they do
 * there" - it is "what would they be able to do in a channel that follows
 * this heading". Which is the question that has to be asked before letting
 * somebody write a rule on it: giving away at a category what you do not
 * have under it is the same escalation as giving it away in one channel.
 */
export function permissionsAt(
  userId: string,
  spaceId: string | null,
  scope: OverrideScope,
  targetId: string,
): Set<Permission> {
  const granted = permissionsFor(userId, spaceId)
  if (ownsSpace(userId, spaceId)) return granted

  const rules = overridesAt(scope, targetId)
  if (rules.length === 0) return granted

  const everyone = everyoneRoleId(spaceId)
  const held = new Set(rolesFor(userId, spaceId).map((r) => r.id))

  const apply = (subject: (o: Override) => boolean) => {
    const picked = rules.filter(subject)
    for (const o of picked) if (!o.allow) granted.delete(o.permission)
    for (const o of picked) if (o.allow) granted.add(o.permission)
  }

  if (everyone) apply((o) => o.kind === 'role' && o.subject_id === everyone)
  apply((o) => o.kind === 'role' && o.subject_id !== everyone && held.has(o.subject_id))
  apply((o) => o.kind === 'member' && o.subject_id === userId)

  return granted
}

/**
 * May this person do this, in this channel?
 *
 * The per-channel twin of can(). Every check that names a channel should ask
 * this one: asking can() instead reads the server-wide answer and silently
 * ignores every override the channel has.
 */
export function canIn(
  userId: string,
  permission: Permission,
  channelId: string,
): boolean {
  return permissionsIn(userId, channelId).has(permission)
}

/**
 * Replace what one role or person is given in one place.
 *
 * A whole subject at a time, because that is what the panel edits and it
 * makes clearing one straightforward: send nothing and the rows go, which
 * puts the subject back to inheriting rather than leaving a half-set of
 * stale rules behind.
 *
 * Neutral is stored as no row, so only what was actually decided is written.
 */
export function setOverride(
  scope: OverrideScope,
  targetId: string,
  kind: 'role' | 'member',
  subjectId: string,
  rules: Record<string, boolean | null>,
): void {
  db.prepare(
    'DELETE FROM permission_overrides WHERE scope = ? AND target_id = ? AND kind = ? AND subject_id = ?'
  ).run(scope, targetId, kind, subjectId)
  const put = db.prepare(
    `INSERT OR REPLACE INTO permission_overrides
       (scope, target_id, kind, subject_id, permission, allow)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const [permission, state] of Object.entries(rules)) {
    if (state === null || state === undefined) continue
    if (!(CHANNEL_PERMISSIONS as readonly string[]).includes(permission)) continue
    put.run(scope, targetId, kind, subjectId, permission, state ? 1 : 0)
  }
}

/**
 * Stop a channel following its category, keeping what it had.
 *
 * The category's rows are copied down first. Breaking a sync is asking to
 * change one thing about one channel, and starting from nothing would mean
 * rebuilding the other nine before getting to it - and, in the moment
 * between, a channel open to people it was closed to a second ago.
 */
export function unsyncChannel(channelId: string): void {
  const row = channelShape(channelId)
  if (!row) return
  if (row.perms_synced === 0 || !row.category_id) {
    db.prepare('UPDATE channels SET perms_synced = 0 WHERE id = ?').run(channelId)
    return
  }
  const put = db.prepare(
    `INSERT OR REPLACE INTO permission_overrides
       (scope, target_id, kind, subject_id, permission, allow)
     VALUES ('channel', ?, ?, ?, ?, ?)`
  )
  for (const o of overridesAt('category', row.category_id)) {
    put.run(channelId, o.kind, o.subject_id, o.permission, o.allow)
  }
  db.prepare('UPDATE channels SET perms_synced = 0 WHERE id = ?').run(channelId)
}

/**
 * Put a channel back under its category's rules.
 *
 * Its own rows go, rather than being kept somewhere to restore: they are no
 * longer what anybody is reading, and a hidden set that comes back the next
 * time somebody unsyncs is a surprise waiting years to happen.
 */
export function syncChannel(channelId: string): void {
  db.prepare("DELETE FROM permission_overrides WHERE scope = 'channel' AND target_id = ?")
    .run(channelId)
  db.prepare('UPDATE channels SET perms_synced = 1 WHERE id = ?').run(channelId)
}

/**
 * The position of a member's highest role. Owner sits above everything.
 *
 * Role editing is gated on this: without an ordering, anyone holding
 * manage_roles could simply grant themselves every other permission, which
 * made that one permission equivalent to owner.
 *
 * Roles only. A permission given to somebody personally does not move them up
 * the order, deliberately: rank is the answer to "who is above whom", and
 * that is a thing roles say. So kick_members and manage_roles handed out
 * directly still only reach people below the holder's highest role - which,
 * for somebody holding no roles at all, is nobody. The panel says so rather
 * than leaving it to be discovered.
 */
export function highestPosition(
  userId: string, spaceId?: string | null,
): number {
  // Whoever made a server outranks everybody in it, the same way they hold
  // every permission in it. Running the app is not a rank inside it: it says nothing
  // about a server somebody else made.
  if (ownsSpace(userId, spaceId ?? null)) return Number.MAX_SAFE_INTEGER
  const roles = rolesFor(userId, spaceId)
  return roles.length ? Math.max(...roles.map((r) => r.position)) : 0
}

/**
 * May one member moderate another?
 *
 * Having the permission is not enough: it says you may moderate, not that you
 * may moderate *anyone*. Rank decides that, the same way it decides which
 * roles you can hand out. The owner sits above everybody, so the owner can
 * never be muted, deafened or disconnected by staff - which the client
 * already assumed, but only the server can actually enforce.
 *
 * Strictly greater, so equal rank cannot moderate each other and nobody can
 * moderate themselves.
 */
export function outranks(
  actorId: string, targetId: string, spaceId?: string | null,
): boolean {
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(targetId) as
    unknown as { role: string } | undefined
  if (!target) return false
  // Both measured in the same server. A role held somewhere else is not
  // authority here, and being outranked there says nothing about here.
  return highestPosition(actorId, spaceId) > highestPosition(targetId, spaceId)
}

/** May this member act on that role at all? */
export function canEditRole(userId: string, roleId: string): boolean {
  const target = db.prepare('SELECT position, kind, space_id FROM roles WHERE id = ?').get(roleId) as
    unknown as { position: number; kind: string; space_id: string | null } | undefined
  if (!target) return false

  /*
   * The Owner role is the anchor of the whole position ordering, so nobody
   * moves it or rewrites what it allows - it allows everything by
   * definition. But its name and its colour are just how a server presents
   * itself, and refusing those left an owner unable to touch the one role
   * that is theirs by definition. The route decides which fields it will
   * take; this decides who may ask.
   */
  if (target.kind === 'owner') return ownsSpace(userId, target.space_id)

  // Strictly below, so peers cannot edit each other into an arms race - and
  // measured in the role's own server, so rank elsewhere buys nothing.
  return target.position < highestPosition(userId, target.space_id)
}

/**
 * Permissions this member is allowed to hand out.
 *
 * You can only grant what you already hold. This is the rule that actually
 * closes the escalation: even editing @everyone cannot mint a permission the
 * editor does not have themselves.
 */
export function filterGrantable(
  userId: string, wanted: string[], spaceId?: string | null,
): Permission[] {
  // What you hold in the server the role belongs to. Measured against the
  // original one, somebody editing a role in their own server could grant
  // nothing, and somebody with rights in the original could grant everything.
  const mine = permissionsFor(userId, spaceId)
  const allPowerful = ownsSpace(userId, spaceId ?? null)
  return wanted.filter((p): p is Permission => {
    if (!(PERMISSIONS as readonly string[]).includes(p)) return false
    /*
     * Administrator is the owner's to give, and only the owner's.
     *
     * It would otherwise pass the ordinary rule below - an administrator
     * holds it, so they could hand it on - and an administrator who can
     * make administrators is one step from being the owner: they cannot
     * take the server, but they can hand out the whole of it to anybody,
     * including back to themselves after being demoted, without the person
     * who made the server ever agreeing to it.
     *
     * The rank guard does not cover this. It stops somebody assigning a
     * role at or above their own, but says nothing about writing the
     * permission onto a role well below them and then holding that.
     */
    if (p === 'administrator') return allPowerful
    return allPowerful || mine.has(p as Permission)
  })
}

/**
 * Record what somebody did, in the server they did it in.
 *
 * The server is not optional in spirit, only in the type: a handful of
 * actions genuinely belong to an account rather than to any server - signing
 * up, changing a password - and those pass nothing, which stores null and
 * keeps them out of every server's log. Anything done inside a server must
 * name it, or it becomes invisible to the people entitled to read it.
 */
export function writeAudit(
  actorId: string | null,
  action: string,
  detail: string,
  spaceId?: string | null,
): void {
  db.prepare(
    'INSERT INTO audit (id, actor_id, action, detail, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), actorId, action, detail.slice(0, 500), spaceId ?? null, Date.now())
}
