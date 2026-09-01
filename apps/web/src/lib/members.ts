import { outranks, type Rank } from './permissions'
import { byRank } from './roles'
import type { Id, Role, Space, User } from './wire'

/**
 * Who is in a server, and what may be done to them.
 *
 * Rank is the whole of it. The server refuses anything aimed at somebody at
 * or above you and refuses to hand out a role at or above your own, so what
 * is worked out here decides only what to *offer* — but offering a control
 * that will be refused is how a panel teaches people it is broken.
 */

export type Member = User & {
  /** The ids of the roles they hold in this server. */
  roles: Id[]
  /** Permissions given to them personally rather than through a role. */
  extras: string[]
}

/**
 * Where somebody sits: the top position of the roles they hold here.
 *
 * The owner is above everything, and that is the server's rule rather than a
 * position — a server's owner outranks a role placed above theirs, because
 * they are the reason the server exists.
 */
export function rankOf(
  userId: Id,
  space: Pick<Space, 'id' | 'owner_id'>,
  roles: readonly Role[],
  held: readonly Id[],
): Rank {
  if (userId === space.owner_id) return 'owner'
  const mine = roles.filter((r) => r.space_id === space.id && held.includes(r.id))
  if (mine.some((r) => r.kind === 'owner')) return 'owner'
  /* Nothing held is below every role there is, which is what -1 means to
     rankValue — and is different from holding a role placed at zero. */
  if (mine.length === 0) return -1
  return Math.max(...mine.map((r) => r.position))
}

/**
 * Whether one person may act on another at all.
 *
 * Never on yourself: the server refuses it, and a Remove button on your own
 * row is a way to lock yourself out of your own server by misreading a list.
 */
export function mayActOn(
  actor: Rank,
  target: Rank,
  sameperson: boolean,
): boolean {
  if (sameperson) return false
  return outranks(actor, target)
}

/**
 * The roles somebody may hand out.
 *
 * Not their own and not above it — the server calls this canEditRole and
 * refuses the rest. @everyone is not in the list either: everybody holds it
 * by being here, so there is nothing to give or take.
 */
export function grantableRoles(
  roles: readonly Role[],
  space: Pick<Space, 'id'>,
  actor: Rank,
): Role[] {
  return roles
    .filter((r) => r.space_id === space.id)
    .filter((r) => r.kind !== 'everyone' && r.kind !== 'owner')
    .filter((r) => outranks(actor, r.position))
    .sort(byRank)
}
