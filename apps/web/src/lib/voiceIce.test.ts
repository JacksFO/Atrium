import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The relay reaching the thing that carries the call.
 *
 * The server mints short-lived TURN credentials and has done all along. The
 * client this replaces asked for them from its own peer-to-peer paths; those
 * paths are gone, everything goes through the SFU now, and nothing inherited
 * the call. So the relay was configured, working, paid for, and reaching
 * nobody - and the people who needed it got a call with no audio, which reads
 * as the app being broken rather than as a network it could not cross.
 *
 * Read from the source because the alternative is a browser: what is being
 * checked is that the fetched servers are handed to the room, and the room is
 * livekit's. A test that stubbed livekit would be asserting its own stub.
 */
const src = readFileSync(resolve(process.cwd(), 'src/lib/voice.ts'), 'utf8')

describe('joining a call', () => {
  it('asks this server for somewhere to bounce off', () => {
    expect(src).toContain("'/api/rtc/ice'")
  })

  it('and hands what it gets to the room', () => {
    /* Fetching them and not passing them on is the same as not asking. */
    const at = src.indexOf('new lk.Room({')
    expect(at).toBeGreaterThan(0)
    const options = src.slice(at, at + 400)
    expect(options).toMatch(/rtcConfig:\s*\{\s*iceServers/)
  })

  it('and joins anyway when there are none to be had', () => {
    /* A relay is what makes a hard network work. Having none is how it
       worked a moment ago, so it must never be a reason to refuse. */
    const at = src.indexOf('private async iceServers')
    expect(at).toBeGreaterThan(0)
    const body = src.slice(at, src.indexOf('\n  }', at))
    expect(body).toContain('catch')
    expect(body).toMatch(/return \[\]/)
  })
})
