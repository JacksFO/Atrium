import { describe, expect, it, vi } from 'vitest'
import { Gateway, type WebSocketLike } from './gateway'
import type { ServerEvent } from './wire'

/** A socket a test can drive: it records what was sent and lets the test
 *  deliver frames and hang up whenever it likes. */
function socket() {
  const sent: string[] = []
  let closed = false
  const s: WebSocketLike = {
    readyState: 1,
    send: (d) => { sent.push(d) },
    close: () => { closed = true },
    onopen: null, onmessage: null, onclose: null, onerror: null,
  }
  return {
    s, sent,
    get closed() { return closed },
    open: () => s.onopen?.({}),
    deliver: (e: unknown) => s.onmessage?.({ data: JSON.stringify(e) }),
    raw: (d: string) => s.onmessage?.({ data: d }),
    hangUp: () => s.onclose?.({}),
  }
}

/* Not spread at the call sites: spreading an object copies what a getter
   returns at that moment, which for `socket` is null before anything has
   connected. */
const gateway = (make: () => ReturnType<typeof socket>) => {
  let last: ReturnType<typeof socket> | null = null
  const g = new Gateway({
    url: 'wss://x/gateway',
    make: () => { last = make(); return last.s },
    backoff: () => 1,
  })
  return { g, socket: () => last! }
}

describe('signing in to the socket', () => {
  it('says hello with the token once it is open', () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    expect(JSON.parse(sock().sent[0]!)).toEqual({ t: 'hello', token: 'tok' })
  })

  it('reports what it is doing, so the app can say so', () => {
    const seen: string[] = []
    const { g, socket: sock } = gateway(socket)
    g.onState((s) => seen.push(s))
    g.open('tok')
    sock().open()
    expect(seen).toEqual(['connecting', 'open'])
  })
})

describe('the heartbeat', () => {
  /* A socket can die without either end closing it — a laptop that went to
     sleep has one that is gone whatever readyState says. The server hangs up
     on anybody who does not answer. */
  it('answers a ping', () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    sock().deliver({ t: 'ping' })
    expect(JSON.parse(sock().sent[1]!)).toEqual({ t: 'pong' })
  })

  it('and never hands one on, because nothing above cares', () => {
    const seen: ServerEvent[] = []
    const { g, socket: sock } = gateway(socket)
    g.on((e) => seen.push(e))
    g.open('tok')
    sock().open()
    sock().deliver({ t: 'ping' })
    expect(seen).toHaveLength(0)
  })
})

describe('events arriving before anybody is listening', () => {
  /* The client asks for a bootstrap and then subscribes, so the frame that
     opens the connection lands in the gap. Dropping it is how a first screen
     ends up stale with nothing to explain it. */
  it('are kept and delivered when somebody does listen', () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    sock().deliver({ t: 'presence', userId: 'a', online: true })
    sock().deliver({ t: 'presence', userId: 'b', online: true })

    const seen: ServerEvent[] = []
    g.on((e) => seen.push(e))
    expect(seen).toHaveLength(2)
    expect(seen.map((e) => (e.t === 'presence' ? e.userId : ''))).toEqual(['a', 'b'])
  })

  it('and are delivered once, not again to the next listener', () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    sock().deliver({ t: 'presence', userId: 'a', online: true })
    g.on(() => {})
    const second: ServerEvent[] = []
    g.on((e) => second.push(e))
    expect(second).toHaveLength(0)
  })
})

describe('when the connection goes', () => {
  it('tries again, and says it is trying', async () => {
    const seen: string[] = []
    const { g, socket: sock } = gateway(socket)
    g.onState((s) => seen.push(s))
    g.open('tok')
    sock().open()
    sock().hangUp()
    expect(seen).toContain('reconnecting')
    await new Promise((r) => setTimeout(r, 10))
    sock().open()
    expect(g.state).toBe('open')
  })

  it('stops trying once it has been closed on purpose', async () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    const before = sock()
    g.close()
    before.hangUp()
    await new Promise((r) => setTimeout(r, 10))
    expect(g.state).toBe('offline')
  })
})

describe('what is sent', () => {
  /* Everything sent this way is about right now — that somebody is typing,
     that a message was read. One delivered when the connection comes back is
     worse than none. */
  it('is dropped rather than queued while the socket is away', () => {
    const { g, socket: sock } = gateway(socket)
    g.open('tok')
    sock().open()
    sock().hangUp()
    g.send({ t: 'typing', channelId: 'c' })
    expect(sock().sent.filter((s) => s.includes('typing'))).toHaveLength(0)
  })
})

describe('rubbish on the wire', () => {
  it('is ignored rather than thrown at whatever is listening', () => {
    const onEvent = vi.fn()
    const { g, socket: sock } = gateway(socket)
    g.on(onEvent)
    g.open('tok')
    sock().open()
    sock().raw('not json at all')
    expect(onEvent).not.toHaveBeenCalled()
  })
})
