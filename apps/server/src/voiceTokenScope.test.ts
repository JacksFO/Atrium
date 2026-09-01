import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Which server a channel is judged in.
 *
 * A conversation belongs to no server. `serverMuted` is asked on every voice
 * token, conversations included, and takes null to mean "nowhere to be
 * muted" - so handing it a server instead of null is how a mute applied in
 * one place follows somebody into their private calls.
 *
 * That is exactly the fault the comment beside the mute check says was fixed,
 * and it was reintroduced by the fallback in the helper feeding it: a DM's
 * `space_id` is NULL, and the old fallback turned that into the seeded server.
 */

const src = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('a channel with no server', () => {
  it('is answered as having none, not as having the first one', () => {
    const at = src.indexOf('function spaceOfChannel(')
    expect(at, 'the helper is gone').toBeGreaterThan(-1)
    const body = src.slice(at, src.indexOf('\n}', at))
    expect(body).toContain('row?.space_id ?? null')
    expect(body, 'falling back to another server is the bug')
      .not.toMatch(/\w*[Ss]paceId\(\)/)
  })
})

describe('the mute on a voice token', () => {
  it('is asked about the room being joined', () => {
    expect(src).toContain('serverMuted(spaceOfChannel(channelId), user.id)')
  })

  it('and takes no server to mean nowhere to be muted', () => {
    /* Which is what makes a conversation immune to another server's
       moderators - see gateway.ts. */
    const gw = readFileSync(join(__dirname, 'gateway.ts'), 'utf8')
    const at = gw.indexOf('export function serverMuted(')
    expect(at).toBeGreaterThan(-1)
    expect(gw.slice(at, gw.indexOf('\n}', at))).toContain('spaceId !== null')
  })
})

describe('the two helpers of the same name', () => {
  it('answer the same way, because one of them being different was the bug', () => {
    const gw = readFileSync(join(__dirname, 'gateway.ts'), 'utf8')
    const there = gw.slice(gw.indexOf('function spaceOfChannel('))
    expect(there.slice(0, there.indexOf('\n}'))).toContain('row?.space_id ?? null')
  })
})
