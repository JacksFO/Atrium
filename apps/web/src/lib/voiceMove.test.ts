import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Taking a share into another room.
 *
 * Moving between voice channels is a leave and a join, and a leave takes the
 * capture down with it — so changing channel while sharing stopped the share
 * and asked for the picker again. The original build never had this problem:
 * it held the track itself and pointed each new connection at it, so a move
 * was invisible to whatever was being shared.
 *
 * The whole thing turns on one argument. Unpublishing normally ENDS the
 * track, which is the browser taking its "you are sharing" bar down; passing
 * false keeps the capture alive so there is something to publish again.
 */

const Source = {
  ScreenShare: 'screen_share',
  ScreenShareAudio: 'screen_share_audio',
  Camera: 'camera',
  Microphone: 'microphone',
} as const

/** A local track as LiveKit hands it over: a wrapper round a real one. */
function localTrack(id: string) {
  return { mediaStreamTrack: { id, readyState: 'live' } as unknown as MediaStreamTrack }
}

type Pub = { track: ReturnType<typeof localTrack> | null; isMuted: boolean }

const rooms: FakeRoom[] = []

class FakeRoom {
  published: Array<{ track: MediaStreamTrack; source: string }> = []
  unpublished: Array<{ track: unknown; stop: boolean }> = []
  connected = false
  pubs = new Map<string, Pub>()
  remoteParticipants = new Map()

  localParticipant = {
    identity: 'me',
    getTrackPublication: (s: string) => this.pubs.get(s),
    unpublishTrack: async (track: unknown, stop: boolean) => {
      this.unpublished.push({ track, stop })
      for (const [k, v] of this.pubs) if (v.track === track) this.pubs.delete(k)
    },
    publishTrack: async (track: MediaStreamTrack, opts: { source: string }) => {
      this.published.push({ track, source: opts.source })
      const pub: Pub = { track: { mediaStreamTrack: track }, isMuted: false }
      this.pubs.set(opts.source, pub)
      return { track: { mute: async () => { pub.isMuted = true } } }
    },
    setMicrophoneEnabled: async () => {},
  }

  constructor() { rooms.push(this) }
  on() { return this }
  async connect() { this.connected = true }
  async disconnect() { this.connected = false }
}

vi.mock('livekit-client', () => ({
  Room: FakeRoom,
  RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  Track: { Source },
  AudioPresets: { speech: {} },
}))

const server = {
  post: async () => ({ token: 't', url: 'wss://x' }),
} as never

const handlers = {
  stream: () => {}, roster: () => {}, speaking: () => {}, dropped: () => {},
  quality: () => {},
}

let Voice: typeof import('./voice').Voice

beforeEach(async () => {
  rooms.length = 0
  ;({ Voice } = await import('./voice'))
})

const mic = { deviceId: '', echoCancellation: true, noiseSuppression: true, autoGainControl: true }

