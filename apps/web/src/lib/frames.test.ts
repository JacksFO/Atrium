import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deleteFrame, editFrame, reactFrame, readFrame } from './actions'

/**
 * The names on a frame are the names the gateway reads.
 *
 * This is the quietest failure on the whole wire. The gateway reads the
 * fields it knows by name and ignores the rest — so a frame with `path` where
 * the server wanted `url`, or `reply` where it wanted `replyTo`, is not
 * refused. It is accepted, and the part under the wrong name simply does not
 * happen: the message arrives without its picture, or without being a reply,
 * and nothing anywhere says why.
 *
 * Both of those are real. Both were found by reading the gateway rather than
 * by anything failing.
 */

const GATEWAY = readFileSync(
  join(__dirname, '..', '..', '..', 'server', 'src', 'gateway.ts'), 'utf8')

/** What the gateway reads off a frame, inside the case that handles it. */
function readsFor(kind: string): Set<string> {
  const at = GATEWAY.indexOf(`case '${kind}': {`)
  if (at < 0) return new Set()
  /* To the end of that case, which is where the next one starts. */
  const next = GATEWAY.indexOf("        case '", at + 10)
  const block = GATEWAY.slice(at, next > at ? next : at + 4000)
  return new Set([...block.matchAll(/msg\.([a-zA-Z]+)/g)].map((m) => m[1]!))
}

const check = (frame: Record<string, unknown>) => {
  const kind = String(frame.t)
  const reads = readsFor(kind)
  expect(reads.size, `the gateway has no case for '${kind}'`).toBeGreaterThan(0)
  const unread = Object.keys(frame).filter((k) => k !== 't' && !reads.has(k))
  expect(unread, `'${kind}' carries fields the gateway never reads`).toEqual([])
}

describe('every frame this client sends', () => {
  it('reacting', () => check(reactFrame('m1', '\u{1F525}')))
  it('editing', () => check(editFrame('m1', 'words')))
  it('deleting', () => check(deleteFrame('m1')))
  it('marking read', () => check(readFrame('c1')))

  /* Typing and sending are built where they are used rather than by a
     builder, so they are written out here as the shapes those call sites
     actually construct — checked against the same reading of the gateway. */
  it('typing', () => check({ t: 'typing', channelId: 'c1' }))

  it('sending, with everything a message can carry', () => {
    check({
      t: 'send',
      channelId: 'c1',
      body: 'words',
      attachments: [],
      replyTo: 'm1',
    })
  })

  /*
   * And the one that is deliberately absent. Without a nonce the server
   * answers a refusal as `error` rather than `send-refused` — both are
   * declared and both reach the screen, so nothing is lost, and there is no
   * outbox here replaying unsent messages for it to deduplicate.
   */
  it('and not a nonce, which this client has no outbox to need', () => {
    expect(readsFor('send').has('nonce')).toBe(true)
    const src = readFileSync(join(__dirname, '..', 'ui', 'Shell.tsx'), 'utf8')
    expect(src).not.toContain('nonce')
  })
})

describe('a refusal', () => {
  /* Said out loud, both ways. A refusal that went unmentioned left somebody
     with a message marked unsent that could never succeed. */
  it('is an event this client declares in both of its shapes', () => {
    const wire = readFileSync(join(__dirname, 'wire.ts'), 'utf8')
    expect(wire).toContain("'send-refused'")
    expect(wire).toContain("'error'")
  })
})
