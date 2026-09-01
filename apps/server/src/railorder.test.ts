import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, joinSpace, seedRolesFor, grantOwnerRole, setRailPosition } from './db.js'

/**
 * The order somebody has dragged their servers into.
 *
 * A property of the membership, not of the server: two people in the same
 * servers arrange them differently. It lived on space_members, which is why
 * the server list was the one read that could not move to containment - the
 * column was not there and the query threw.
 *
 * Dragging is an UPDATE of that column and nothing else, which the insert and
 * delete triggers do not cover. Without a trigger for it the rail would
 * quietly revert to the order things were joined, which reads as the app
 * forgetting an arrangement rather than as anything failing.
 */
const anna = randomUUID()
const spaces: string[] = []

function user(id: string) {
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
}

const railByContainment = (who: string) =>
  (db.prepare(
    `SELECT s.id FROM spaces s JOIN container_members m ON m.container_id = s.id
      WHERE m.user_id = ? ORDER BY COALESCE(m.position, m.joined_at), m.joined_at`
  ).all(who) as Array<{ id: string }>).map((r) => r.id)

beforeAll(() => {
  user(anna)
  for (let i = 0; i < 3; i++) {
    const s = randomUUID()
    spaces.push(s)
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(s, 'S' + i, anna, Date.now() + i)
    seedRolesFor(s); grantOwnerRole(s); joinSpace(anna, s)
  }
})

describe('the order of somebody\'s servers', () => {
  it('is the order they were joined, before anything is dragged', () => {
    /* This compared against the same query asked of space_members, which was
       the point while both existed. There is one table now, so the thing to
       check is the answer rather than the agreement: untouched, the rail is
       the order they were joined in. */
    expect(railByContainment(anna)).toEqual(spaces)
  })

  it('and follows a drag, which is an update and not an insert', () => {
    /* Put the last one first, the way the reorder route does. */
    const wanted = [spaces[2]!, spaces[0]!, spaces[1]!]
    wanted.forEach((id, i) => setRailPosition(anna, id, i))

    expect(railByContainment(anna), 'the drag was not recorded').toEqual(wanted)
  })

  it('and a server joined afterwards lands at the end, not in the middle', () => {
    const late = randomUUID()
    db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
      .run(late, 'Late', anna, Date.now() + 9999)
    seedRolesFor(late); grantOwnerRole(late); joinSpace(anna, late)
    expect(railByContainment(anna).at(-1)).toBe(late)
  })
})
