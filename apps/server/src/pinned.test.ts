import { describe, expect, it } from 'vitest'
import { fetchRemoteImage } from './media.js'

/**
 * The gap between checking an address and connecting to it.
 *
 * Every address a hostname resolves to was checked, redirects were followed
 * by hand and each hop checked again - and then `fetch` resolved the name a
 * second time and connected to whatever came back. A domain whose DNS answers
 * with a public address once and a private one a moment later walks straight
 * through a check that happened, correctly, on a different answer. It needs
 * nothing but a domain somebody controls and a short time to live.
 *
 * The fix is to connect to the address that was checked, which node:https can
 * do and fetch cannot.
 *
 * What is checked here is the half that can be checked without a network: no
 * address anybody would rebind to is reachable, by any spelling, and a name
 * that resolves to nothing fails as a name rather than as a connection - which
 * is the shape of the fix, and would quietly change if resolving moved back
 * to the connection.
 */

describe('fetching a picture', () => {
  /*
   * Refused before any connection is attempted, which is the whole point:
   * these are the addresses a rebound name would arrive at.
   */
  it('will not go to a loopback address', async () => {
    await expect(fetchRemoteImage('https://127.0.0.1/x.png'))
      .rejects.toThrow(/not reachable/)
  })

  it('nor to a private network', async () => {
    await expect(fetchRemoteImage('https://192.168.1.1/x.png'))
      .rejects.toThrow(/not reachable/)
    await expect(fetchRemoteImage('https://10.0.0.1/x.png'))
      .rejects.toThrow(/not reachable/)
  })

  /* The address a cloud instance's credentials live behind, which is the one
     everybody actually goes for. */
  it('nor to the metadata address', async () => {
    await expect(fetchRemoteImage('https://169.254.169.254/latest/meta-data/'))
      .rejects.toThrow(/not reachable/)
  })

  /* IPv6, including an IPv4 address wearing an IPv6 disguise - the classic
     way past a check that only knows about dotted quads. */
  it('nor to those addresses in IPv6', async () => {
    await expect(fetchRemoteImage('https://[::1]/x.png')).rejects.toThrow(/not reachable/)
    await expect(fetchRemoteImage('https://[::ffff:127.0.0.1]/x.png'))
      .rejects.toThrow(/not reachable/)
  })

  /* And plain http is refused before any of that, so nothing internal that
     speaks only http is reachable even by name. */
  it('and will not speak plain http at all', async () => {
    await expect(fetchRemoteImage('http://example.com/x.png'))
      .rejects.toThrow(/https/)
  })

  it('and refuses something that is not a URL', async () => {
    await expect(fetchRemoteImage('not a url')).rejects.toThrow(/not a URL/)
  })

  /*
   * A name that does not resolve fails as a name rather than as a connection.
   *
   * Worth pinning because the whole shape of the fix is "resolve first, then
   * connect": if resolution moved back to the connection, this would fail
   * with a socket error instead and nobody would notice the check had gone.
   */
  it('and a name that resolves to nothing is refused before connecting', async () => {
    await expect(
      fetchRemoteImage('https://this-name-does-not-exist.invalid/x.png'),
    ).rejects.toThrow(/could not resolve/)
  })
})
