/**
 * What has been changed in a server, and by whom.
 *
 * The server stores an action as a dotted name and a detail string, which is
 * the right thing for it to store and the wrong thing to put in front of
 * somebody: "channel.permissions.sync" is a note to whoever wrote it. This
 * turns each one into a sentence.
 */

export type AuditEntry = {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  detail: string
  created_at: number
}

/**
 * What each action says, in words.
 *
 * Anything unrecognised keeps its own name rather than being dropped or
 * called "something changed" — a log that hides what it does not recognise is
 * a log you cannot trust to be complete, and the name at least says where to
 * go looking.
 */
const SAID: Record<string, string> = {
  'account.password': 'changed their password',
  'category.create': 'made a category',
  'category.delete': 'deleted a category',
  'category.permissions': 'changed what a category allows',
  'category.reorder': 'reordered the categories',
  'category.update': 'renamed a category',
  'channel.access': 'changed who can see a channel',
  'channel.create': 'made a channel',
  'channel.delete': 'deleted a channel',
  'channel.permissions': 'changed what a channel allows',
  'channel.permissions.sync': 'set a channel to follow its category',
  'channel.reorder': 'reordered the channels',
  'channel.update': 'changed a channel',
  'invite.create': 'made an invite',
  'invite.revoke': 'revoked an invite',
  'invite.send': 'sent an invite',
  'member.ban': 'banned somebody',
  'member.remove': 'removed somebody',
  'member.unban': 'lifted a ban',
  'message.delete': 'deleted a message',
  'role.create': 'made a role',
  'role.delete': 'deleted a role',
  'role.move': 'moved a role',
  'role.reorder': 'reordered the roles',
  'role.update': 'changed a role',
  'space.create': 'made this server',
  'space.delete': 'deleted a server',
  'space.icon': 'changed the server icon',
  'space.icon.clear': 'cleared the server icon',
  'space.banner': 'changed the server banner',
  'space.banner.clear': 'cleared the server banner',
  'space.join': 'joined',
  'space.update': 'changed the server',
  'verify.grant': 'verified somebody',
  'verify.remove': 'took somebody’s verification away',
  'voice.disconnect': 'removed somebody from a call',
  'voice.move': 'moved somebody between calls',
}

export const saidOf = (action: string): string => SAID[action] ?? action

/** Every action this knows how to say, for a test that it still knows them. */
export const KNOWN_ACTIONS: readonly string[] = Object.keys(SAID)

/**
 * Who did it, when the account is gone.
 *
 * actor_id is set to null rather than deleted with the person, so the entry
 * survives them — which is the point of a log. Their name does not, so it
 * says so plainly instead of leaving a blank where a name should be.
 */
export const actorOf = (e: AuditEntry): string =>
  e.actor_name || (e.actor_id ? 'Somebody' : 'An account since removed')
