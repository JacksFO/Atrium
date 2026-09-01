import type { Assignment, Id, Role, Space, User } from './wire'

/**
 * Roles: the order they come in, who holds them, and what colour they are.
 *
 * All three broke on the same day, in ways that looked like separate faults
 * and were not — they are one question asked three times, so they live in one
 * file and share one answer.
 */

/**
 * The order roles are shown in, everywhere.
 *
 * Highest first, which is the hierarchy — and then a tie-break, which is the
 * part that was missing. Two roles can share a position: a new one is given
 * the highest plus one, capped at the rank of whoever made it minus one, so
 * anybody who is not the owner runs out of room quickly and every role they
 * make after that lands on the same rung.
 *
 * Sorted on position alone those come out in whatever order the rows arrived
 * in, which does not have to be the same twice. That is not cosmetic: this
 * order decides which colour somebody wears, which role counts as their
 * highest, and where their group sits in the member list — so two of them
 * trading places between reloads looks like the app changing its mind about
 * who somebody is.
 *
 * Older first among equals, because that is the one people already think of
 * as the senior of the two, and by id after that so it is settled even for
 * two made in the same millisecond. The server orders by exactly this; the
 * two have to agree or the client re-sorts a list the server built carefully.
 */
export function byRank(a: Role, b: Role): number {
  return (
    b.position - a.position
    || (a.created_at || 0) - (b.created_at || 0)
    || a.id.localeCompare(b.id)
  )
}

/** The same order, as a list. Never sorts in place: the input is state. */
export const inRankOrder = (roles: readonly Role[]): Role[] => [...roles].sort(byRank)

/**
 * What colour a role is drawn in, or nothing for one nobody has coloured —
 * which takes the theme's accent rather than grey.
 *
 * The colour as it was chosen, in full. Keeping only its hue threw away how
 * light and how saturated it was, so a muted navy and a bright cyan came out
 * identical, and a grey role — having no hue at all — came out with no colour.
 */
export function roleColour(r: Pick<Role, 'colour'> | undefined): string | null {
  const c = r?.colour ?? ''
  return /^#[0-9a-f]{6}$/i.test(c) ? c : null
}

/**
 * The roles one person holds in one server, highest first.
 *
 * Only this server's. The ready frame carries the roles of every server the
 * account is in, and each of them has an Owner — grouping by all of them put
 * two "Owner" headings in one member list: this server's owner, and the owner
 * of somewhere else entirely, standing in a list they are not part of.
 */
export function rolesOf(
  userId: Id,
  space: Pick<Space, 'id' | 'owner_id'>,
  roles: readonly Role[],
  assignments: readonly Assignment[],
): Role[] {
  const here = roles.filter((r) => r.space_id === space.id)
  const mine = new Set(
    assignments.filter((a) => a.user_id === userId).map((a) => a.role_id),
  )
  return inRankOrder(
    here.filter((r) => {
      if (r.kind === 'everyone') return false
      /* The owner of *this* server, not somebody who owns one elsewhere. */
      if (r.kind === 'owner') return userId === space.owner_id
      return mine.has(r.id)
    }),
  )
}

/** The colour a name takes: the highest role that has been given one. */
export function nameColourFrom(roles: readonly Role[]): string | null {
  for (const r of roles) {
    const c = roleColour(r)
    if (c) return c
  }
  return null
}

export type MemberGroup = {
  role: Role | null
  label: string
  colour: string | null
  people: User[]
}

/**
 * The member list, grouped by the roles that ask for a heading.
 *
 * A role only gets one when it is hoisted; everybody else falls through to
 * Online, and each person appears once, under their highest hoisted role.
 *
 * The matching is by id on both sides. Comparing ids that had been through
 * the client's own hashing twice returned the same constant for every role,
 * so nothing ever matched, every member came out holding none, and a role set
 * to show its holders separately listed nobody at all.
 */
export function memberGroups(
  online: readonly User[],
  space: Pick<Space, 'id' | 'owner_id'>,
  roles: readonly Role[],
  assignments: readonly Assignment[],
): MemberGroup[] {
  const hoisted = inRankOrder(
    roles.filter((r) => r.hoist && r.kind !== 'everyone' && r.space_id === space.id),
  )
  const claimed = new Set<Id>()
  const groups: MemberGroup[] = []

  for (const role of hoisted) {
    const holders = new Set(
      assignments.filter((a) => a.role_id === role.id).map((a) => a.user_id),
    )
    const people = online.filter((m) => {
      if (claimed.has(m.id)) return false
      const has = role.kind === 'owner' ? m.id === space.owner_id : holders.has(m.id)
      if (has) claimed.add(m.id)
      return has
    })
    if (people.length) {
      groups.push({ role, label: role.name, colour: roleColour(role), people })
    }
  }

  groups.push({
    role: null,
    label: 'Online',
    colour: null,
    people: online.filter((m) => !claimed.has(m.id)),
  })
  return groups
}
