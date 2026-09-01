import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * A committed message is on the disk before it is called committed.
 *
 * WAL with synchronous = NORMAL - the usual default, and what this ran on -
 * makes a commit durable against the process dying and not against the
 * machine losing power: the log is not flushed on each one, so a power cut
 * takes the last few seconds of writes. The database cannot corrupt either
 * way; it is the recent messages that go, on a server under a desk with no
 * UPS.
 *
 * Measured on that machine before changing it: 0.021ms a commit at NORMAL
 * against 1.072ms at FULL. A millisecond a write, against never losing
 * somebody's message to a power cut.
 */

describe('the database this process opened', () => {
  it('flushes every commit to the disk', () => {
    const row = db.prepare('PRAGMA synchronous').get() as { synchronous: number }
    /* 2 is FULL. 1 is NORMAL, which is what this used to be, and 0 is OFF -
       which would be faster still and would lose the database, not just the
       last few seconds of it. */
    expect(row.synchronous).toBe(2)
  })

  /*
   * And still in WAL, because the two are independent and it is WAL that
   * keeps reads working while a write is in flight. FULL on its own, in the
   * rollback journal, would be slower for no gain here.
   */
  it('while readers still work during a write', () => {
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(String(row.journal_mode).toLowerCase()).toBe('wal')
  })

  /* A blocked write waits rather than failing outright - the nightly backup
     takes a read lock across the whole database. */
  it('and a write that meets a lock waits for it', () => {
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
    expect(row.timeout).toBeGreaterThanOrEqual(5000)
  })
})

/**
 * And the choice is written down where it is made.
 *
 * The line said `synchronous = NORMAL` with no comment, next to a WAL line
 * that had a paragraph - which is how a default gets mistaken for a decision
 * and left alone for months. Whatever it is set to next, it should have to
 * explain itself.
 */
describe('the reasoning beside it', () => {
  const src = readFileSync(join(__dirname, 'db.ts'), 'utf8').split('\r\n').join('\n')

  it('sets it once, and says why', () => {
    const at = src.indexOf('PRAGMA synchronous')
    expect(at).toBeGreaterThan(-1)
    /* Once: two settings of the same pragma is one of them being a surprise. */
    expect(src.split('PRAGMA synchronous').length - 1).toBe(1)
    /* The paragraph above it carries the measurement it was decided on. */
    const above = src.slice(Math.max(0, at - 1200), at)
    expect(above).toContain('ms per commit')
    expect(above).toMatch(/power cut/i)
  })
})
