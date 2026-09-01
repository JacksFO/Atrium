import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerEvent } from './wire'

/**
 * The two ends agree about what the socket carries.
 *
 * An event the server sends and this client does not declare is one the
 * gateway drops on arrival — silently, because an unknown `t` matches no
 * case. That is what happened to the whole permissions payload: the server
 * had been sending it for as long as it existed, the client declared the
 * event as carrying nothing, and what somebody was allowed to do only
 * changed when they reloaded.
 *
 * Checked by reading both sources rather than by keeping a third list, and
 * both extractions are written to cope with how each end actually spells it:
 * `t:` is not always the first thing after a brace on the server, and the
 * client says `ready` inside a named type rather than as a union arm. Doing
 * this by hand with grep got the answer wrong twice before it got it right.
 */

const SERVER = join(__dirname, '..', '..', '..', 'server', 'src')

/** Every event name the server puts on a socket. */
const sent = (() => {
  const files = [
    ...readdirSync(SERVER).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
      .map((f) => join(SERVER, f)),
    ...readdirSync(join(SERVER, 'routes')).map((f) => join(SERVER, 'routes', f)),
  ]
  const out = new Set<string>()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    /* Wherever it appears — not only immediately after a brace, which is how
       every multi-line push was missed the first time. */
    for (const m of src.matchAll(/(?:^|[{,\s])t:\s*'([a-z-]+)'/gm)) out.add(m[1]!)
    /* And the ones handed to a helper as its name rather than written into an
       object — message-restore is only ever spelled this way. */
    for (const m of src.matchAll(/toChannelHydrated\([^)]*'([a-z-]+)'\s*\)/g)) out.add(m[1]!)
    /*
     * And the ones whose name is worked out rather than written.
     *
     * Call signalling is routed back under the name it came in as, with one
     * renamed on the way: `t: msg.t === 'call-ring' ? 'call-incoming' : msg.t`.
     * Read literally that is a server which sends `call-incoming` and nothing
     * else, so the four it really sends looked invented by the client.
     */
    for (const m of src.matchAll(/case\s+'(call-[a-z]+)':/g)) {
      const name = m[1]!
      out.add(name === 'call-ring' ? 'call-incoming' : name)
    }
  }
  return out
})()

/** Every event name this client declares, in either shape. */
const declared = (() => {
  const src = readFileSync(join(__dirname, 'wire.ts'), 'utf8')
  return new Set([...src.matchAll(/t:\s*'([a-z-]+)'/g)].map((m) => m[1]!))
})()

describe('what the socket carries', () => {
  it('is a real list on both sides, so this is asking a real question', () => {
    expect(sent.size).toBeGreaterThan(20)
    expect(declared.size).toBeGreaterThan(20)
  })

  /*
   * The direction that matters. An event the server sends and this does not
   * declare is dropped without a word — the app simply does not update, and
   * nothing anywhere says why.
   */
  it('and this client declares everything the server sends', () => {
    expect([...sent].filter((t) => !declared.has(t)).sort()).toEqual([])
  })

  /*
   * And the other way, which is a smaller problem but still one: a case
   * written for an event that never arrives is code that cannot be reached,
   * and it reads as a feature that is wired up.
   */
  it('and declares nothing the server never sends', () => {
    expect([...declared].filter((t) => !sent.has(t)).sort()).toEqual([])
  })

  /* The union is exhaustive at compile time — this only proves the union is
     the right union. Both halves are needed: the compiler cannot know what a
     server in another package sends. */
  it('while the compiler settles that every declared one is handled', () => {
    const t: ServerEvent['t'] = 'ready'
    expect(declared.has(t)).toBe(true)
  })
})
