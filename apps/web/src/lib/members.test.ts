import { describe, expect, it } from 'vitest'
import { grantableRoles, mayActOn, rankOf } from './members'
import type { Role, Space } from './wire'

const space = { id: 's1', owner_id: 'boss' } as Pick<Space, 'id' | 'owner_id'>

const role = (id: string, position: number, over: Partial<Role> = {}): Role => ({
  id, space_id: 's1', name: id, colour: '#8395A6', position,
  permissions: '[]', kind: 'custom', hoist: 0, created_at: 0, ...over,
})

const roles: Role[] = [
  role('everyone', 0, { kind: 'everyone' }),
  role('mod', 5),
  role('admin', 8),
  role('owner', 99, { kind: 'owner' }),
]

describe('where somebody sits', () => {
  it('is the top of the roles they hold', () => {
    expect(rankOf('u1', space, roles, ['mod', 'admin'])).toBe(8)
  })

  /* Holding nothing is below every role there is, which is not the same as
     holding one placed at zero — read as zero, somebody with no roles at all
     outranks @everyone and can act on people who hold it. */
  it('and holding nothing is below all of them', () => {
    expect(rankOf('u1', space, roles, [])).toBe(-1)
    expect(rankOf('u1', space, roles, ['everyone'])).toBe(0)
  })

  /* Whoever made the server outranks a role placed above theirs. That is the
     server's rule and not a position, so it cannot be out-positioned. */
  it('and whoever owns the server is above everything', () => {
    expect(rankOf('boss', space, roles, [])).toBe('owner')
  })

  /* A role held in a different server says nothing about this one — this is
     how somebody's standing elsewhere used to follow them here. */
  it('and a role from somewhere else counts for nothing', () => {
    const elsewhere = [...roles, { ...role('boss2', 90), space_id: 's2' }]
    expect(rankOf('u1', space, elsewhere, ['boss2'])).toBe(-1)
  })
})

describe('who may act on whom', () => {
  it('is whoever is higher', () => {
    expect(mayActOn(8, 5, false)).toBe(true)
    expect(mayActOn(5, 8, false)).toBe(false)
  })

  /* Level with somebody is not above them: two moderators cannot remove each
     other, which is the whole point of them being level. */
  it('and level is not above', () => {
    expect(mayActOn(5, 5, false)).toBe(false)
  })

  /*
   * Never on yourself. The server refuses it, and a Remove button on your own
   * row is a way to lock yourself out of your own server by misreading a list
   * — the owner outranks everybody including, arithmetically, themselves.
   */
  it('and never on yourself, however high you are', () => {
    expect(mayActOn('owner', 'owner', true)).toBe(false)
    expect(mayActOn(9, 9, true)).toBe(false)
  })
})

describe('which roles somebody may hand out', () => {
  it('is the ones below their own', () => {
    expect(grantableRoles(roles, space, 8).map((r) => r.id)).toEqual(['mod'])
  })

  it('and never their own level or above', () => {
    expect(grantableRoles(roles, space, 5).map((r) => r.id)).toEqual([])
  })

  /* Everybody holds @everyone by being here, so there is nothing to give or
     take — a switch for it would do nothing whichever way it was set. */
  it('and never the default one', () => {
    const out = grantableRoles(roles, space, 'owner').map((r) => r.id)
    expect(out).not.toContain('everyone')
  })

  /* Nor the Owner role: it is the ceiling the ordering is measured against,
     and handing it out is handing over the server. */
  it('and never the owner role, even to the owner', () => {
    expect(grantableRoles(roles, space, 'owner').map((r) => r.id)).toEqual(['admin', 'mod'])
  })

  it('and nothing from another server', () => {
    const elsewhere = [...roles, { ...role('other', 1), space_id: 's2' }]
    expect(grantableRoles(elsewhere, space, 'owner').map((r) => r.id)).not.toContain('other')
  })
})
