import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { offersFirst } from './dmcall'

/**
 * A call straight between two people.
 *
 * Driven against a stand-in for RTCPeerConnection that enforces the rule the
 * screen share was caught by: a candidate offered before a remote description
 * is an error, not a no-op. That rule is why a connection could sit at "live"
 * carrying nothing.
 *
 * The other half of what is tested here does not exist in the screen share at
 * all. A screen has a host and a viewer, so who offers is obvious. A call is
 * symmetrical - both sides want to send, both start at the same moment - and
 * two simultaneous offers is the failure every symmetrical connection has.
 */


let live: FakePC[] = []

class FakeTrack {
  kind: string
  enabled = true
  constructor(kind: 'audio' | 'video') { this.kind = kind }
  stop() {}
}

class FakeStream {
  private tracks: FakeTrack[]
  constructor(tracks: FakeTrack[] = []) { this.tracks = [...tracks] }
  getTracks() { return [...this.tracks] }
  addTrack(t: FakeTrack) { this.tracks.push(t) }
}

class FakeSender {
  track: FakeTrack | null
  replaced: Array<FakeTrack | null> = []
  constructor(track: FakeTrack | null) { this.track = track }
  async replaceTrack(t: FakeTrack | null) { this.track = t; this.replaced.push(t) }
}

class FakePC {
  localDescription: unknown = null
  remoteDescription: unknown = null
  signalingState = 'stable'
  connectionState = 'new'
  config: RTCConfiguration
  accepted: unknown[] = []
  senders: FakeSender[] = []
  closed = false
  offersMade = 0
  private handlers = new Map<string, Array<(e: unknown) => void>>()

  constructor(config: RTCConfiguration = {}) {
    this.config = config
    live.push(this)
  }

  addEventListener(name: string, fn: (e: unknown) => void) {
    const list = this.handlers.get(name) ?? []
    list.push(fn)
    this.handlers.set(name, list)
  }

  /** Make the connection do something, the way the browser would. */
  fire(name: string, event: unknown = {}) {
    for (const fn of this.handlers.get(name) ?? []) fn(event)
  }

  addTrack(track: FakeTrack) {
    const s = new FakeSender(track)
    this.senders.push(s)
    return s as unknown as RTCRtpSender
  }

  /* Each one distinct, the way a real offer is: createOffer mints fresh ICE
     credentials every time, and an answer only fits the offer it answers. */
  async createOffer() { this.offersMade++; return { type: 'offer', sdp: `OFFER-${this.offersMade}` } }
  async createAnswer() { return { type: 'answer', sdp: 'ANSWER' } }
  async setLocalDescription(d: { type: string }) {
    this.localDescription = d
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
  }
  async setRemoteDescription(d: { type: string }) {
    this.remoteDescription = d
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
  }
  async addIceCandidate(c: unknown) {
    // The real thing rejects this, which is how candidates went missing.
    if (!this.remoteDescription) throw new Error('remote description not set')
    this.accepted.push(c)
  }
  close() { this.closed = true }
}

