import type { ServerEvent } from './wire'

/**
 * The connection everything else hears from.
 *
 * Two things here are not obvious and both were bugs.
 *
 * The server pings every thirty seconds and hangs up on anybody who does not
 * answer, because a socket can die without either end closing it — a laptop
 * that went to sleep has a socket that is gone whatever `readyState` says. So
 * a ping is answered here and never handed on; nothing above this cares.
 *
 * And anything that arrives before somebody is listening is kept rather than
 * dropped. The client asks for a bootstrap and *then* subscribes, so the
 * frame that opens the connection would otherwise land in the gap — which is
 * how a first screen ends up stale and nobody can say why.
 */

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'offline'

export type GatewayOptions = {
  url: string
  /** Injected so this can be tested without a network. */
  make?: (url: string) => WebSocketLike
  /** How long before trying again, given how many tries have failed. */
  backoff?: (attempt: number) => number
  /** How many goes before it stops and asks. Lower in tests than in life. */
  tries?: number
}

/** Only the parts of a socket this uses, so a test can be a small object. */
export type WebSocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}

const OPEN = 1

/** Quick at first, then backing off, and never longer than half a minute. */
const defaultBackoff = (attempt: number): number =>
  Math.min(30_000, 500 * 2 ** Math.min(attempt, 6))

/**
 * How many times it tries on its own before it asks.
 *
 * Retrying for ever looks identical to being stuck: a spinner that has been
 * turning for a minute says nothing about whether anything is happening or
 * whether it ever will. Three goes take a few seconds between them, cover
 * every ordinary blip - a server restarting, a laptop waking, wifi hopping to
 * another point - and if none of them lands, the honest thing is to say so
 * and let somebody decide.
 */
const TRIES = 3

export class Gateway {
  private socket: WebSocketLike | null = null
  private token = ''
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  /** Events that arrived before anybody was listening. */
  private held: ServerEvent[] = []
  private listeners = new Set<(e: ServerEvent) => void>()
  private states = new Set<(s: ConnState, tries: number) => void>()

  private _state: ConnState = 'offline'

  constructor(private readonly opts: GatewayOptions) {}

  get state(): ConnState {
    return this._state
  }

  /** How many goes it has had since it was last connected. */
  get tries(): number {
    return this.attempt
  }

  private setState(s: ConnState): void {
    /* The count changes while the state does not - the second and third goes
       are both "reconnecting" - and the number is the whole of what somebody
       waiting learns, so it is told either way. */
    const same = this._state === s
    this._state = s
    for (const f of this.states) f(s, this.attempt)
    if (same) return
  }

  onState(f: (s: ConnState, tries: number) => void): () => void {
    this.states.add(f)
    return () => this.states.delete(f)
  }

  /**
   * Go again, because somebody asked.
   *
   * Resets the count: this is a fresh set of tries, not a fourth.
   */
  retry(): void {
    if (this.closed || !this.token) return
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.attempt = 0
    this.connect()
  }

  /**
   * Listen. Anything held from before is delivered at once, in order — the
   * subscriber cannot tell it missed it, which is the point.
   */
  on(f: (e: ServerEvent) => void): () => void {
    this.listeners.add(f)
    if (this.held.length) {
      const catchUp = this.held
      this.held = []
      for (const e of catchUp) f(e)
    }
    return () => this.listeners.delete(f)
  }

  open(token: string): void {
    this.token = token
    this.closed = false
    this.attempt = 0
    this.connect()
  }

  close(): void {
    this.closed = true
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    this.socket?.close()
    this.socket = null
    this.setState('offline')
  }

  send(payload: unknown): void {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify(payload))
    }
    /* Dropped rather than queued. Everything sent this way is about right
       now — that somebody is typing, that a message was read — and a typing
       notice delivered when the connection comes back is worse than none. */
  }

  private connect(): void {
    if (this.closed || !this.token) return
    /* Counted here rather than when one fails, so the number means "goes
       made" - the first connection is the first go, and counting the
       failures instead made three tries into four. */
    this.attempt++
    this.setState(this.attempt <= 1 ? 'connecting' : 'reconnecting')

    const make = this.opts.make ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike)
    const s = make(this.opts.url)
    this.socket = s

    s.onopen = () => {
      this.attempt = 0
      this.setState('open')
      s.send(JSON.stringify({ t: 'hello', token: this.token }))
    }

    s.onmessage = (ev) => {
      let msg: ServerEvent
      try {
        msg = JSON.parse(String(ev.data)) as ServerEvent
      } catch {
        /* Not JSON is not something anything above here can act on. */
        return
      }

      /* Answered here and never handed on. The server hangs up on anybody who
         does not, and nothing above this has an opinion about a heartbeat. */
      if (msg.t === 'ping') {
        s.send(JSON.stringify({ t: 'pong' }))
        return
      }

      if (this.listeners.size === 0) {
        this.held.push(msg)
        return
      }
      for (const f of this.listeners) f(msg)
    }

    s.onclose = () => {
      this.socket = null
      if (this.closed) return
      /*
       * Stops after a few goes and says so, rather than turning for ever.
       *
       * Something has to be waiting for the page to be able to offer a way
       * to try again - a button that appears while a retry is already
       * scheduled would be a second reconnection racing the first.
       */
      if (this.attempt >= (this.opts.tries ?? TRIES)) {
        this.setState('offline')
        return
      }
      this.setState('reconnecting')
      const wait = (this.opts.backoff ?? defaultBackoff)(this.attempt)
      this.timer = setTimeout(() => this.connect(), wait)
    }

    s.onerror = () => {
      /* A socket that errors also closes, and onclose is where the retry
         lives — doing it in both places is two reconnections racing. */
    }
  }
}

/**
 * Every event, handled — checked by the compiler rather than by hoping.
 *
 * The old client translated fifteen of the server's events and dropped the
 * other nineteen on the floor. Reactions, edits, a channel renamed, a role
 * changed, being removed from a call: each of those read as a feature that
 * had never been built, and each was found one at a time, by somebody using
 * the app and noticing something did not update.
 *
 * A handler map typed like this cannot be missing one. Leave a name out and
 * the code does not compile; the list is the union in `wire.ts`, so adding an
 * event there is what makes the compiler ask for it here.
 */

