import { isConversationKind } from './kinds.js'
import { db, isSpaceMember, everyoneRoleId, ownsSpace } from './db.js'
import {
  overrideTarget, overridesAt, overridesForChannel, permissionsFor, permissionsIn,
  setOverride, unsyncChannel,
} from './permissions.js'

/**
 * Who may see a channel.
 *
 * Every channel is open to the whole space by default. Being able to see one
 * is a permission like any other - view_channels - so "private" is not a
 * separate system any more: it is that permission denied to @everyone in
 * this one channel, and allowed back to the roles and people named. Anyone
 * who could change that list sees it anyway, because locking an
 * administrator out of a channel they can edit the settings of is a puzzle
 * rather than a permission.
 *
 * It used to be an allow list of its own, on the grounds that a
 * per-permission matrix answers a question nobody asked. The question people
 * did ask, eventually, was "let this role read but not write in here" - and
 * with two stores for who can see a channel, two screens could disagree
 * about whether one was private. So the flag and the list became a view over
 * the overrides: the same two functions, the same shape on the wire, one
 * place where the answer is kept.
 *
 * This module exists so there is exactly one answer to that question. The
 * check has to happen in a dozen places - the channel list, history, posting,
 * reacting, editing, deleting, pins, search, voice tokens, joining voice -
 * and a private channel that leaks through any one of them is not private.
 */

export type ChannelAccess = {
  private: boolean
  roles: string[]
  members: string[]
}

type ChannelRow = {
  id: string
  kind: string
  is_private: number | null
  /** Null on a DM, and on anything made before spaces existed. */
  space_id: string | null
}

function channelRow(channelId: string): ChannelRow | undefined {
  return db
    .prepare('SELECT id, kind, is_private, space_id FROM channels WHERE id = ?')
    .get(channelId) as unknown as ChannelRow | undefined
}

/**
 * The old shape - private, plus who is named - read off the overrides.
 *
 * Only view_channels is looked at. Everything else a channel says about a
 * role is a different question, and folding it in here would have "who can
 * see this" answer yes for somebody allowed to pin and nothing else.
 */
export function accessFor(channelId: string): ChannelAccess {
  const row = channelRow(channelId)
  const at = overrideTarget(channelId)
  const rules = overridesAt(at.scope, at.id).filter((o) => o.permission === 'view_channels')
  const everyone = everyoneRoleId(row?.space_id ?? null)
  return {
    private: rules.some((o) => o.kind === 'role' && o.subject_id === everyone && !o.allow),
    roles: rules
      .filter((o) => o.kind === 'role' && o.allow === 1 && o.subject_id !== everyone)
      .map((o) => o.subject_id),
    members: rules.filter((o) => o.kind === 'member' && o.allow === 1).map((o) => o.subject_id),
  }
}

/**
 * Keep channels.is_private saying what the overrides say.
 *
 * Derived, and only ever written here. It exists because three list queries
 * want "the private channels in this server" as one indexed SQL question,
 * and working that out per channel in JavaScript to answer it would mean
 * resolving every override in the server to draw one settings pane.
 *
 * Anything that changes a view_channels rule has to call this, or those
 * lists quietly go stale - which is why the two routes that write overrides
 * both end here rather than each doing their own bookkeeping.
 */
export function refreshPrivacy(channelId: string): void {
  const now = accessFor(channelId).private ? 1 : 0
  db.prepare('UPDATE channels SET is_private = ? WHERE id = ?').run(now, channelId)
}

/** The same, for every channel currently reading from one category. */
export function refreshPrivacyUnder(categoryId: string): void {
  const rows = db.prepare(
    "SELECT id FROM channels WHERE category_id = ? AND kind IN ('text', 'voice')"
  ).all(categoryId) as unknown as Array<{ id: string }>
  for (const r of rows) refreshPrivacy(r.id)
}

/**
 * May this person see and use this channel?
 *
 * Answers only the channel-level question. What they may *do* once inside is
 * still governed by their permissions - this does not grant send_messages to
 * somebody who does not have it.
 */
