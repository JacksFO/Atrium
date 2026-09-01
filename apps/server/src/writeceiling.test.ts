import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { allow } from './ratelimit.js'

/**
 * A ceiling on writes, above whatever each route asks for itself.
 *
 * Eleven routes had a limit of their own and forty-four did not, so the ones
 * nobody had thought about were the ones with no floor under them. One
 * backstop covers those, and covers the next route added without remembering.
 *
 * The budget was chosen from the live log rather than guessed, and that
 * mattered: the busiest real minute on this machine was 241 profile writes
 * from one person dragging a colour picker. A tidy-looking limit of 240 would
 * have broken picking a colour on the first day.
 */

const src = readFileSync(resolve(process.cwd(), 'src/index.ts'), 'utf8')
const hook = src.slice(src.indexOf('const WRITES = new Set'),
  src.indexOf('if (!path.startsWith(\'/uploads/\'))'))

describe('the write ceiling', () => {
  it('exists and is a hook rather than a call site', () => {
    /* Or every assertion below is about an empty string. */
    expect(hook.length).toBeGreaterThan(200)
    expect(hook).toContain("app.addHook('onRequest'")
  })

  /* Reading is not writing. A limit that counted reads would throttle
     scrolling a channel, which is the app working normally. */
  it('counts only the verbs that change something', () => {
    expect(hook).toContain("new Set(['POST', 'PUT', 'PATCH', 'DELETE'])")
    expect(hook).toContain('if (!WRITES.has(req.method)) return')
  })

  /* And only the API. Uploads, downloads and the client's own files go
     through the same server. */
  it('and only the API', () => {
    expect(hook).toContain("startsWith('/api/')")
  })

  /* Per session, so one person's runaway tab does not lock out their phone,
     and per address, so holding several tokens does not multiply the budget. */
  it('and counts per session and per address, not one or the other', () => {
    expect(hook).toContain('w:${who}')
    expect(hook).toContain('w:a:${req.ip}')
  })

  /* Hashed rather than verified: an HMAC on the front of every write buys
     nothing here, because this decides a bucket and not an identity. */
  it('and does not verify a token just to pick a bucket', () => {
    expect(hook).toContain('createHash')
    expect(hook).not.toContain('jwtVerify')
    expect(hook).not.toContain('await readToken')
  })

  it('and says when to come back', () => {
    expect(hook).toContain('retry-after')
    expect(hook).toContain('429')
  })

  /*
   * Above every per-route limit the ceiling actually governs, or it fires
   * first and the specific ones become unreachable - which would turn twelve
   * considered limits into one blunt one.
   *
   * It governs writes only, and that is now load-bearing rather than
   * incidental. /api/media carries a wide budget for handing back a picture
   * already held in memory; the ceiling never sees a GET, so comparing that
   * budget against it fails for a reason that does not exist. The nearest
   * preceding app.<verb> is the route a limit belongs to.
   */
  it('and sits above the strictest per-route limit it governs', () => {
    const verbs = [...src.matchAll(/\bapp\.(get|post|put|patch|delete)\(/g)]
    const verbAt = (at: number) => {
      let found = ''
      for (const v of verbs) { if (v.index! > at) break; found = v[1] ?? found }
      return found
    }
    const limits = [...src.matchAll(/allow\(`([a-z-]+):\$\{[^}]+\}`, (\d+), 60_000\)/g)]
      /* The ceiling's own two calls are excluded by name, or it compares
         itself against itself and passes for the wrong reason. */
      .filter((m) => m[1] !== 'w')
      .map((m) => ({ name: m[1], budget: Number(m[2]), verb: verbAt(m.index!) }))

    /* The reading above is a claim about the source, so it is checked: the
       wide media budget really is on a GET and out of the ceiling's reach. */
    expect(limits.find((l) => l.name === 'media')?.verb).toBe('get')

    const governed = limits.filter((l) => l.verb !== 'get')
    expect(governed.length).toBeGreaterThan(3)
    expect(Math.max(...governed.map((l) => l.budget))).toBeLessThan(400)
  })
})

/* The limiter underneath it does what the ceiling assumes. */
describe('the budget it is built on', () => {
  beforeEach(() => { /* keys are unique per test, so nothing to reset */ })

  it('lets a burst through up to the limit', () => {
    const key = `t:${Math.random()}`
    for (let i = 0; i < 400; i++) expect(allow(key, 400, 60_000)).toBe(true)
  })

  it('and refuses the one after', () => {
    const key = `t:${Math.random()}`
    for (let i = 0; i < 400; i++) allow(key, 400, 60_000)
    expect(allow(key, 400, 60_000)).toBe(false)
  })

  /* 241 in a minute really happened, from one person choosing a colour. */
  it('and would not have refused the busiest real minute on this machine', () => {
    const key = `t:${Math.random()}`
    let refused = 0
    for (let i = 0; i < 241; i++) if (!allow(key, 400, 60_000)) refused++
    expect(refused).toBe(0)
  })
})
