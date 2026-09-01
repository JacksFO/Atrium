/**
 * What somebody may do, and how it is said on screen.
 *
 * This list is the server's, written out. Four permissions the server has
 * always had were missing from it — mentioning everyone, managing nicknames,
 * moving people between voice rooms, and reading the audit log — so the roles
 * panel could neither show nor grant any of them, and each would have been
 * reported as something nobody had built. A fifth, create_polls, was here and
 * *not* on the server: a switch that turned on nothing, because the server
 * drops a permission name it does not know.
 *
 * Kept as a union rather than fetched so that a name that does not exist is a
 * compile error rather than a switch that quietly does nothing — and kept in
 * step by a test that reads the server's own list, because being written out
 * by hand is precisely how it drifted.
 *
 * The client never decides any of this — the server does, and sends the list
 * it decided. What is here is the vocabulary: which permissions exist, what
 * each one means in words a person can act on, and which of them a single
 * channel can have an opinion about.
 *
 * That last distinction matters more than it looks. A gated feature is
 * *absent* rather than disabled, so a permission bug reads as a feature that
 * was never built — which is how the same thing got reported twice as
 * missing. Naming them all in one place is what makes an audit possible.
 */

export type PermissionId =
  | 'administrator'
  | 'view_channels'
  | 'read_history'
  | 'send_messages'
  | 'attach_files'
  | 'add_reactions'
  | 'mention_everyone'
  | 'create_polls'
  | 'manage_messages'
  | 'manage_pins'
  | 'manage_channels'
  | 'manage_roles'
  | 'manage_space'
  | 'manage_nicknames'
  | 'create_invite'
  | 'kick_members'
  | 'ban_members'
  | 'move_members'
  | 'mute_members'
  | 'view_audit_log'

export type PermissionMeta = {
  id: PermissionId
  label: string
  detail: string
}

export const PERMISSIONS: readonly PermissionMeta[] = [
  {
    id: 'administrator',
    label: 'Administrator',
    detail: 'Everything below, and anything added later — but not deleting the server or touching the Owner role',
  },
  { id: 'view_channels', label: 'View channels', detail: 'See that a channel exists at all' },
  { id: 'read_history', label: 'Read history', detail: 'Read what was said before they arrived' },
  { id: 'send_messages', label: 'Send messages', detail: 'Write in a channel' },
  { id: 'attach_files', label: 'Attach files', detail: 'Send images and GIFs' },
  { id: 'add_reactions', label: 'Add reactions', detail: 'React to a message' },
  { id: 'mention_everyone', label: 'Mention everyone', detail: 'Get a whole channel’s attention at once' },
  { id: 'create_polls', label: 'Create polls', detail: 'Ask a question with answers to pick from' },
  { id: 'manage_messages', label: 'Manage messages', detail: "Delete anybody's message" },
  { id: 'manage_pins', label: 'Manage pins', detail: 'Pin and unpin, without being able to delete' },
  { id: 'manage_channels', label: 'Manage channels', detail: 'Make, rename, reorder and delete channels' },
  { id: 'manage_roles', label: 'Manage roles', detail: 'Make roles and decide who holds them' },
  { id: 'manage_space', label: 'Manage server', detail: 'Rename it and change its description' },
  { id: 'manage_nicknames', label: 'Manage nicknames', detail: 'Change what somebody is called here' },
  { id: 'create_invite', label: 'Create invites', detail: 'Make a code that lets somebody in' },
  { id: 'kick_members', label: 'Remove members', detail: 'Show somebody the door' },
  { id: 'ban_members', label: 'Ban members',
    detail: 'Bar somebody from coming back. Removing them alone does not' },
  { id: 'move_members', label: 'Move people in voice', detail: 'Carry somebody into another room, or out' },
  { id: 'mute_members', label: 'Silence people in voice',
    detail: 'Mute or deafen somebody in a call. Separate from tidying a channel' },
  { id: 'view_audit_log', label: 'View the audit log', detail: 'See what has been changed, and by whom' },
]

