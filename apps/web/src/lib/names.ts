import type { Id, User } from './wire'
import type { World } from './world'

/**
 * What somebody is called, where they are being called it.
 *
 * There is one of these because there used to be six, each written out as
 * `u.nickname || u.display_name || u.username` at the place it was needed -
 * which was fine while a nickname was one name for the whole account, and is
 * exactly what stopped being true. A nickname is what one server calls
 * somebody. Asking for a name without saying where is now a question with no
 * answer, so the where is a parameter and not something each caller
 * remembers to think about.
 *
 * Null for a conversation, which is nobody's server: a DM between two people
 * shows them the names they chose for themselves, whatever a server they
 * both happen to be in decided to call one of them.
 */
/* Only the three fields a name is made of, rather than a whole User: the
   voice views build stand-in people for somebody in a call the app has not
   heard of, and those are not User records. Asking for less is also the
   honest signature - nothing else here is read. */
export type Named = Pick<User, 'id' | 'display_name' | 'username'>

export function nameIn(world: World, spaceId: Id | null, u: Named): string {
  return (spaceId ? world.nicknames.get(spaceId)?.get(u.id) : '')
    || u.display_name
    || u.username
}

/**
 * The same, for somebody the app may not have heard of.
 *
 * Which is not an error - a message from somebody whose record has not
 * arrived yet is the ordinary case for the moment before a server's members
 * land. The id is a poor name and a correct one, and it resolves by itself.
 */
export function nameOfId(world: World, spaceId: Id | null, id: Id): string {
  const u = world.people.get(id)
  return u ? nameIn(world, spaceId, u) : 'Someone'
}

/** Just the override, for a control that has to show what is set rather than
 *  what is shown - the box that edits it starts empty when there is none. */
export function nicknameIn(world: World, spaceId: Id | null, id: Id): string {
  return (spaceId ? world.nicknames.get(spaceId)?.get(id) : '') || ''
}

/**
 * The server a call is in, or null for a conversation.
 *
 * Voice views are handed a Call rather than a Space, and a call knows its
 * channel - so the server is one lookup away and does not need threading
 * through as another prop. Null for a DM's call, which is nobody's server
 * and where a nickname must not apply.
 */
export function spaceOfChannel(world: World, channelId: Id | null): Id | null {
  if (!channelId) return null
  return world.channels.find((c) => c.id === channelId)?.space_id ?? null
}
