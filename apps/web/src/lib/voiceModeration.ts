import { mayActOn, rankOf } from './members'
import { rolesOf } from './roles'
import type { Id } from './wire'
import type { World } from './world'

/**
 * What may be done to somebody sitting in a voice room.
 *
 * The server has been able to silence, deafen and remove people from a call
 * since voice was written - held per server and per person, written to the
 * audit log, and put into the LiveKit token so a mute holds against a patched
 * client. Nothing in the app ever sent the frame, so from the inside it read
 * as three features nobody had built.
 *
 * Worked out here rather than inside the menu that draws it, because the
 * conditions are the interesting part and a menu builder is the one place
 * they cannot be tested. Every one of them mirrors a check the server makes,
 * so an item that would be refused is absent instead of being offered and
 * then failing. The server checks all of them again: this decides what to
 * draw, not what is allowed.
 */
export type VoiceModeration = {
  /** The room they are in, which is the one being moderated. */
  channelId: Id
  /** And the server it belongs to, which is where the permission is held. */
  spaceId: Id
  /** Which way each is currently set, so a control can say the opposite. */
  serverMuted: boolean
  serverDeafened: boolean
  /** mute_members: silencing and deafening. */
  maySilence: boolean
  /** move_members: taking them out of the call. */
  mayRemove: boolean
}

/**
 * Null when there is nothing to offer, which is most of the time.
 *
 * Five ways to get nothing, and each is a rule the server enforces:
 * they are not in a call; the call is a conversation between two people
 * rather than a server's room; it is you; you hold neither permission there;
 * or you do not outrank them.
 */
export function voiceModerationFor(world: World, targetId: Id): VoiceModeration | null {
  if (targetId === world.me.id) return null

  const where = world.voice.get(targetId)
  if (!where) return null

  /*
   * A server's voice channel, and not somebody's private call.
   *
   * Reaching into a conversation between two people to silence one of them
   * is not something a server's moderator is for, and the server refuses it -
   * so the app must not offer it. A room this client has no record of is
   * treated the same way: unknown is not a room to act on.
   */
  const room = world.channels.find((c) => c.id === where.channelId)
  if (!room || room.kind !== 'voice' || !room.space_id) return null

  const space = world.spaces.find((s) => s.id === room.space_id)
  if (!space) return null

  /* Rank, the same rule the server applies: strictly above, so equals cannot
     moderate each other and nobody can moderate the owner. */
  const rankIn = (who: Id) =>
    rankOf(who, space, world.roles,
      rolesOf(who, space, world.roles, world.assignments).map((r) => r.id))
  if (!mayActOn(rankIn(world.me.id), rankIn(targetId), false)) return null

  const held = world.held.in(space.id, null)
  const maySilence = held.includes('mute_members')
  const mayRemove = held.includes('move_members')
  if (!maySilence && !mayRemove) return null

  return {
    channelId: where.channelId,
    spaceId: space.id,
    serverMuted: where.serverMuted,
    serverDeafened: where.serverDeafened,
    maySilence,
    mayRemove,
  }
}