beforeEach(() => {
  live = []
  vi.stubGlobal('RTCPeerConnection', FakePC as unknown as typeof RTCPeerConnection)
  vi.stubGlobal('MediaStream', FakeStream)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const load = async () => {
  vi.resetModules()
  const { DmCall } = await import('./dmcall')
  return new DmCall()
}
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const mic = () => new FakeTrack('audio') as unknown as MediaStreamTrack
const STUN = [{ urls: ['stun:example:3478'] }]
const WITH_RELAY = [{ urls: ['stun:example:3478'] }, { urls: ['turn:example:3478'] }]

describe('who speaks first', () => {
  /*
   * Both sides join at the same moment and both want to send. Without a rule
   * they offer simultaneously and each rejects the other's for arriving in
   * the wrong state - so exactly one of any pair has to be the one to start.
   */
  it('is settled by the two ids, the same way on both machines', () => {
    expect(offersFirst('aaa', 'bbb')).toBe(true)
    expect(offersFirst('bbb', 'aaa')).toBe(false)
  })

  it('and never both', () => {
    expect(offersFirst('aaa', 'bbb')).not.toBe(offersFirst('bbb', 'aaa'))
  })

  it('the lower id offers and the higher one waits', async () => {
    const lower = await load()
    const sent: Array<{ to: string; data: any }> = []
    lower.useSignal((to, data) => sent.push({ to, data }))
    await lower.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await settle()
    expect(sent.map((m) => m.data.kind)).toContain('offer')

    const higher = await load()
    const theirs: Array<{ to: string; data: any }> = []
    higher.useSignal((to, data) => theirs.push({ to, data }))
    await higher.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await settle()
    expect(theirs.some((m) => m.data.kind === 'offer')).toBe(false)
  })
})

describe('making the connection', () => {
  it('answers an offer that arrives', async () => {
    const call = await load()
    const sent: Array<{ to: string; data: any }> = []
    call.useSignal((to, data) => sent.push({ to, data }))
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('aaa', { for: 'call', kind: 'offer', sdp: { type: 'offer' } as any })
    await settle()
    expect(sent.some((m) => m.data.kind === 'answer')).toBe(true)
  })

  /*
   * The failure the screen share was caught by, in the other module. A
   * candidate before a remote description is an error, so holding them is
   * the difference between a call and a connection that never carries
   * anything.
   */
  it('keeps candidates that arrive before there is anywhere to put them', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('aaa', { for: 'call', kind: 'ice', candidate: { candidate: 'early-1' } as any })
    await call.handle('aaa', { for: 'call', kind: 'ice', candidate: { candidate: 'early-2' } as any })
    await call.handle('aaa', { for: 'call', kind: 'offer', sdp: { type: 'offer' } as any })
    await settle()
    expect(live[0]!.accepted.map((c: any) => c.candidate)).toEqual(['early-1', 'early-2'])
  })

  it('and still takes the ones that arrive afterwards', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('aaa', { for: 'call', kind: 'offer', sdp: { type: 'offer' } as any })
    await call.handle('aaa', { for: 'call', kind: 'ice', candidate: { candidate: 'late' } as any })
    await settle()
    expect(live[0]!.accepted.map((c: any) => c.candidate)).toContain('late')
  })

  it('says so once media is flowing', async () => {
    const call = await load()
    const states: any[] = []
    call.useSignal(() => {})
    call.onStateChange((s) => states.push({ ...s }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    live[0]!.connectionState = 'connected'
    live[0]!.fire('connectionstatechange')
    expect(call.isConnected).toBe(true)
    expect(states.at(-1).failed).toBe(null)
  })

  /*
   * The whole point of reporting failure rather than throwing: the caller
   * falls back to the call server, so a pair who cannot reach each other
   * still get a call rather than an error.
   */
  it('gives up after a while so the caller can fall back', async () => {
    vi.useFakeTimers()
    const call = await load()
    const states: any[] = []
    call.useSignal(() => {})
    call.onStateChange((s) => states.push({ ...s }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await vi.advanceTimersByTimeAsync(9000)
    expect(states.at(-1).failed).toBeTruthy()
    expect(call.isConnected).toBe(false)
  })

  it('but not once it has connected', async () => {
    vi.useFakeTimers()
    const call = await load()
    const states: any[] = []
    call.useSignal(() => {})
    call.onStateChange((s) => states.push({ ...s }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    live[0]!.connectionState = 'connected'
    live[0]!.fire('connectionstatechange')
    await vi.advanceTimersByTimeAsync(9000)
    expect(states.at(-1).failed).toBe(null)
  })

  /*
   * Disconnected is usually a few lost packets and comes back on its own.
   * Ending a call for one would end far more calls than it saved.
   */
  it('does not end a call for a momentary drop', async () => {
    const call = await load()
    call.useSignal(() => {})
    const states: any[] = []
    call.onStateChange((s) => states.push({ ...s }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    live[0]!.connectionState = 'connected'
    live[0]!.fire('connectionstatechange')
    live[0]!.connectionState = 'disconnected'
    live[0]!.fire('connectionstatechange')
    expect(states.at(-1).failed).toBe(null)
  })

  it('and does end one that really failed', async () => {
    const call = await load()
    call.useSignal(() => {})
    const states: any[] = []
    call.onStateChange((s) => states.push({ ...s }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    live[0]!.connectionState = 'failed'
    live[0]!.fire('connectionstatechange')
    expect(states.at(-1).failed).toBeTruthy()
  })
})

describe('an offer nobody was there to hear', () => {
  /*
   * Both sides arrive within a moment of each other but not at the same
   * instant, and the relay will not carry an offer to somebody it does not
   * yet believe is in the call - so the first one can simply be dropped.
   * Without asking again, that call waits out the whole timeout and falls
   * back to the call server for no reason at all.
   */
  it('is made again a moment later', async () => {
    vi.useFakeTimers()
    const call = await load()
    const sent: Array<{ data: any }> = []
    call.useSignal((_to, data) => sent.push({ data }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    expect(sent.filter((m) => m.data.kind === 'offer').length).toBe(1)
    await vi.advanceTimersByTimeAsync(1500)
    expect(sent.filter((m) => m.data.kind === 'offer').length).toBe(2)
  })

  it('and stops once somebody answers', async () => {
    vi.useFakeTimers()
    const call = await load()
    const sent: Array<{ data: any }> = []
    call.useSignal((_to, data) => sent.push({ data }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await call.handle('zzz', { for: 'call', kind: 'answer', sdp: { type: 'answer' } as any })
    const after = sent.filter((m) => m.data.kind === 'offer').length
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent.filter((m) => m.data.kind === 'offer').length).toBe(after)
  })

  it('and does not go on for ever', async () => {
    vi.useFakeTimers()
    const call = await load()
    const sent: Array<{ data: any }> = []
    call.useSignal((_to, data) => sent.push({ data }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sent.filter((m) => m.data.kind === 'offer').length).toBeLessThanOrEqual(4)
  })
})

describe('an answer that was slow rather than lost', () => {
  /*
   * The retry used to make a brand new offer, which mints new ICE
   * credentials. An answer to the first one then arrives carrying
   * credentials the connection has stopped using, and the answer that does
   * match is dropped for arriving in the wrong state - so a slow link ends a
   * call the retry was there to save.
   */
  it('is still answering the offer that was made', async () => {
    vi.useFakeTimers()
    const call = await load()
    const sent: Array<{ data: any }> = []
    call.useSignal((_to, data) => sent.push({ data }))
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await vi.advanceTimersByTimeAsync(1500)
    const offers = sent.filter((m) => m.data.kind === 'offer')
    expect(offers.length).toBe(2)
    expect(offers[1]!.data.sdp).toEqual(offers[0]!.data.sdp)
  })
})

describe('what it refuses to act on', () => {
  it('ignores a signal from somebody else entirely', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('somebody-else', { for: 'call', kind: 'offer', sdp: { type: 'offer' } as any })
    await settle()
    expect(live[0]!.remoteDescription).toBe(null)
  })

  it('ignores anything that is not for a call', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('aaa', { kind: 'offer', sdp: { type: 'offer' } } as any)
    await settle()
    expect(live[0]!.remoteDescription).toBe(null)
  })

  /*
   * An answer to an offer that was never made would throw inside
   * setRemoteDescription, which reads as the call failing.
   */
  it('ignores an answer when it never offered', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'zzz', peer: 'aaa', audio: mic(), ice: STUN })
    await call.handle('aaa', { for: 'call', kind: 'answer', sdp: { type: 'answer' } as any })
    await settle()
    expect(live[0]!.remoteDescription).toBe(null)
  })

  it('hangs up when told', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await call.handle('zzz', { for: 'call', kind: 'bye' })
    expect(live[0]!.closed).toBe(true)
  })
})

describe('the camera, on a call already running', () => {
  /*
   * Through a sender that is kept: replaceTrack does not need the two sides
   * to renegotiate, so turning a camera off does not interrupt the audio
   * going the other way.
   */
  it('needs saying once, and never again', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    const offersAfterAudio = live[0]!.offersMade

    await call.setCamera(new FakeTrack('video') as unknown as MediaStreamTrack)
    expect(live[0]!.offersMade).toBe(offersAfterAudio + 1)

    // Off and on again rides the sender that already exists.
    await call.setCamera(null)
    await call.setCamera(new FakeTrack('video') as unknown as MediaStreamTrack)
    expect(live[0]!.offersMade).toBe(offersAfterAudio + 1)
  })

  /*
   * From either side, which is the half that was missing.
   *
   * Who offers first settles a race at the start of a call. Turning a camera
   * on mid-call is not that race, and deferring to the rule anyway meant the
   * side whose id sorted second added the track locally and told nobody: an
   * offer describes the transceivers of whoever makes it, and an answer
   * cannot introduce one. Half of all pairs, one direction, silently blank.
   *
   * Both directions are driven here, because the version that only tested
   * the offering side passed on a call where the camera never arrived.
   */
  it('is negotiated by whichever side turned it on', async () => {
    for (const [me, peer] of [['aaa', 'zzz'], ['zzz', 'aaa']]) {
      const call = await load()
      const sent: Array<{ kind: string }> = []
      call.useSignal((_to, d) => sent.push(d as { kind: string }))
      await call.start({ me: me!, peer: peer!, audio: mic(), ice: STUN })
      // Settled, the way a call is by the time somebody presses the button.
      if (offersFirst(me!, peer!)) {
        await call.handle(peer!, { for: 'call', kind: 'answer', sdp: { type: 'answer' } as never })
      } else {
        await call.handle(peer!, { for: 'call', kind: 'offer', sdp: { type: 'offer' } as never })
      }
      sent.length = 0
      await call.setCamera(new FakeTrack('video') as unknown as MediaStreamTrack)
      await settle()
      expect(sent.filter((d) => d.kind === 'offer').length,
        `${me} calling ${peer}`).toBe(1)
    }
  })

  it('turning it off leaves the audio alone', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN })
    await call.setCamera(new FakeTrack('video') as unknown as MediaStreamTrack)
    await call.setCamera(null)
    const audio = live[0]!.senders[0]!
    expect(audio.track).not.toBe(null)
    expect(live[0]!.closed).toBe(false)
  })
})

describe('not showing an address to somebody who asked not to', () => {
  it('goes through the relay when hiding is on and there is one', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: WITH_RELAY, hideIp: true })
    expect(live[0]!.config.iceTransportPolicy).toBe('relay')
  })

  /*
   * Forcing a relay that does not exist leaves the connection with no
   * candidates at all, which fails as a call that never starts rather than
   * as anything a person could diagnose.
   */
  it('does not force one that is not there', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: STUN, hideIp: true })
    expect(live[0]!.config.iceTransportPolicy).toBeUndefined()
  })

  it('and leaves it direct when hiding is off', async () => {
    const call = await load()
    call.useSignal(() => {})
    await call.start({ me: 'aaa', peer: 'zzz', audio: mic(), ice: WITH_RELAY })
    expect(live[0]!.config.iceTransportPolicy).toBeUndefined()
  })
})
