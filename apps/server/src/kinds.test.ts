import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isConversationKind, isRoomKind } from './kinds.js'

/**
 * "Is this a conversation" is asked in one way, everywhere.
 *
 * It used to be written out as `kind === 'dm'` in ten places, and each was
 * correct only because a group is stored with kind 'dm' too. Every one of
 * them would become a different bug the day that changes - a group missing
 * from the sidebar, a group with no member list, a call refused in a group, a
 * poll in a group asking a server's roles for permission - and none would say
 * so.
 *
 * The predicate is the fix. This is what stops it drifting back.
 */
describe('the predicate', () => {
  it('says a pair and a group are both conversations', () => {
    expect(isConversationKind('dm')).toBe(true)
    expect(isConversationKind('group')).toBe(true)
  })

  it('and a room in a server is not', () => {
    expect(isConversationKind('text')).toBe(false)
    expect(isConversationKind('voice')).toBe(false)
    expect(isConversationKind(null)).toBe(false)
    expect(isConversationKind(undefined)).toBe(false)
  })

  it('and the other way round', () => {
    expect(isRoomKind('text')).toBe(true)
    expect(isRoomKind('voice')).toBe(true)
    expect(isRoomKind('dm')).toBe(false)
    expect(isRoomKind('group')).toBe(false)
  })
})

/**
 * And nothing asks it the old way.
 *
 * One exception, and it is a real one: the lookup for the conversation
 * between two named people means a pair specifically - a group with those two
 * in it is not the conversation between them. It is allowed to say 'dm', and
 * being the only place that does is what makes it visible.
 */
describe('how the rest of the server asks', () => {
  const FILES = [
    'src/access.ts', 'src/gateway.ts', 'src/index.ts', 'src/permissions.ts',
    'src/routes/admin.ts', 'src/routes/polls.ts',
  ]

  const read = (f: string) => readFileSync(resolve(process.cwd(), f), 'utf8')

  /* Written out rather than as a pattern: escapes do not survive every tool
     between here and the file, and a pattern that quietly stops matching
     passes for ever. */
  const OLD_WAYS = [
    "kind === 'dm'",
    "kind !== 'dm'",
    "kind == 'dm'",
    "kind = 'dm'",
  ]

  it('is more than one phrase, so this is not checking a single line', () => {
    expect(OLD_WAYS.length).toBeGreaterThan(3)
  })

  it('never by comparing the kind directly', () => {
    for (const file of FILES) {
      const src = read(file)
      const guilty = OLD_WAYS.filter((w) => src.includes(w))
      expect(guilty, `${file} still asks the old way: ${guilty.join(', ')}`).toEqual([])
    }
  })

  /* The predicate has to actually be in use, or the check above passes on a
     server that has stopped asking the question at all. */
  it('and every one of those files asks the new way', () => {
    for (const file of FILES) {
      expect(read(file), file + ' does not use the predicate').toContain('isConversationKind')
    }
  })

  it('except the lookup for a pair, which means a pair', () => {
    const db = read('src/db.ts')
    expect(db, 'the pair lookup should still say dm').toContain("k.kind = 'dm'")
  })
})
