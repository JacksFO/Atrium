import { describe, expect, it } from 'vitest'
import type { Assignment, Role, User } from './wire'
import {
  byRank, inRankOrder, memberGroups, nameColourFrom, roleColour, rolesOf,
} from './roles'

const role = (over: Partial<Role> & { id: string }): Role => ({
  space_id: 'sp', name: over.id, colour: '', position: 0, permissions: '[]',
  kind: 'custom', hoist: 0, created_at: 0, ...over,
})
const user = (id: string): User => ({
  id, username: id, discriminator: '0001', verified: 0, display_name: id,
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
})
const space = { id: 'sp', owner_id: 'owner' }

describe('the order roles come in', () => {
  it('puts the higher one first', () => {
    const out = inRankOrder([role({ id: 'low', position: 1 }), role({ id: 'high', position: 9 })])
    expect(out.map((r) => r.id)).toEqual(['high', 'low'])
  })

  /* Two roles can share a rung, and which of them wins decides the colour
     somebody wears. Sorted on position alone they come out in row order,
     which is not the same twice. */
  it('settles a tie by which is older', () => {
    const tied = [
      role({ id: 'newer', position: 5, created_at: 200 }),
      role({ id: 'older', position: 5, created_at: 100 }),
    ]
    expect(inRankOrder(tied).map((r) => r.id)).toEqual(['older', 'newer'])
    expect(inRankOrder([...tied].reverse()).map((r) => r.id)).toEqual(['older', 'newer'])
  })

  it('and two made in the same millisecond are still settled', () => {
    const same = [
      role({ id: 'b', position: 5, created_at: 100 }),
      role({ id: 'a', position: 5, created_at: 100 }),
    ]
    expect(inRankOrder(same).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('never sorts the list it was given', () => {
    const given = [role({ id: 'low', position: 1 }), role({ id: 'high', position: 9 })]
    inRankOrder(given)
    expect(given[0]?.id).toBe('low')
  })

  it('is the same comparison whichever way it is used', () => {
    expect(byRank(role({ id: 'a', position: 9 }), role({ id: 'b', position: 1 }))).toBeLessThan(0)
  })
})

describe('what colour a role is', () => {
  /* Keeping only the hue threw away how light and how saturated it was: two
     different blues came out identical, and a grey had no hue to keep. */
  it('is the colour as it was chosen, in full', () => {
    expect(roleColour(role({ id: 'r', colour: '#2b6cb0' }))).toBe('#2b6cb0')
    expect(roleColour(role({ id: 'r', colour: '#00aaff' }))).toBe('#00aaff')
  })

  it('including a grey, which has no hue at all', () => {
    expect(roleColour(role({ id: 'r', colour: '#808080' }))).toBe('#808080')
  })

  it('and nothing for a role nobody coloured', () => {
    expect(roleColour(role({ id: 'r' }))).toBeNull()
    expect(roleColour(role({ id: 'r', colour: 'blue' }))).toBeNull()
  })

  it('a name takes the highest role that has one, not the highest role', () => {
    const held = [role({ id: 'top', position: 9 }), role({ id: 'mid', position: 5, colour: '#5BD98A' })]
    expect(nameColourFrom(held)).toBe('#5BD98A')
  })
})

describe('who holds what', () => {
  const roles = [
    role({ id: 'owner', kind: 'owner', position: 99 }),
    role({ id: 'squadron', position: 5, hoist: 1 }),
    role({ id: 'everyone', kind: 'everyone', position: 0 }),
    role({ id: 'elsewhere', space_id: 'other', kind: 'owner', position: 99 }),
  ]
  const assignments: Assignment[] = [{ user_id: 'pat', role_id: 'squadron' }]

  /* Comparing ids that had been through the client's own hashing twice
     returned the same constant for every role, so nothing matched and every
     member came out holding none. */
  it('finds the role somebody actually holds', () => {
    expect(rolesOf('pat', space, roles, assignments).map((r) => r.id)).toEqual(['squadron'])
  })

  it('gives Owner to this server\'s owner and to nobody else', () => {
    expect(rolesOf('owner', space, roles, assignments).map((r) => r.id)).toEqual(['owner'])
    expect(rolesOf('pat', space, roles, assignments).map((r) => r.id)).not.toContain('owner')
  })

  /* Grouping by every server's roles put two Owner headings in one list. */
  it('ignores roles belonging to another server', () => {
    expect(rolesOf('owner', space, roles, assignments).map((r) => r.id))
      .not.toContain('elsewhere')
  })

  it('never lists @everyone, which is everybody and so says nothing', () => {
    expect(rolesOf('pat', space, roles, assignments).map((r) => r.id))
      .not.toContain('everyone')
  })
})

describe('the member list, grouped', () => {
  const roles = [
    role({ id: 'squadron', name: 'Squadron', position: 5, hoist: 1, colour: '#6FA8FF' }),
    role({ id: 'quiet', name: 'Quiet', position: 4, hoist: 0 }),
  ]
  const people = [user('pat'), user('sam'), user('ash')]
  const assignments: Assignment[] = [
    { user_id: 'pat', role_id: 'squadron' },
    { user_id: 'sam', role_id: 'quiet' },
  ]

  it('gives a hoisted role its own heading, in its own colour', () => {
    const [first] = memberGroups(people, space, roles, assignments)
    expect(first?.label).toBe('Squadron')
    expect(first?.colour).toBe('#6FA8FF')
    expect(first?.people.map((p) => p.id)).toEqual(['pat'])
  })

  it('and everybody else falls through to Online', () => {
    const groups = memberGroups(people, space, roles, assignments)
    const online = groups[groups.length - 1]
    expect(online?.label).toBe('Online')
    expect(online?.people.map((p) => p.id)).toEqual(['sam', 'ash'])
  })

  it('lists nobody twice', () => {
    const groups = memberGroups(people, space, roles, assignments)
    const seen = groups.flatMap((g) => g.people.map((p) => p.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('leaves out a heading nobody is under', () => {
    const groups = memberGroups([user('ash')], space, roles, assignments)
    expect(groups.map((g) => g.label)).toEqual(['Online'])
  })
})

describe('the order roles are drawn in, and the order the server stores', () => {
  /*
   * Both ends have to agree that first means highest, and they do for
   * different-looking reasons: byRank sorts on `b.position - a.position`, and
   * the reorder route writes `length - i` so the first id it is handed gets
   * the top position.
   *
   * Read the other way — which was the first guess when the buttons were
   * written — every nudge turns the whole ranking upside down, and it looks
   * exactly like the buttons doing the opposite of what they say. Asserted
   * against the route's own source, because the agreement is the thing that
   * matters and it lives in two files.
   */
  it('agree that the first one is the highest', () => {
    const sorted = inRankOrder([
      { ...role({ id: 'low' }), position: 1 },
      { ...role({ id: 'high' }), position: 9 },
    ])
    expect(sorted.map((r) => r.id)).toEqual(['high', 'low'])

    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'src', 'routes', 'admin.ts'), 'utf8')
    const at = src.indexOf("'/api/roles/reorder'")
    expect(at).toBeGreaterThan(-1)
    /* The first id gets the biggest number, which is the same claim as
       "first is highest" said in the server's own arithmetic. */
    expect(src.slice(at, at + 2500)).toContain('asked.length - i')
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
