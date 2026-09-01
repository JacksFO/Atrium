import { describe, expect, it } from 'vitest'
import { livekitTarget } from './gateway.js'

/**
 * Where a /livekit request is forwarded to.
 *
 * Nothing authenticates a WebSocket upgrade, so this function is the whole of
 * the defence: anybody who can reach the server can ask it to open one of
 * these. It used to be string concatenation - the configured address with the
 * request's path stuck on the end - and a path is not a suffix.
 * `/livekit@evil.example/x` produced `ws://localhost:7880@evil.example/x`,
 * where `localhost:7880` is the userinfo and the host is somebody else's
 * machine, and the frames were relayed back to whoever asked.
 */

const BASE = 'ws://localhost:7880'

describe('an ordinary signalling request', () => {
  it('goes to the configured server, path and query intact', () => {
    expect(livekitTarget('/livekit/rtc?access_token=abc', BASE))
      .toBe('ws://localhost:7880/rtc?access_token=abc')
  })

  it('and the prefix on its own is the root', () => {
    expect(livekitTarget('/livekit', BASE)).toBe('ws://localhost:7880/')
  })

  it('and a query with no path still gets there', () => {
    expect(livekitTarget('/livekit?token=x', BASE)).toBe('ws://localhost:7880/?token=x')
  })

  it('keeps a wss base as wss', () => {
    /* The default port is dropped, which is what URL does with it and is the
       same host either way. */
    expect(livekitTarget('/livekit/rtc', 'wss://media.example:443'))
      .toBe('wss://media.example/rtc')
    expect(livekitTarget('/livekit/rtc', 'wss://media.example:7443'))
      .toBe('wss://media.example:7443/rtc')
  })
})

describe('an attempt to point it somewhere else', () => {
  it('cannot make the host into userinfo', () => {
    /* The bug, exactly as it was. */
    expect(livekitTarget('/livekit@evil.example/x', BASE)).toBe(null)
  })

  it('cannot reach another port on this machine', () => {
    expect(livekitTarget('/livekit@127.0.0.1:22/', BASE)).toBe(null)
  })

  it('cannot use a protocol-relative path to change host', () => {
    /* `//evil.example/x` resolves against any base to a different host - the
       same escape by a second door, which is why the slashes are collapsed. */
    expect(livekitTarget('/livekit//evil.example/x', BASE))
      .toBe('ws://localhost:7880/evil.example/x')
    expect(livekitTarget('/livekit///evil.example/', BASE))
      .toBe('ws://localhost:7880/evil.example/')
  })

  it('and a name that merely starts with the prefix is not this proxy', () => {
    expect(livekitTarget('/livekitfoo/x', BASE)).toBe(null)
    expect(livekitTarget('/livekit.evil.example/x', BASE)).toBe(null)
  })

  it('nor is any other path', () => {
    expect(livekitTarget('/gateway', BASE)).toBe(null)
    expect(livekitTarget('/', BASE)).toBe(null)
    expect(livekitTarget('', BASE)).toBe(null)
  })

  it('and traversal cannot leave the configured host', () => {
    const target = livekitTarget('/livekit/../../x', BASE)
    expect(target).not.toBe(null)
    expect(new URL(target!).host).toBe('localhost:7880')
  })
})

describe('whatever arrives', () => {
  it('the host is always the configured one, or nothing at all', () => {
    const tries = [
      '/livekit/rtc', '/livekit', '/livekit@a.example/', '/livekit//a.example/',
      '/livekit/../x', '/livekit/%2e%2e/x', '/livekit/\\a.example/x',
      '/livekit:9999/x', '/livekit#@a.example/', '/livekit?a=@a.example',
    ]
    for (const t of tries) {
      const got = livekitTarget(t, BASE)
      if (got === null) continue
      expect(new URL(got).host, `${t} escaped to another host`).toBe('localhost:7880')
    }
  })

  it('and a configuration that is not an address yields nothing', () => {
    expect(livekitTarget('/livekit/rtc', 'not a url')).toBe(null)
    expect(livekitTarget('/livekit/rtc', '')).toBe(null)
  })
})
