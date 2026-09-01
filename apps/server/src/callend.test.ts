import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A call ending, by every way somebody can leave one.
 *
 * "Join call" on a call nobody is in is worse than no button: it offers a
 * room that is not there, to two people who both know they are not in it.
 *
 * The row ends when the last person leaves, and there are more ways to leave
 * than the obvious one. Each of these was a path that dropped somebody from
 * the room and never asked whether that had emptied it.
 */

const gw = readFileSync(resolve(process.cwd(), 'src/gateway.ts'), 'utf8')

/** One case of the frame switch, from its label to the next. */
function branch(label: string): string {
  const at = gw.indexOf(`case '${label}': {`)
  if (at < 0) return ''
  const next = gw.indexOf('\n        case ', at + 10)
  return gw.slice(at, next < 0 ? at + 4000 : next)
}

describe('when a call is over', () => {
  it('is decided in one place', () => {
    /* Or the assertions below are about a function that no longer exists. */
    expect(gw).toContain('function callMayBeOver(')
    expect(gw).toContain('const CALL_LINGER_MS = 2 * 60_000')
  })

  /* An empty room ends it at once. One person left starts the two minutes,
     because dropping out, closing a lid and walking off all look the same. */
  it('and an empty room ends it immediately', () => {
    const fn = gw.slice(gw.indexOf('function callMayBeOver('))
    expect(fn.slice(0, 400)).toContain('if (left === 0)')
    expect(fn.slice(0, 400)).toContain('endCallRow(channelId)')
  })

  /* The ordinary way out. */
  it('and leaving asks', () => {
    expect(branch('voice-leave')).toContain('callMayBeOver(')
  })

  /*
   * The reconnect window. Somebody muted server-side reconnects, and a leave
   * arriving inside that window is decided once the window closes - that
   * branch dropped them from the room and never asked about the call, so a
   * call ended this way never ended at all.
   */
  it('and so does a leave that arrives during a reconnect', () => {
    const leave = branch('voice-leave')
    const deferred = leave.slice(leave.indexOf('setTimeout('), leave.indexOf('return\n          }'))
    expect(deferred, 'the deferred delete never asks about the call')
      .toContain('callMayBeOver(')
  })

  /*
   * And somebody who rang and hung up before anybody answered was never in
   * the room at all, so the ordinary check returned before reaching it. That
   * is exactly the call that most needs ending: nobody was ever in it.
   */
  it('and so does hanging up on a call nobody joined', () => {
    expect(gw).toContain('function liveCallRowChannelFor(')
    expect(branch('voice-leave')).toContain('liveCallRowChannelFor(')
  })

  /* Their own calls only. Somebody else leaving a conversation they were
     never in ends nothing. */
  it('and that only ends a call this person started', () => {
    const fn = gw.slice(gw.indexOf('function liveCallRowChannelFor('))
    expect(fn.slice(0, 700)).toContain('author_id = ?')
  })

  /* A closed tab is one of the things the two minutes are for. */
  it('and a socket closing asks too', () => {
    const close = gw.slice(gw.indexOf('A closed tab should not leave a ghost'))
    expect(close.slice(0, 500)).toContain('callMayBeOver(')
  })
})