describe('moving channel while sharing', () => {
  it('joins a room at all', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    /* Or every assertion below is about nothing. */
    expect(rooms).toHaveLength(1)
    expect(rooms[0]?.connected).toBe(true)
  })

  it('carries the picture into the new room', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    const screen = localTrack('screen-1')
    rooms[0]?.pubs.set(Source.ScreenShare, { track: screen, isMuted: false })

    await v.leave({ keepShare: true })
    await v.join('c2', mic as never)

    expect(rooms).toHaveLength(2)
    const put = rooms[1]?.published.filter((p) => p.source === Source.ScreenShare)
    expect(put).toHaveLength(1)
    /* The very same capture, not a new one — a new one is the picker again. */
    expect(put?.[0]?.track).toBe(screen.mediaStreamTrack)
  })

  /* The argument the whole thing turns on. */
  it('and does not stop the capture on the way out', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    rooms[0]?.pubs.set(Source.ScreenShare, { track: localTrack('s'), isMuted: false })

    await v.leave({ keepShare: true })
    expect(rooms[0]?.unpublished).toHaveLength(1)
    expect(rooms[0]?.unpublished[0]?.stop).toBe(false)
  })

  it('and brings the sound with it', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    rooms[0]?.pubs.set(Source.ScreenShare, { track: localTrack('s'), isMuted: false })
    rooms[0]?.pubs.set(Source.ScreenShareAudio, { track: localTrack('a'), isMuted: false })

    await v.leave({ keepShare: true })
    await v.join('c2', mic as never)
    expect(rooms[1]?.published.map((p) => p.source))
      .toEqual([Source.ScreenShare, Source.ScreenShareAudio])
  })

  /* Sound that was off stays off: it should not come back loud in a room
     somebody has just walked into. */
  it('and sound that was muted arrives muted', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    rooms[0]?.pubs.set(Source.ScreenShare, { track: localTrack('s'), isMuted: false })
    rooms[0]?.pubs.set(Source.ScreenShareAudio, { track: localTrack('a'), isMuted: true })

    await v.leave({ keepShare: true })
    await v.join('c2', mic as never)
    expect(rooms[1]?.pubs.get(Source.ScreenShareAudio)?.isMuted).toBe(true)
  })

  /* An ordinary leave is an ordinary leave. */
  it('but leaving for good ends the share', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    rooms[0]?.pubs.set(Source.ScreenShare, { track: localTrack('s'), isMuted: false })

    await v.leave()
    await v.join('c2', mic as never)
    expect(rooms[1]?.published).toHaveLength(0)
  })

  /* Stopped from the browser's own bar mid-move, which nothing here is told
     about. Publishing an ended track draws a black rectangle. */
  it('and a capture stopped mid-move is not put back', async () => {
    const v = new Voice(server, handlers)
    await v.join('c1', mic as never)
    const dead = localTrack('s')
    ;(dead.mediaStreamTrack as { readyState: string }).readyState = 'ended'
    rooms[0]?.pubs.set(Source.ScreenShare, { track: dead, isMuted: false })

    await v.leave({ keepShare: true })
    await v.join('c2', mic as never)
    expect(rooms[1]?.published).toHaveLength(0)
  })
})

/**
 * Changing the quality of a share that is running.
 *
 * The capture stays exactly as it is; what moves is the ceiling it is encoded
 * to. Restarting the track instead re-acquires it — and re-acquiring a screen
 * means asking the operating system for a screen again, which does not happen
 * silently: the old track ended, no new one arrived, and the share went black.
 */
describe('changing quality mid-share', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/voice.ts'), 'utf8')
  const at = src.indexOf('async setShareQuality')
  /* Code only, so the note explaining a mistake is not mistaken for the
     mistake itself. */
  const body = src.slice(at, src.indexOf('\n  }', at))
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('never re-acquires the capture', () => {
    expect(at).toBeGreaterThan(0)
    expect(body).not.toContain('restartTrack')
  })

  it('and constrains the one already running instead', () => {
    expect(body).toContain('applyConstraints')
  })

  /* The ceiling and what to give up first are the parts that actually change
     what goes out, and they do not touch the capture at all. */
  it('and moves the ceiling, which is most of what a preset is', () => {
    expect(body).toContain('tellEncoder')
    const encoder = src.slice(src.indexOf('private tellEncoder'))
    expect(encoder).toContain('degradationPreference')
    expect(encoder).toContain('maxBitrate')
  })
})

/**
 * What a share is published with.
 *
 * Two layers, chosen per viewer by the size of the window they are watching
 * in — one extra at half resolution, which is what LiveKit does for a screen
 * share by default and what the build before this one had. Nothing here sets
 * the layers, and that is the point: the defaults are the wanted behaviour,
 * and a test that says so stops somebody "fixing" it by turning simulcast on
 * explicitly and getting it wrong.
 */
describe('how a screen goes out', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/lib/voice.ts'), 'utf8')

  it('lets each viewer be sent the layer that fits their window', () => {
    expect(src).toMatch(/adaptiveStream: true/)
  })

  /* And stops encoding a layer nobody is subscribed to, which is what makes
     the second one free when everybody happens to be watching full size. */
  it('and stops encoding what nobody has asked for', () => {
    expect(src).toMatch(/dynacast: true/)
  })

  /* Nothing streams until somebody asks. Without this the two above would be
     a curtain over a stream still being sent. */
  it('and sends nothing at all until somebody asks', () => {
    expect(src).toContain('autoSubscribe: false')
  })

  it('and carries voices through packet loss', () => {
    expect(src).toMatch(/red: true/)
  })
})
