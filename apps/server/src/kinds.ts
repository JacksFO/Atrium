/**
 * What kind of thing a channel is, asked once rather than spelled out.
 *
 * A channel row is one of four things: a room in a server, a voice room in a
 * server, a one-to-one conversation, or a group. The first two belong to a
 * server and are governed by roles and permissions; the last two belong to
 * their members and are governed by being in them. Almost every question the
 * code asks about a channel is really "which of those two families is this",
 * and it was written out as `kind === 'dm'` in eight places.
 *
 * That is correct today for an unhappy reason: a group is stored with kind
 * 'dm' as well, so "is it a dm" happens to answer "is it a conversation". The
 * moment a group is stored as a group, those eight lines each become a
 * different bug - a group missing from the sidebar, a group with no member
 * list, a call refused in a group, a poll in a group asking a server's roles
 * for permission. None of them would announce itself.
 *
 * So the question gets a name. Then the storage can change and the meaning
 * cannot drift, and the one place that really does mean "a pair, not a group"
 * is visible by being the only one that still says 'dm'.
 */

/** The kinds a channel row can have. */
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group'

/**
 * A conversation: belongs to its members, has no server and no roles.
 *
 * Being in it is the whole of the permission. That is the rule for a pair and
 * for a group alike, which is why they answer the same question here.
 */
export function isConversationKind(kind: string | null | undefined): boolean {
  return kind === 'dm' || kind === 'group'
}

/** A room in a server: governed by roles, overrides and membership of it. */
export function isRoomKind(kind: string | null | undefined): boolean {
  return kind === 'text' || kind === 'voice'
}

/*
 * There was a CONVERSATION_KINDS_SQL here, written out once "so a query and
 * the code around it cannot come to disagree about what a conversation is".
 * It never got used: ten queries spell the list out by hand instead, in two
 * spellings, so the drift it existed to prevent was already happening while
 * the constant sat here claiming otherwise. Removed rather than left as a
 * promise nothing keeps. If it comes back, it has to come back with the ten
 * call sites.
 */
