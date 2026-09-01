import { describe, expect, it, vi } from 'vitest'
import { Gateway, type WebSocketLike } from './gateway'

/**
 * What happens when nothing answers.
 *
 * Reported as wanting the banner to say which try it is on and then offer a
 * button, rather than a spinner that turns for ever. Retrying without end and
 * being stuck look identical from the outside, and the app has to be able to
 * tell somebody which it is.
 */

/** A socket that never opens, and closes the moment it is asked to. */
function deadSocket(): { made: number; sockets: WebSocketLike[] } {
  const out = { made: 0, sockets: [] as WebSocketLike[] }
  return out
}

describe('a server that does not answer', () => {
  it('tries three times and then stops, saying so', async () => {
    vi.useFakeTimers()
    const seen: Array<[string, number]> = []
    const made = deadSocket()
    const g = new Gateway({
      url: 'wss://nowhere/gateway',
      backoff: () => 10,
      make: () => {
        made.made++
        const s = { send: () => {}, close: () => {} } as unknown as WebSocketLike
        made.sockets.push(s)
        /* Closed on the next tick, the way an unreachable server behaves. */
        setTimeout(() => s.onclose?.(new CloseEvent("close")), 0)
        return s
      },
    })
    g.onState((s, n) => seen.push([s, n]))
    g.open('a-token')

    await vi.advanceTimersByTimeAsync(500)

    expect(made.made, 'three goes and no more').toBe(3)
    expect(g.state, 'and then it says it cannot').toBe('offline')
    /* The count reaches the page: without it the banner cannot say which try
       this is, which is the whole of what somebody waiting learns. */
    expect(seen.some(([s, n]) => s === 'reconnecting' && n === 1)).toBe(true)
    expect(seen.some(([s, n]) => s === 'reconnecting' && n === 2)).toBe(true)
    vi.useRealTimers()
  })

  it('and goes again when somebody asks, from the beginning', async () => {
    vi.useFakeTimers()
    let made = 0
    const g = new Gateway({
      url: 'wss://nowhere/gateway',
      backoff: () => 10,
      make: () => {
        made++
        const s = { send: () => {}, close: () => {} } as unknown as WebSocketLike
        setTimeout(() => s.onclose?.(new CloseEvent("close")), 0)
        return s
      },
    })
    g.open('a-token')
    await vi.advanceTimersByTimeAsync(500)
    expect(made).toBe(3)

    g.retry()
    await vi.advanceTimersByTimeAsync(500)
    /* Three more, not a fourth: asking again is a fresh set of tries. */
    expect(made, 'a fresh three').toBe(6)
    expect(g.state).toBe('offline')
    vi.useRealTimers()
  })

  it('and a connection that opens resets the count', async () => {
    vi.useFakeTimers()
    let made = 0
    let live: WebSocketLike | undefined
    const g = new Gateway({
      url: 'wss://nowhere/gateway',
      backoff: () => 10,
      make: () => {
        made++
        const s = { send: () => {}, close: () => {} } as unknown as WebSocketLike
        live = s
        /* The first two fail; the third opens. */
        if (made < 3) setTimeout(() => s.onclose?.(new CloseEvent("close")), 0)
        else setTimeout(() => s.onopen?.(new Event('open')), 0)
        return s
      },
    })
    g.open('a-token')
    await vi.advanceTimersByTimeAsync(500)
    expect(g.state, 'open on the third').toBe('open')
    expect(g.tries, 'and counting from nothing again').toBe(0)

    /*
     * And a later drop starts counting again from nothing rather than from
     * where the last set of failures left off - otherwise a connection that
     * had a bad minute once would give up instantly the next time.
     */
    live?.onclose?.(new CloseEvent('close'))
    await vi.advanceTimersByTimeAsync(500)
    expect(made, 'it went again').toBe(4)
    expect(g.state, 'and got back in').toBe('open')
    expect(g.tries, 'with a clean slate').toBe(0)
    vi.useRealTimers()
  })
})
