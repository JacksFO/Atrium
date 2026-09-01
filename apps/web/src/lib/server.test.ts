import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which server this client talks to.
 *
 * Every case here is one that has actually happened, which is why it is
 * tested rather than reasoned about: the desktop app has twice ended up
 * unable to find its own server, once by asking on every launch and once by
 * quietly running a copy of itself from inside the installer for weeks.
 *
 * The module reads the address once per import, so each test imports it
 * fresh with the world arranged the way that case needs.
 */

const ADDRESS = 'https://atriumapp.duckdns.org'

/** Pretend to be the desktop shell, or a plain browser tab. */
function asDesktop(on: boolean, bridge: Record<string, unknown> = {}) {
  if (on) {
    /* setBadge, because that is the method the bridge is recognised by: an
       older shell still has the object, so having the object is not the
       question. */
    ;(window as unknown as { atrium?: unknown }).atrium = {
      version: '0.0.0', platform: 'win32', setBadge: () => {}, ...bridge,
    }
  } else {
    delete (window as unknown as { atrium?: unknown }).atrium
  }
}

/** Pretend the page arrived over http(s), or out of the installer. */
function servedFrom(protocol: 'https:' | 'app:') {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { protocol, host: 'atriumapp.duckdns.org', origin: ADDRESS },
  })
}

async function load(builtFor = '') {
  vi.resetModules()
  vi.stubEnv('VITE_DEFAULT_SERVER', builtFor)
  return import('./server')
}

beforeEach(() => {
  localStorage.clear()
  asDesktop(false)
  servedFrom('https:')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('in a browser', () => {
  it('says nothing, because the page came from the server', async () => {
    const { httpBase } = await load(ADDRESS)
    expect(httpBase()).toBe('')
  })

  /* An empty base is what the development proxy relies on, so a build for
     the desktop must not change what a browser does. */
  it('even when an address was baked in', async () => {
    const { getServer } = await load(ADDRESS)
    expect(getServer()).toBe('')
  })

  it('and the socket goes to the same place the page did', async () => {
    const { wsBase } = await load()
    expect(wsBase()).toBe('wss://atriumapp.duckdns.org')
  })
})

describe('in the desktop app', () => {
  /*
   * The one that broke first. The app fetched the client from the server -
   * so the page was already talking to it - and then asked which server to
   * use, on every launch, with no way past.
   */
  it('does not ask when the page was fetched from a server', async () => {
    asDesktop(true)
    servedFrom('https:')
    const { needsServer, httpBase } = await load()
    expect(needsServer()).toBe(false)
    expect(httpBase()).toBe(ADDRESS)
  })

  /*
   * The one that broke second. Opened from the copy inside the installer,
   * with an address baked in, it has everything it needs and must not ask.
   */
  it('uses the address it was built with, unpacked from the installer', async () => {
    asDesktop(true)
    servedFrom('app:')
    const { getServer, serverWasAssumed } = await load(ADDRESS)
    /*
     * Asked before it is worked out, and that order matters.
     *
     * Working the address out stores it - it has to, or the shell never
     * learns it - so after that it is an address like any other and this
     * answers false. It is the question "was this chosen for them", and the
     * moment to ask is on the way in.
     */
    expect(serverWasAssumed()).toBe(true)
    expect(getServer()).toBe(ADDRESS)
    expect(serverWasAssumed()).toBe(false)
  })

  /*
   * And it tells the shell, which is the half that was missed. The shell
   * picks what to load before any page exists; a page that works the address
   * out and keeps it to itself leaves the shell opening the installer's copy
   * for ever, silently running whatever shipped with it.
   */
  it('and tells the shell, so the next launch loads the real thing', async () => {
    const setServer = vi.fn()
    asDesktop(true, { setServer })
    servedFrom('app:')
    const { getServer } = await load(ADDRESS)
    getServer()
    expect(setServer).toHaveBeenCalledWith(ADDRESS)
  })

  it('prefers what somebody typed over what it was built with', async () => {
    asDesktop(true)
    servedFrom('app:')
    localStorage.setItem('atrium.server', 'http://192.168.1.10:8787')
    const { getServer, serverWasAssumed } = await load(ADDRESS)
    expect(getServer()).toBe('http://192.168.1.10:8787')
    expect(serverWasAssumed()).toBe(false)
  })

  /* Nothing baked in and nothing saved is the only case worth asking about. */
  it('asks only when it has nothing at all', async () => {
    asDesktop(true)
    servedFrom('app:')
    const { needsServer } = await load('')
    expect(needsServer()).toBe(true)
  })

  it('and the socket follows the address rather than the page', async () => {
    asDesktop(true)
    servedFrom('app:')
    const { wsBase } = await load(ADDRESS)
    expect(wsBase()).toBe('wss://atriumapp.duckdns.org')
  })
})

describe('an address saved before the server moved', () => {
  /* Every install from before that move still points at the old port and
     would simply stop connecting. */
  it('is brought forward to the standard port', async () => {
    asDesktop(true)
    servedFrom('app:')
    localStorage.setItem('atrium.server', 'https://atriumapp.duckdns.org:8787')
    const { getServer } = await load()
    expect(getServer()).toBe(ADDRESS)
    expect(localStorage.getItem('atrium.server')).toBe(ADDRESS)
  })

  /* A LAN or development setup on http may genuinely still be on that port,
     so only the secure ones are touched. */
  it('but a local one on the same port is left alone', async () => {
    asDesktop(true)
    servedFrom('app:')
    localStorage.setItem('atrium.server', 'http://192.168.1.10:8787')
    const { getServer } = await load()
    expect(getServer()).toBe('http://192.168.1.10:8787')
  })
})

describe('setting one by hand', () => {
  it('drops a trailing slash, so two addresses are not one server', async () => {
    asDesktop(true)
    servedFrom('app:')
    const { setServer, getServer } = await load()
    setServer('https://example.com/')
    expect(getServer()).toBe('https://example.com')
  })

  it('and tells the shell as well as this page', async () => {
    const setServer = vi.fn()
    const clearServer = vi.fn()
    asDesktop(true, { setServer, clearServer })
    servedFrom('app:')
    const mod = await load()
    mod.setServer('https://example.com')
    expect(setServer).toHaveBeenCalledWith('https://example.com')
    mod.clearServer()
    expect(clearServer).toHaveBeenCalled()
  })

  /* An older shell has neither. A client that assumes otherwise breaks on
     the version somebody has not updated yet. */
  it('and does not mind a shell that has neither', async () => {
    asDesktop(true, {})
    servedFrom('app:')
    const { setServer } = await load()
    expect(() => setServer('https://example.com')).not.toThrow()
  })
})
