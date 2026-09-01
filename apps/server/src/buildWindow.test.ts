import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Opening the app during a client build.
 *
 * Updating the client is "pull, build", and the build writes into the very
 * folder the running server is serving - so for a moment index.html is not
 * there. Every URL that is not an API path, an upload or the gateway falls
 * through to the SPA handler, which read that file with no guard: the read
 * threw, Fastify turned it into a 500, and somebody who had done nothing but
 * open the app got an error page.
 *
 * It is in the logs once, at 01:43 on 1 September, on a request for
 * /version.json - which is a static file, so it 404s into the same handler.
 *
 * The window cannot be removed without changing how a deploy works. It can be
 * made invisible: hold the last copy that was readable and hand that out
 * instead, because the page from a second ago is a page that works.
 */

const src = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')

describe('the page the app is served from', () => {
  const fn = (() => {
    const from = src.indexOf('function clientPage()')
    expect(from, 'there is one place that reads it').toBeGreaterThan(-1)
    const to = src.indexOf('\n}', from)
    return src.slice(from, to)
  })()

  it('remembers the last copy it could read', () => {
    expect(fn).toContain('lastGoodPage = page')
  })

  it('and hands that back when the file is not there', () => {
    expect(fn).toContain('return lastGoodPage')
    /* In the catch, not as the happy path: a stale page must never be
       preferred to the one on disk. */
    const catchArm = fn.slice(fn.indexOf('} catch'))
    expect(catchArm).toContain('return lastGoodPage')
  })

  /* Remembered after a successful read and never in the catch, or a failure
     would poison what is remembered. */
  it('and never remembers a failure', () => {
    expect(fn.indexOf('lastGoodPage = page')).toBeLessThan(fn.indexOf('} catch'))
    expect(fn.slice(fn.indexOf('} catch'))).not.toContain('lastGoodPage =')
  })
})

describe('the handler every deep link lands in', () => {
  const handler = (() => {
    const from = src.indexOf('app.setNotFoundHandler')
    expect(from).toBeGreaterThan(-1)
    const to = src.indexOf('\n  })', from)
    return src.slice(from, to)
  })()

  it('asks for the page through the guard rather than reading the file', () => {
    expect(handler).toContain('clientPage()')
    expect(handler).not.toContain("readFileSync(join(CLIENT_DIST, 'index.html'))")
  })

  /*
   * A server that has never read a page has nothing to hand out, and that is
   * a real state - a server started before the client was ever built. It says
   * so with a 503 rather than throwing, because "try again in a moment" is
   * true and an error page is not.
   */
  it('and says the app is being updated rather than throwing', () => {
    expect(handler).toContain('503')
    expect(handler).toMatch(/being updated/i)
  })

  /* The headers still go on. This handler exists because deep links used to
     be served with no policy at all. */
  it('while still setting the policy and the cache rule', () => {
    expect(handler).toContain("reply.header('content-security-policy', webCsp())")
    expect(handler).toContain("reply.header('cache-control', 'no-cache')")
  })

  /* And an API path still 404s as an API path, rather than being handed a
     page a fetch cannot use. */
  it('and an API path still gets an error, not the app', () => {
    expect(handler).toContain("req.url.startsWith('/api/')")
    expect(handler).toContain("reply.code(404).send({ error: 'not found' })")
  })
})
