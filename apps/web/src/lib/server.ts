/**
 * Where the server lives.
 *
 * In a browser this is nothing at all: the page came from the server, so a
 * relative URL is right, and in development the Vite proxy forwards /api and
 * /gateway to the local one.
 *
 * In the packaged desktop app there is no proxy and there may be no page from
 * a server yet - the shell opens a copy of the client it was installed with,
 * over app://, before it knows where to look. That copy has to carry an
 * address, and this is where it carries it.
 *
 * Asking on first run is a reasonable question to put to whoever set the
 * server up and an impossible one for everybody else: somebody downloads the
 * app from a link, opens it, and is asked to type an address nobody has told
 * them. The build knows where it came from - the installer was published to
 * that server - so it starts there and only asks if nothing was baked in.
 *
 * Ported from the client this replaced, which is the only reason that client
 * is still in the repo.
 */

import { shell } from './shell'

const KEY = 'atrium.server'

/**
 * Where a fresh install looks first.
 *
 * Set at build time from the address the installer publishes to, so a copy
 * built by somebody else for their own server points at theirs rather than
 * carrying this one around hardcoded. Empty in a plain web build, where a
 * relative URL is right and this must not interfere.
 */
const BUILT_FOR = (import.meta.env.VITE_DEFAULT_SERVER ?? '').replace(/\/+$/, '')

/** Storage that answers rather than throwing, wherever it is unavailable. */
const store = {
  get(): string {
    try {
      return localStorage.getItem(KEY) ?? ''
    } catch {
      return ''
    }
  },
  set(value: string): void {
    try {
      localStorage.setItem(KEY, value)
    } catch {
      /* A private window, or storage turned off. The address is still used
         for this session; it simply is not remembered. */
    }
  },
  remove(): void {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* As above. */
    }
  },
}

/**
 * Whether this page was fetched from a server rather than unpacked locally.
 *
 * The copy inside the installer is served over app://; anything over http(s)
 * arrived from somewhere, and that somewhere is the server.
 */
function fromServer(): boolean {
  return typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
}

/**
 * Fix up an address saved before the server moved to the standard port.
 *
 * The desktop app remembers whatever it was told on first run, so an install
 * from before that move is still pointing at :8787 and would simply stop
 * connecting. Only https addresses are touched: a development or LAN setup
 * uses http and may genuinely still be on that port.
 */
function migrate(url: string): string {
  if (!url.startsWith('https://') || !url.includes(':8787')) return url
  const fixed = url.replace(':8787', '')
  store.set(fixed)
  return fixed
}

/** The address to talk to, or empty for "wherever this page came from". */
export function getServer(): string {
  /*
   * A client fetched from a server does not need to be told where it is.
   *
   * This is the case that broke twice. The desktop app used to open its own
   * bundled client, built with the address baked in; when it started fetching
   * the client from the server instead it got the *web* build, which has no
   * address baked in because a browser has never needed one. It was still the
   * desktop app, so it concluded it had not been told where its server was
   * and asked - on every launch, with no way past.
   *
   * Answering with the origin rather than an empty string matters: saved
   * passwords are filed under this value, and '' would file them under
   * "default" and orphan every one already stored.
   */
  if (shell() && fromServer()) return location.origin

  const saved = store.get()
  /* Only the desktop app falls back: in a browser an empty string means
     "same origin", which is both correct and what the dev proxy relies on. */
  if (!saved && shell() && BUILT_FOR) {
    /*
     * Tell the shell as well, not just this page.
     *
     * The shell decides what to load before any page exists, and it decides
     * by looking for an address somebody stored. Defaulting here without
     * storing anything meant it never found one, so it kept loading the copy
     * of the client inside the installer - which works, and silently freezes
     * at whatever shipped with it. Every fix deployed to the server went
     * nowhere, invisibly, for as long as that lasted.
     */
    setServer(BUILT_FOR)
    return BUILT_FOR
  }
  return migrate(saved)
}

export function setServer(url: string): void {
  const clean = url.replace(/\/+$/, '')
  store.set(clean)
  shell()?.setServer?.(clean)
}

export function clearServer(): void {
  store.remove()
  shell()?.clearServer?.()
}

/**
 * Whether the address came from a build rather than from a person.
 *
 * Worth distinguishing when something cannot connect: a typed address is
 * probably a typo, and a built-in one probably means the server is down.
 */
export function serverWasAssumed(): boolean {
  return Boolean(!store.get() && shell() && BUILT_FOR)
}

/** The desktop app cannot fall back on a proxy, so it must be told an address. */
export function needsServer(): boolean {
  return Boolean(shell()) && !getServer()
}

/** Absolute or relative base for HTTP calls. */
export function httpBase(): string {
  return getServer()
}

/** Base for the socket, derived from the HTTP address. */
export function wsBase(): string {
  const server = getServer()
  if (!server) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}`
  }
  return server.replace(/^http/, 'ws')
}