/** Grouped the way somebody thinks about a server, not the way it is stored. */
export const PERMISSION_GROUPS: ReadonlyArray<readonly [string, readonly PermissionId[]]> = [
  ['The room', ['view_channels', 'read_history', 'manage_channels']],
  ['What is said', ['send_messages', 'attach_files', 'add_reactions', 'mention_everyone',
    'create_polls', 'manage_messages', 'manage_pins']],
  ['Who is here', ['create_invite', 'kick_members', 'ban_members', 'manage_nicknames', 'move_members',
    'mute_members', 'manage_roles', 'manage_space', 'view_audit_log']],
  /*
   * On its own, because it is not one of a set - it is the set.
   *
   * Grouped with the others it read as one more switch among seventeen,
   * which is exactly the misreading that matters here: it is the only one
   * that keeps granting things after you have stopped looking at it.
   */
  ['Everything', ['administrator']],
]

/**
 * The ones a single channel can have an opinion about.
 *
 * Renaming the server or removing somebody happens *to* a server, not *in* a
 * room, so offering a row for them per channel would be offering a switch
 * that does nothing.
 */
export const CHANNEL_PERMISSIONS: readonly PermissionId[] = [
  'view_channels', 'read_history', 'send_messages', 'attach_files',
  'add_reactions', 'mention_everyone', 'create_polls', 'manage_messages',
  'manage_pins', 'manage_channels', 'manage_roles', 'move_members',
]

/**
 * Fewer again in a voice room, where most of them have nothing to describe.
 *
 * send_messages is here because in a voice room it is the one that decides
 * who may talk: the voice token's canPublish is set from this permission read
 * in this channel. The server has always worked that way and this list did
 * not offer it, so a room could be made listen-only by the server and by
 * nobody using the app. It is labelled "Speak" against a voice channel - see
 * VOICE_LABELS - because "Send messages" in a room with no messages in it
 * describes nothing somebody would recognise.
 */
export const VOICE_PERMISSIONS: readonly PermissionId[] = [
  'view_channels', 'send_messages', 'manage_channels', 'manage_roles', 'move_members',
]

/**
 * What a permission is called when the channel is a voice one.
 *
 * Only where the name would otherwise be wrong. A permission means the same
 * thing in both kinds of room; what changes is the word people use for it.
 */
export const VOICE_LABELS: Partial<Record<PermissionId, { label: string; detail: string }>> = {
  send_messages: {
    label: 'Speak',
    detail: 'Talk in this channel. Denied, they can listen and nothing else.',
  },
}

const BY_ID = new Map(PERMISSIONS.map((p) => [p.id, p]))

/** What a permission is called, falling back to its own name rather than to
 *  nothing — an unknown one on screen should say which it is. */
export const permissionMeta = (id: string): PermissionMeta =>
  BY_ID.get(id as PermissionId) ?? { id: id as PermissionId, label: id, detail: '' }

/**
 * What being in a conversation lets you do.
 *
 * A conversation has no server and so no roles, and the server does not send
 * a list for one: being in it is the whole of the permission, and the set is
 * the same for both people. Written out here because the alternative is the
 * client having no answer at all for a conversation — which reads on screen
 * as every one of these being missing.
 *
 * Kept deliberately in step with the server's own list. manage_messages is
 * not in it: you may delete what you sent, which is checked against who wrote
 * it rather than against a permission, and nobody may delete what you sent.
 */
export const CONVERSATION_PERMISSIONS: readonly PermissionId[] = [
  'view_channels', 'send_messages', 'attach_files',
  'add_reactions', 'create_polls', 'read_history', 'manage_pins',
]

/**
 * Where somebody sits.
 *
 * The owner outranks everything; a number is the top position of the roles
 * they hold, and holding none is below every role there is. Kept as a
 * comparison rather than a number so that "outranks" reads as what it means.
 */
export type Rank = number | 'owner'

export const rankValue = (r: Rank | undefined): number =>
  r === 'owner' ? Number.POSITIVE_INFINITY : r ?? -1

export const outranks = (a: Rank | undefined, b: Rank | undefined): boolean =>
  rankValue(a) > rankValue(b)

/**
 * May they, here?
 *
 * `held` is the list the server sent for this server, and it is the whole
 * answer — the client does not work it out from roles, because two things
 * deciding the same question is how they end up disagreeing.
 */
export const may = (held: readonly string[] | undefined, perm: PermissionId): boolean =>
  !!held?.includes(perm)
