import { beforeEach, describe, expect, it } from 'vitest'
import { db, rememberVoiceModeration } from './db.js'

/**
 * A server mute surviving a restart.
 *
 * This is the write that did not work. It named neither the space nor a real
 * conflict target, so it threw on every call - and because it sat before the
 * rest of the handler, the audit entry, the instruction to re-mint the token
 * and the broadcast went with it. The mute was held in memory, drawn in the
 * member list, and never applied to the thing that actually carries the
 * grant. Nobody noticed because a rejected promise here is logged, not fatal.
 *
 * Tested against the real table, because the bug was entirely in the
 * disagreement between the statement and the schema.
 */

const A = 'space-a'
const B = 'space-b'
const WHO = 'person-1'

const row = (space: string, user: string) =>
  db.prepare('SELECT muted, deafened, implied FROM voice_moderation WHERE space_id = ? AND user_id = ?')
    .get(space, user) as { muted: number; deafened: number; implied: number } | undefined

beforeEach(() => {
  db.prepare('DELETE FROM voice_moderation WHERE user_id = ?').run(WHO)
})

describe('writing a decision down', () => {
  it('does not throw, which is the whole of the bug', () => {
    expect(() => rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false }))
      .not.toThrow()
  })

  it('keeps the server it was made in', () => {
    /* A mute belongs to one server: the same person can be silenced in one
       and untouched in another. The old statement had no space at all. */
    rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false })
    expect(row(A, WHO)).toMatchObject({ muted: 1, deafened: 0 })
    expect(row(B, WHO), 'a mute leaked into another server').toBe(undefined)
  })

  it('and keeps them apart when both are set', () => {
    rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false })
    rememberVoiceModeration(B, WHO, { muted: false, deafened: true, implied: true })
    expect(row(A, WHO)).toMatchObject({ muted: 1, deafened: 0, implied: 0 })
    expect(row(B, WHO)).toMatchObject({ muted: 0, deafened: 1, implied: 1 })
  })

  it('changes one rather than adding a second', () => {
    rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false })
    rememberVoiceModeration(A, WHO, { muted: true, deafened: true, implied: true })
    const n = db.prepare('SELECT COUNT(*) n FROM voice_moderation WHERE user_id = ?')
      .get(WHO) as { n: number }
    expect(n.n).toBe(1)
    expect(row(A, WHO)).toMatchObject({ muted: 1, deafened: 1, implied: 1 })
  })

  it('and lifting both removes the row rather than storing two noughts', () => {
    rememberVoiceModeration(A, WHO, { muted: true, deafened: true, implied: false })
    rememberVoiceModeration(A, WHO, { muted: false, deafened: false, implied: false })
    expect(row(A, WHO)).toBe(undefined)
  })

  it('and lifting one of two leaves the other standing', () => {
    rememberVoiceModeration(A, WHO, { muted: true, deafened: true, implied: true })
    rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false })
    expect(row(A, WHO)).toMatchObject({ muted: 1, deafened: 0, implied: 0 })
  })
})

describe('what boot reads back', () => {
  it('is the pair, which is what the memory is keyed by', () => {
    /* The gateway rebuilds its sets with modKey(space_id, user_id). A row
       without a space would come back keyed under nothing and never match. */
    rememberVoiceModeration(A, WHO, { muted: true, deafened: false, implied: false })
    const back = db.prepare(
      'SELECT space_id, user_id FROM voice_moderation WHERE user_id = ?',
    ).get(WHO) as { space_id: string; user_id: string }
    expect(back.space_id).toBe(A)
    expect(back.user_id).toBe(WHO)
  })
})
