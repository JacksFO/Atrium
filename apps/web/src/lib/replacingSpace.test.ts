import { describe, expect, it } from 'vitest'
import { replacingSpace } from './load'

/**
 * Putting one server's answer back among everybody else's.
 *
 * Every loader answers for a single server and the world holds one list, so
 * the only correct move is to replace that server's part. Assigning the
 * answer instead is the bug this exists to make impossible: renaming a
 * channel in one server emptied every other server's headings, and the next
 * server opened drew none of its channels.
 */

const row = (id: string, space_id: string | null) => ({ id, space_id })

describe('replacing one server’s rows', () => {
  it('keeps every other server’s', () => {
    const all = [row('a', 's1'), row('b', 's2'), row('c', 's3')]
    expect(replacingSpace(all, 's1', [row('a2', 's1')]).map((r) => r.id))
      .toEqual(['b', 'c', 'a2'])
  })

  it('keeps rows that belong to no server at all', () => {
    /* Conversations, which are nobody's server and must survive all of it. */
    const all = [row('dm', null), row('a', 's1')]
    expect(replacingSpace(all, 's1', []).map((r) => r.id)).toEqual(['dm'])
  })

  it('drops what that server no longer has', () => {
    const all = [row('old', 's1'), row('keep', 's2')]
    expect(replacingSpace(all, 's1', [row('new', 's1')]).map((r) => r.id))
      .toEqual(['keep', 'new'])
  })

  it('and does not touch the list it was given', () => {
    const all = [row('a', 's1'), row('b', 's2')]
    replacingSpace(all, 's1', [])
    expect(all.map((r) => r.id)).toEqual(['a', 'b'])
  })
})
