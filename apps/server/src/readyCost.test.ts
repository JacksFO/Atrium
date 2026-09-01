import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What building a ready frame is priced by.
 *
 * Everything on this path must cost what this person's account is worth, not
 * what the whole instance holds. The unread count was rewritten for that
 * reason and the comment explaining why is still there - and the query
 * fifteen lines above it, doing the same thing for the same reason, outlived
 * the rewrite. It read every undeleted message in the app, grouped them,
 * and used the handful that belonged to the person connecting.
 *
 * Read out of the source because the fault is the shape of the statement, and
 * a timing test on a database with five hundred rows in it would pass either
 * way - which is exactly how it survived the first time.
 */

const src = readFileSync(join(__dirname, 'gateway.ts'), 'utf8')
const ready = src.slice(src.indexOf("if (msg.t === 'hello')"), src.indexOf("t: 'ready'"))

describe('the queries that build it', () => {
  it('never group over the whole message table', () => {
    /* `GROUP BY channel_id` with no channel named is every message there has
       ever been, and its plan is a temporary B-tree. */
    expect(ready, 'a whole-table GROUP BY is back on the connect path')
      .not.toMatch(/FROM messages[^)]*GROUP BY channel_id/)
  })

  it('and ask for the newest message a channel at a time', () => {
    /* Which is a seek down idx_messages_channel, and does not grow with how
       much has been said on the instance. */
    expect(ready).toContain('WHERE channel_id = ? AND deleted_at IS NULL')
  })

  it('and only for the channels actually being sent', () => {
    const at = ready.indexOf('const lastByChannel')
    expect(at).toBeGreaterThan(-1)
    expect(ready.slice(at, at + 400)).toContain('of visible')
  })
})

describe('the index that makes it cheap', () => {
  it('still exists, or the seek becomes a scan', () => {
    const db = readFileSync(join(__dirname, 'db.ts'), 'utf8')
    expect(db).toContain('idx_messages_channel ON messages(channel_id, created_at DESC)')
  })
})