export function canAccessChannel(userId: string, channelId: string): boolean {
  const row = channelRow(channelId)
  // A channel that does not exist is not accessible, and neither is a DM -
  // those are governed by membership, in dmMembers().
  if (!row || isConversationKind(row.kind)) return false

  /*
   * In the space at all, before anything about the channel matters.
   *
   * This is the check that lets an account stop being worth something. While
   * there was one space and every account was in it, "is this person a
   * member" had no way to be false and signing up was the same act as being
   * let in - which is why registration needs an invite code today. With
   * membership as its own fact, a stranger with an account sees nothing, and
   * the invite gate can come off the front door instead of guarding the whole
   * server.
   *
   * Today every account is a member, so nothing here changes what anybody
   * sees. That is the point of landing it first.
   */
  if (!isSpaceMember(userId, row.space_id ?? null)) return false

  // Whoever made this server is never locked out of it. Running the app
  // is not the same thing: a private channel in somebody else's server does
  // not stop being private because you own the disk it sits on.
  if (ownsSpace(userId, row.space_id ?? null)) return true

  /*
   * What they may do here, which is where every override is resolved -
   * @everyone's, then their roles', then anything said about them by name.
   *
   * Scoped to the channel's own server by permissionsIn, which reads the
   * space off the channel: holding view_channels in your own space must not
   * unlock a private channel in somebody else's, and a role held elsewhere
   * must not match an override written here.
   */
  const mine = permissionsIn(userId, channelId)

  /*
   * Whoever can manage the channel can see it. Otherwise an administrator
   * can make a channel and then be unable to find it.
   *
   * Measured in the channel rather than in the server, so it can be taken
   * away deliberately: a channel that denies manage_channels to a role
   * closes this door to it too. Left server-wide, there would be no way to
   * hide a room from a moderator, and that is a thing people ask for.
   */
  if (mine.has('manage_channels')) return true

  return mine.has('view_channels')
}

/**
 * Somebody a moderator has put in a voice channel.
 *
 * Moving a person into a channel they cannot otherwise see used to be
 * refused, on the grounds that it would strand them somewhere they could not
 * rejoin - which was true and is the thing to fix rather than the reason not
 * to. Asked for as: if somebody in a channel can move members, they should be
 * able to move in somebody who does not have access to it.
 *
 * So being placed there is itself the permission, and it lasts exactly as
 * long as they are there. Nothing is written down and nothing is granted: the
 * moment they leave, the channel is closed to them again.
 *
 * Deliberately NOT part of canAccessChannel. That answers "may they see this
 * channel", which also governs reading what has been said in it - and being
 * carried into a room is not consent to its history. This answers only "may
 * they be in this call", which is the question the two voice gates ask.
 *
 * Set by the gateway, which is the only thing that knows who is in a call:
 * that state lives in memory there and nowhere else. A hook rather than an
 * import because access.ts must not depend on the gateway - the gateway
 * already depends on it.
 */
let placed: (userId: string, channelId: string) => boolean = () => false

export function setVoicePlacement(fn: (userId: string, channelId: string) => boolean): void {
  placed = fn
}

/**
 * May this person be in this voice channel?
 *
 * Everything canAccessChannel allows, plus having been put there by somebody
 * entitled to move people. Used by the two gates a moved person meets next -
 * the token they are minted and the join they announce - because without both
 * the move would succeed and then fail a moment later, which is exactly the
 * stranding the old refusal was avoiding.
 */
export function canBeInVoice(userId: string, channelId: string): boolean {
  return canAccessChannel(userId, channelId) || placed(userId, channelId)
}

/**
 * Where this person's permissions differ from the server-wide answer.
 *
 * The client gates buttons on what it was told it may do, and until now that
 * was one list per server - so a channel that takes away sending showed a
 * message box that worked right up until the server refused the message.
 *
 * Only the channels that actually differ. Almost none do: a server with
 * twenty channels and two of them locked down sends two entries, not twenty,
 * and a server nobody has overridden anything in sends none at all. That
 * keeps this the size of the exceptions rather than the size of the server,
 * which is the difference between a few hundred bytes and a few tens of
 * kilobytes every time somebody connects.
 *
 * Channels they cannot see are left out. The whole point of denying
 * view_channels is that the channel is not theirs to know about, and an
 * entry here would name it.
 */
export function channelPermissionsFor(
  userId: string,
  spaceId: string | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!spaceId) return out
  const base = [...permissionsFor(userId, spaceId)].sort().join(' ')
  const rows = db.prepare(
    `SELECT id FROM channels
      WHERE kind IN ('text', 'voice') AND space_id = ?`
  ).all(spaceId) as unknown as Array<{ id: string }>

  for (const r of rows) {
    /*
     * A channel with no rules at all cannot differ from the server's answer,
     * so it is skipped before anything expensive happens to it.
     *
     * This is what keeps the cost of the whole thing proportional to the
     * number of exceptions rather than to the size of the server. Resolving
     * every channel means re-reading somebody's roles and grants once per
     * channel, and this runs per member every time a role changes: ten
     * people and twenty channels is two hundred resolutions to send, almost
     * always, nothing at all. One indexed lookup answers it instead.
     */
    if (overridesForChannel(r.id).length === 0) continue
    if (!canAccessChannel(userId, r.id)) continue
    const here = [...permissionsIn(userId, r.id)].sort()
    if (here.join(' ') === base) continue
    out[r.id] = here
  }
  return out
}

