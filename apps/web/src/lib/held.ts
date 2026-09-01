import { CONVERSATION_PERMISSIONS } from './permissions'
import type { Id } from './wire'

/**
 * What you may do, and where.
 *
 * The server works this out and says so — once for every server you are in
 * when you connect, and again for one server whenever something changes what
 * you may do in it. The client never derives any of it from roles: two things
 * answering the same question is how they come to disagree, and the one the
 * screen believes would be the one that is wrong.
 *
 * A channel can take some of it away, so the answer is per channel as well as
 * per server. Only the channels that *differ* are sent, which in a server
 * nobody has overridden anything in is none of them — so the absence of a
 * channel here means "the same as the server", not "nothing".
 *
 * Kept per server rather than as one flat map of channels, because replacing
 * one server's answer has to clear that server's old exceptions with it. Flat,
 * a rule you had just deleted would stay in the map for ever: the replacement
 * carries only the channels that still differ, and this one no longer does, so
 * there would be nothing to overwrite it with. The channel would keep the
 * restriction, in a client that had been told it was gone.
 */
export class Held {
  private space = new Map<Id, readonly string[]>()
  private channel = new Map<Id, Map<Id, readonly string[]>>()

  /** Everything, as the opening frame says it is. */
  replace(
    bySpace: Record<Id, string[]> | undefined,
    byChannel: Record<Id, Record<Id, string[]>> | undefined,
  ): void {
    this.space = new Map(Object.entries(bySpace ?? {}))
    this.channel = new Map(
      Object.entries(byChannel ?? {}).map(([s, chans]) => [s, new Map(Object.entries(chans))]),
    )
  }

  /** One server's answer, replacing that server's part and nothing else. */
  setSpace(
    spaceId: Id,
    permissions: readonly string[],
    channels: Record<Id, string[]> | undefined,
  ): void {
    this.space.set(spaceId, permissions)
    this.channel.set(spaceId, new Map(Object.entries(channels ?? {})))
  }

  /**
   * What you may do in one place.
   *
   * A conversation has no server and so no roles, and the server sends no
   * list for one — so the fixed set a conversation grants is the answer. With
   * nothing in its place, reacting, attaching and pinning were all absent in
   * every conversation, which is what a permission bug always looks like.
   */
  in(spaceId: Id | null, channelId: Id | null): readonly string[] {
    if (!spaceId) return CONVERSATION_PERMISSIONS
    const exceptions = channelId ? this.channel.get(spaceId)?.get(channelId) : undefined
    return exceptions ?? this.space.get(spaceId) ?? []
  }
}
