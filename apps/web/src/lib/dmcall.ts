/**
 * A call between two people, straight between them.
 *
 * A conversation has exactly two people in it, and nobody moderates it - so
 * there is nothing for a server in the middle to enforce and no reason for
 * the audio to travel through one. It goes direct, which is one hop instead
 * of two and takes our servers out of the path entirely.
 *
 * A server's voice channel is deliberately not this. There, mute and who may
 * speak are enforced in the token the call server issues - take the server
 * out and a mute becomes a request politely made to somebody else's client -
 * and a call of five would have every person uploading four copies of
 * themselves rather than one.
 *
 * The transport screen sharing already uses, in other words, for the case
 * where it is the right shape. What differs is that a screen has an obvious
 * host and an obvious viewer, and a call is symmetrical: both sides want to
 * send, and both may try to start at the same moment.
 */

/** Everything sent between the two sides. Opaque to the server relaying it. */
export type CallSignal =
  | { for: 'call'; kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { for: 'call'; kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { for: 'call'; kind: 'ice'; candidate: RTCIceCandidateInit }
  | { for: 'call'; kind: 'bye' }

export type SendCallSignal = (to: string, data: CallSignal) => void

export type CallState = {
  /** Whether media is actually flowing, as opposed to being negotiated. */
  connected: boolean
  /** Set when it has given up, so the caller can fall back to the server. */
  failed: string | null
}

/** How long to wait for a direct connection before giving up on one. */
export const CONNECT_TIMEOUT_MS = 8000

/**
 * How long to wait for an answer before asking again.
 *
 * Both sides arrive within a moment of each other but not at the same
 * instant, and the relay will not carry an offer to somebody it does not yet
 * believe is in the call. So the first offer can simply be dropped - not
 * refused, dropped - and without asking again that call waits out the whole
 * timeout and falls back to the call server for no reason at all.
 */
const REOFFER_MS = 1200
const MAX_OFFERS = 4

/**
 * Who speaks first.
 *
 * Both sides join at once and both want to send, so without a rule they
 * offer simultaneously and each rejects the other's offer for arriving in
 * the wrong state - the "glare" every symmetrical WebRTC connection has to
 * answer. Perfect negotiation solves it with rollback; comparing the two ids
 * solves it with one line and no rollback at all, and the ids are already
 * known to both sides before anything is sent.
 */
export function offersFirst(mine: string, theirs: string): boolean {
  return mine < theirs
}

export class DmCall {
  private pc: RTCPeerConnection | null = null
  private send: SendCallSignal = () => {}
  private peer: string | null = null
  private me = ''
  /** Candidates that arrived before there was anywhere to put them. */
  private early: RTCIceCandidateInit[] = []
  private local: MediaStream | null = null
  private onRemote: (stream: MediaStream) => void = () => {}
  private onState: (s: CallState) => void = () => {}
  private remote: MediaStream | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: CallState = { connected: false, failed: null }
  /** The senders we own, so a camera can be added and taken away again. */
  private senders = new Map<'audio' | 'video', RTCRtpSender>()

  useSignal(send: SendCallSignal): void {
    this.send = send
  }

  onRemoteStream(fn: (stream: MediaStream) => void): void {
    this.onRemote = fn
  }

  onStateChange(fn: (s: CallState) => void): void {
    this.onState = fn
  }

  get peerId(): string | null {
    return this.peer
  }

  get isConnected(): boolean {
    return this.state.connected
  }

  /** The live connection, for reading statistics off. */
  get connection(): RTCPeerConnection | null {
    return this.pc
  }

  private emit(next: Partial<CallState>): void {
    this.state = { ...this.state, ...next }
    this.onState(this.state)
  }

  /**
   * Begin, with the microphone already captured.
   *
   * The track is handed in rather than captured here: which microphone, and
   * what processing it has, is settled elsewhere and applies to both kinds of
   * call. This only has to carry it.
   */
  async start(opts: {
    me: string
    peer: string
    audio: MediaStreamTrack
    ice: RTCIceServer[]
    /*
     * Whether to insist on a relay rather than show an address.
     *
     * Passed in rather than read from storage the way it used to be: in this
     * client a setting is React state, and a module reaching sideways into
     * storage for one is how two answers to the same question start
     * disagreeing. The caller knows.
     */
    hideIp?: boolean
  }): Promise<void> {
    this.stop({ quiet: true })
    this.me = opts.me
    this.peer = opts.peer
    this.offers = 1
    this.state = { connected: false, failed: null }

    /*
     * Forced through a relay when somebody has asked not to show their
     * address, and only when there is a relay to force it through - without
     * one the connection is left with no candidates at all, which fails as a
     * call that never starts rather than as anything a person could
     * diagnose. The same rule screen sharing follows.
     */
    const relay = opts.ice.some((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls]
      return urls.some((u) => String(u).startsWith('turn:') || String(u).startsWith('turns:'))
    })
    const pc = new RTCPeerConnection({
      iceServers: opts.ice,
      ...(opts.hideIp && relay ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
    })
    this.pc = pc

    this.local = new MediaStream([opts.audio])
    this.senders.set('audio', pc.addTrack(opts.audio, this.local))

    pc.addEventListener('icecandidate', (ev) => {
      if (!ev.candidate || !this.peer) return
      this.send(this.peer, { for: 'call', kind: 'ice', candidate: ev.candidate.toJSON() })
    })

    pc.addEventListener('track', (ev) => {
      /*
       * Built here rather than taken from the event.
       *
       * Tracks are added one at a time and a camera arrives long after the
       * voice did, so the stream on the event is not reliably the same one
       * twice. One stream that gains tracks is what an element can be
       * pointed at once and left alone.
       */
      if (!this.remote) this.remote = new MediaStream()
      this.remote.addTrack(ev.track)
      this.onRemote(this.remote)
    })

    pc.addEventListener('connectionstatechange', () => {
      if (pc !== this.pc) return
      if (pc.connectionState === 'connected') {
        this.clearTimer()
        if (!this.state.connected) this.emit({ connected: true, failed: null })
      }
      /*
       * Failed is final; disconnected is not. A disconnected connection is
       * usually a few lost packets and comes back on its own, and tearing a
       * call down for one would end far more calls than it saved.
       */
      if (pc.connectionState === 'failed') {
        this.emit({ connected: false, failed: 'the direct connection dropped' })
      }
    })

    /*
     * The giving-up clock is started before the first offer, not after it.
     *
     * clearTimer cancels the asking-again clock as well, so starting them in
     * the other order cancelled the retry a moment after scheduling it - and
     * the retry is the whole answer to an offer arriving before the other
     * side is known to be there.
     */
    this.clearTimer()
    this.timer = setTimeout(() => {
      if (!this.state.connected) {
        this.emit({ failed: 'no direct connection could be made' })
      }
    }, CONNECT_TIMEOUT_MS)

    /*
     * Whoever the rule says goes first. The other side builds the same
     * connection and waits, so an offer has somewhere to land the moment it
     * arrives rather than being the thing that creates the connection.
     */
    if (offersFirst(this.me, this.peer)) await this.offer()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.chaser) clearTimeout(this.chaser)
    this.chaser = null
  }

  private async sendOffer(): Promise<void> {
    const pc = this.pc
    if (!pc || !this.peer) return
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.send(this.peer, { for: 'call', kind: 'offer', sdp: offer })
  }

  private async offer(): Promise<void> {
    await this.sendOffer()
    this.chase()
  }

  /**
   * Say what changed, once the connection is in a state to say it.
   *
   * Offering over an offer of our own is allowed and simply replaces it. An
   * offer we still owe an answer to is not: that one has to be answered
   * first, so this remembers there is something to say and says it the
   * moment the answer has gone out.
   */
  private async renegotiate(): Promise<void> {
    const pc = this.pc
    if (!pc || !this.peer || pc.signalingState === 'closed') return
    if (pc.signalingState === 'have-remote-offer') {
      this.pendingOffer = true
      return
    }
    this.pendingOffer = false
    await this.sendOffer()
  }

  /** Something to say, waiting for the connection to settle down. */
  private pendingOffer = false

  /**
   * Ask again if nobody answered.
   *
   * Only while there is still no remote description: an answer, or an offer
   * from the other side, ends it. Bounded, because an offer nobody is ever
   * going to answer should end as a fallback to the call server rather than
   * as a machine talking to itself.
   */
  private chase(): void {
    if (this.chaser) clearTimeout(this.chaser)
    if (this.offers >= MAX_OFFERS) return
    this.chaser = setTimeout(() => {
      const pc = this.pc
      if (!pc || pc.remoteDescription || this.state.connected || !this.peer) return
      this.offers++
      /*
       * The same offer again, not another one.
       *
       * Making a new one mints new ICE credentials, so an answer to the
       * first - slow rather than lost - is applied to the second, whose
       * credentials it does not carry. The right answer then arrives to a
       * connection that is no longer waiting for one and is dropped by the
       * guard on that path, and the call fails to the call server for a
       * reason that was entirely of its own making. Saying the same thing
       * twice is safe: both copies describe one offer.
       */
      const said = pc.localDescription as RTCSessionDescriptionInit | null
      if (said) this.send(this.peer, { for: 'call', kind: 'offer', sdp: said })
      else void this.sendOffer()
      this.chase()
    }, REOFFER_MS)
  }
  private chaser: ReturnType<typeof setTimeout> | null = null
  private offers = 1

  /**
   * Add or remove the camera on a call already running.
   *
   * Through a sender that is kept rather than a track that is added and
   * removed: replaceTrack does not need the two sides to renegotiate, so
   * turning a camera on and off does not interrupt the audio going the other
   * way. The transceiver is made once, the first time a camera is used.
   */
  async setCamera(track: MediaStreamTrack | null): Promise<void> {
    const pc = this.pc
    if (!pc) return
    const existing = this.senders.get('video')
    if (existing) {
      await existing.replaceTrack(track)
      return
    }
    if (!track) return
    this.senders.set('video', pc.addTrack(track, this.local ?? new MediaStream([track])))
    /*
     * A new track means a new transceiver, and that does need saying - by
     * whichever side turned the camera on.
     *
     * Who offers first settles a race at the start of a call, when both
     * sides open at once and both want to send. There is no such race here,
     * and deferring to that rule meant the camera of whoever's id happened
     * to sort second was added locally and never negotiated at all: an
     * offer describes the transceivers of the side that makes it, and an
     * answer cannot introduce one. Their picture simply never arrived, on
     * half of all pairs, in one direction.
     */
    await this.renegotiate()
  }

  /** What arrives from the other side, so the caller can attach or measure it. */
  get remoteStream(): MediaStream | null {
    return this.remote
  }

  async handle(from: string, data: CallSignal): Promise<void> {
    if (data?.for !== 'call') return
    if (this.peer && from !== this.peer) return
    const pc = this.pc
    if (!pc) return

    switch (data.kind) {
      case 'offer': {
        await pc.setRemoteDescription(data.sdp)
        await this.flushEarly()
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        this.send(from, { for: 'call', kind: 'answer', sdp: answer })
        if (this.pendingOffer) await this.renegotiate()
        return
      }
      case 'answer': {
        // An answer to an offer we did not send, or one already answered, is
        // not something to act on - setRemoteDescription would throw.
        if (pc.signalingState !== 'have-local-offer') return
        await pc.setRemoteDescription(data.sdp)
        await this.flushEarly()
        if (this.pendingOffer) await this.renegotiate()
        return
      }
      case 'ice': {
        /*
         * A candidate before a remote description is an error rather than a
         * no-op, and the one that used to leave a share live and blank. Held
         * until there is somewhere to put it.
         */
        if (!pc.remoteDescription) {
          this.early.push(data.candidate)
          return
        }
        try {
          await pc.addIceCandidate(data.candidate)
        } catch {
          // A candidate that no longer applies is not worth ending a call for.
        }
        return
      }
      case 'bye':
        this.stop({ quiet: true })
        this.emit({ connected: false, failed: 'they hung up' })
        return
    }
  }

  private async flushEarly(): Promise<void> {
    const pc = this.pc
    if (!pc) return
    const waiting = this.early
    this.early = []
    for (const c of waiting) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        // Stale by the time it could be used.
      }
    }
  }

  /** Hang up. Quiet leaves the other side to notice on its own. */
  stop({ quiet = false } = {}): void {
    this.clearTimer()
    if (!quiet && this.peer) {
      try { this.send(this.peer, { for: 'call', kind: 'bye' }) } catch { /* gone */ }
    }
    try { this.pc?.close() } catch { /* already closed */ }
    this.pc = null
    this.peer = null
    this.remote = null
    this.early = []
    this.senders.clear()
    this.pendingOffer = false
    this.local = null
    this.state = { connected: false, failed: null }
  }
}