/**
 * The channels in a server whose visibility is not simply "everybody".
 *
 * Wider than channels.is_private, and it has to be. That flag means "@everyone
 * is denied view here", which is what makes a channel private - but a channel
 * can also say "everybody except this one role", and such a channel is public
 * by that flag while being closed to somebody.
 *
 * The three places that ask "which channels here need their audience worked
 * out" were reading the flag, so a role that denied view to one role moved
 * nobody's sidebar when it was handed out or taken away: the server refused
 * them correctly and their app went on showing the channel until a reload.
 *
 * Answered in SQL rather than by resolving every channel, because it is asked
 * before and after every role change in the server.
 */
export function channelsWithViewRules(spaceId: string | null): string[] {
  if (!spaceId) return []
  const rows = db.prepare(
    `SELECT c.id FROM channels c
      WHERE c.kind IN ('text', 'voice')
        AND c.space_id = ?
        AND EXISTS (
          SELECT 1 FROM permission_overrides o
           WHERE o.permission = 'view_channels'
             AND (
               (o.scope = 'channel' AND o.target_id = c.id
                 AND (c.category_id IS NULL OR c.perms_synced = 0))
               OR (o.scope = 'category' AND o.target_id = c.category_id
                 AND c.category_id IS NOT NULL AND c.perms_synced = 1)
             )
        )`
  ).all(spaceId) as unknown as Array<{ id: string }>
  return rows.map((r) => r.id)
}

/** The channels this person may see, as a set, for filtering lists cheaply. */
export function accessibleChannelIds(userId: string): Set<string> {
  const rows = db
    .prepare("SELECT id FROM channels WHERE kind IN ('text', 'voice')")
    .all() as unknown as Array<{ id: string }>
  const out = new Set<string>()
  for (const r of rows) {
    if (canAccessChannel(userId, r.id)) out.add(r.id)
  }
  return out
}

/**
 * Replace the whole access list for a channel.
 *
 * Written as view_channels rules and nothing else: whatever a subject was
 * allowed or denied on any other permission is left exactly as it was, so
 * making a channel private does not quietly undo somebody's right to pin in
 * it. That is why each subject is edited through a read-modify-write rather
 * than by clearing the channel's rows.
 *
 * Deciding who can see a channel is a decision about that channel, so a
 * synced one stops being synced first. Writing it to the category instead
 * would make one channel private by making ten of them private.
 */
export function setAccess(
  channelId: string,
  isPrivate: boolean,
  roles: string[],
  members: string[],
): void {
  const row = channelRow(channelId)
  const everyone = everyoneRoleId(row?.space_id ?? null)

  const wanted = new Map<string, 'role' | 'member'>()
  for (const id of roles) if (id !== everyone) wanted.set(id, 'role')
  for (const id of members) wanted.set(id, 'member')

  // What the channel says today, so subjects that are losing their allowance
  // can be found and cleared rather than left behind saying yes.
  const held = overridesAt('channel', channelId)
  if (everyone) setViewOverride(channelId, 'role', everyone, isPrivate ? false : null)
  for (const [id, kind] of wanted) setViewOverride(channelId, kind, id, true)
  for (const o of held) {
    if (o.permission !== 'view_channels' || o.allow !== 1) continue
    if (o.subject_id === everyone || wanted.has(o.subject_id)) continue
    setViewOverride(channelId, o.kind, o.subject_id, null)
  }
}

/**
 * Let one role or one person see a channel, or stop them - and touch nothing
 * else about what they may do in it.
 *
 * The read-modify-write is the point. setOverride replaces everything one
 * subject is given, because that is the unit the permissions panel edits; a
 * caller that only wants to change who can see the channel has to hand back
 * the rest of what that subject already had, or letting somebody in would
 * quietly take away their right to pin in it.
 *
 * Deciding who can see a channel is a decision about that channel, so a
 * synced one stops following its category first. Writing it upwards instead
 * would make one channel private by making every channel under that heading
 * private.
 */
export function setViewOverride(
  channelId: string,
  kind: 'role' | 'member',
  subjectId: string,
  state: boolean | null,
): void {
  unsyncChannel(channelId)
  const rules: Record<string, boolean | null> = { view_channels: state }
  for (const o of overridesAt('channel', channelId)) {
    if (o.kind !== kind || o.subject_id !== subjectId) continue
    if (o.permission !== 'view_channels') rules[o.permission] = o.allow === 1
  }
  setOverride('channel', channelId, kind, subjectId, rules)
  refreshPrivacy(channelId)
}
