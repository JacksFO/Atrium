import { describe, expect, it } from 'vitest'
import { Api } from './api'

/**
 * What goes on the wire, and what does not.
 *
 * The content type was set on every request whether or not there was a body,
 * and a DELETE has no body - so Fastify was handed "this is JSON" and nothing
 * to parse, and refused before the route was reached: "Body cannot be empty
 * when content-type is set to application/json".
 *
 * Every DELETE in the app went that way. It surfaced on the newest one
 * because that was the one somebody pressed; deleting a channel, a role or an
 * invite had the same fault waiting.
 */

const headersOf = (init: RequestInit) => (init.headers ?? {}) as Record<string, string>

/**
 * A server with its fetch replaced.
 *
 * The class takes one, which is what makes this testable without a network -
 * and it captures it at construction, so stubbing the global afterwards would
 * do nothing.
 */
function watched() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const server = new Api({
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch,
  })
  server.setToken('tok')
  return { server, calls }
}

describe('a request with no body', () => {
  it('does not claim to be JSON', async () => {
    const { server, calls } = watched()
    await server.delete('/api/spaces/s1')
    expect(headersOf(calls[0]!.init)['content-type']).toBeUndefined()
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('and neither does a GET', async () => {
    const { server, calls } = watched()
    await server.get('/api/dms')
    expect(headersOf(calls[0]!.init)['content-type']).toBeUndefined()
  })
})

describe('a request with one', () => {
  it('says so, and sends it', async () => {
    const { server, calls } = watched()
    await server.post('/api/spaces', { name: 'Somewhere' })
    expect(headersOf(calls[0]!.init)['content-type']).toBe('application/json')
    expect(calls[0]!.init.body).toBe('{"name":"Somewhere"}')
  })

  /* An empty object is a body. Somebody sending {} means it. */
  it('and an empty object still counts as one', async () => {
    const { server, calls } = watched()
    await server.post('/api/invites/abc/accept', {})
    expect(headersOf(calls[0]!.init)['content-type']).toBe('application/json')
    expect(calls[0]!.init.body).toBe('{}')
  })
})

describe('and the token', () => {
  it('rides along either way', async () => {
    const { server, calls } = watched()
    await server.delete('/api/x')
    await server.post('/api/y', { a: 1 })
    expect(headersOf(calls[0]!.init).authorization).toBe('Bearer tok')
    expect(headersOf(calls[1]!.init).authorization).toBe('Bearer tok')
  })
})
