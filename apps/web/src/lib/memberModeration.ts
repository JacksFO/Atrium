import { mayActOn, rankOf } from './members'
import { rolesOf } from './roles'
import type { Id, Space } from './wire'
import type { World } from './world'

/**
 * What may be done to somebody in the server currently open.
 *
 * Removing and barring people already existed, in the members pane of a
 * server's settings - several clicks away from the person you are looking
 * at. Right-clicking them is where anybody actually reaches for it, and it
 * was the one thing that menu could not do.
 *
 * Worked out here rather than inside the menu that draws it, for the same
 * reason voiceModeration is: the conditions are the interesting part and a
 * menu builder is the one place they cannot be tested. Every one mirrors a
 * check the server makes, so an item that would be refused is absent instead
 * of being offered and then failing. The server checks all of them again -
 * this decides what to draw, not what is allowed.
 */
export type MemberModeration = {
  /** The server it would happen in, which is where the permission is held. */
  spaceId: Id
  /** kick_members: they can come back on the next invite. */
  mayKick: boolean
  /** ban_members: they cannot, until somebody lifts it. */
  mayBan: boolean
  /** moderate_members: stopped from talking, staying where they are. */
  mayTimeOut: boolean
}

/**
 * Null when there is nothing to offer, which is most of the time.
 *
 * Five ways to get nothing, and each is a rule the server enforces: there is
 * no server open; it is you; they are not in it; they own it; or you hold
 * neither permission there and do not outrank them.
 */
export function memberModerationFor(
  world: World, space: Space | null, targetId: Id,
): MemberModeration | null {
  if (!space) return null
  if (targetId === world.me.id) return null

  /*
   * Somebody who is actually in this server.
   *
   * The member list is drawn from this roster, so a name on screen is
   * normally in it - but the same menu opens from a message, and a message
   * can be from somebody who has since left. Removing somebody who is
   * already gone is refused by the server and should not be offered.
   */
  const here = world.membersBySpace.get(space.id)
  if (!here?.has(targetId)) return null

  /* Never the person whose server it is. The server refuses it outright. */
  if (space.owner_id === targetId) return null

  /* Rank, the same rule the server applies: strictly above, so equals cannot
     act on each other and two people with no roles are equals. */
  const rankIn = (who: Id) =>
    rankOf(who, space, world.roles,
      rolesOf(who, space, world.roles, world.assignments).map((r) => r.id))
  if (!mayActOn(rankIn(world.me.id), rankIn(targetId), false)) return null

  const held = world.held.in(space.id, null)
  const mayKick = held.includes('kick_members')
  const mayBan = held.includes('ban_members')
  const mayTimeOut = held.includes('moderate_members')
  if (!mayKick && !mayBan && !mayTimeOut) return null

  return { spaceId: space.id, mayKick, mayBan, mayTimeOut }
}
