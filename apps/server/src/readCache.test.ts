import { beforeEach, describe, expect, it } from 'vitest'
import { db, readCacheSize, readCacheStats, resetReadCacheStats, withReadCache } from './db.js'

/**
 * Remembering an answer for the length of one block.
 *
 * Working out what somebody is allowed to do asks the same few questions over
 * and over - who owns this space, is this person in it, what is this channel.
 * On the live data one person connecting ran 103 statements and 63 of them
 * were an exact repeat.
 *
 * What makes it safe is that it is small and short. A cache that outlived its
 * block, or that survived a write, would be a permissions bug: somebody
 * removed from a space, or a role changed, and an answer from before it still
 * being handed out. So the rules are tested rather than described.
 */

const table = 'zz_read_cache_probe'

beforeEach(() => {
  db.exec(`DROP TABLE IF EXISTS ${table}`)
  db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, value TEXT)`)
  db.prepare(`INSERT INTO ${table} (id, value) VALUES ('a', 'first')`).run()
  resetReadCacheStats()
})

const read = () =>
  db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get('a') as { value: string } | undefined

describe('outside a block', () => {
  it('nothing is remembered', () => {
    expect(readCacheSize()).toBe(null)
    read()
    read()
    expect(readCacheStats().ran).toBe(2)
    expect(readCacheStats().served).toBe(0)
  })
})

describe('inside one', () => {
  it('the same question is asked once', () => {
    withReadCache(() => {
      expect(read()?.value).toBe('first')
      expect(read()?.value).toBe('first')
      expect(read()?.value).toBe('first')
    })
    expect(readCacheStats().ran).toBe(1)
    expect(readCacheStats().served).toBe(2)
  })

  it('but a different question is still asked', () => {
    db.prepare(`INSERT INTO ${table} (id, value) VALUES ('b', 'second')`).run()
    resetReadCacheStats()
    withReadCache(() => {
      expect(read()?.value).toBe('first')
      const other = db.prepare(`SELECT value FROM ${table} WHERE id = ?`).get('b') as { value: string }
      expect(other.value).toBe('second')
    })
    expect(readCacheStats().served).toBe(0)
  })

  it('and the block still gets its answer back', () => {
    expect(withReadCache(() => read()?.value)).toBe('first')
  })
})

describe('a write empties it', () => {
  it('so nothing after a change is answered from before it', () => {
    /* The whole safety of this. Somebody removed from a space, or a role
       edited, must not be read back as they were a moment ago. */
    withReadCache(() => {
      expect(read()?.value).toBe('first')
      db.prepare(`UPDATE ${table} SET value = 'changed' WHERE id = 'a'`).run()
      expect(read()?.value, 'read fresh after the write').toBe('changed')
    })
  })

  it('including a write through exec, which migrations use', () => {
    withReadCache(() => {
      expect(read()?.value).toBe('first')
      db.exec(`UPDATE ${table} SET value = 'execed' WHERE id = 'a'`)
      expect(read()?.value).toBe('execed')
    })
  })
})

describe('the block it belongs to', () => {
  it('is closed when it ends', () => {
    withReadCache(() => { expect(readCacheSize()).not.toBe(null) })
    expect(readCacheSize()).toBe(null)
  })

  it('and closed when it throws, rather than left open for everything after', () => {
    expect(() => withReadCache(() => { throw new Error('no') })).toThrow('no')
    expect(readCacheSize(), 'a leaked scope would outlive its request').toBe(null)
  })

  it('and a block inside a block shares the one already open', () => {
    withReadCache(() => {
      read()
      withReadCache(() => { read() })
      /* Still open after the inner one finished, because the inner one did
         not own it. */
      expect(readCacheSize()).not.toBe(null)
    })
    expect(readCacheStats().ran).toBe(1)
    expect(readCacheStats().served).toBe(1)
    expect(readCacheSize()).toBe(null)
  })
})
