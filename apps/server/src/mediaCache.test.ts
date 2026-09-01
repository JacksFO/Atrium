import { beforeEach, describe, expect, it } from 'vitest'
import {
  cachedImage, holdImage, imageCacheSize, forgetCachedImages,
  MEDIA_CACHE_ENTRY_MAX,
} from './media.js'

/**
 * The bytes of a proxied image, kept for the next person.
 *
 * The proxy exists so that whoever hosts an image learns one address instead
 * of everybody's - but without this it was one address asking a hundred
 * times, which is the same bandwidth and a better impression of an attack.
 * The browser's own cache does nothing for the ten other people in the
 * channel, who each arrive with an empty one.
 *
 * What is worth testing is not that a Map remembers things. It is the two
 * bounds - a single file cannot be enormous, and the whole store cannot grow
 * without limit - because getting either wrong turns a cache into the reason
 * the server runs out of memory.
 */

const bytes = (n: number) => Buffer.alloc(n, 7)

beforeEach(() => { forgetCachedImages() })

describe('an image somebody already looked at', () => {
  it('comes back without going out again', () => {
    holdImage('https://x.example/a.png', 'image/png', bytes(1000))
    const got = cachedImage('https://x.example/a.png')
    expect(got?.type).toBe('image/png')
    expect(got?.body.length).toBe(1000)
  })

  /* The address is the identity, so a different one is a different picture
     and must never be answered with these bytes. */
  it('and only for the address it was fetched from', () => {
    holdImage('https://x.example/a.png', 'image/png', bytes(1000))
    expect(cachedImage('https://x.example/b.png')).toBeNull()
    expect(cachedImage('https://y.example/a.png')).toBeNull()
  })
})

describe('the bounds', () => {
  /*
   * One big file must not be able to take the whole store, and the proxy
   * accepts files four times this size - so the large ones simply stream
   * through uncached, which is the old behaviour and is fine.
   */
  it('refuses a file too big to be worth holding', () => {
    holdImage('https://x.example/huge.png', 'image/png', bytes(MEDIA_CACHE_ENTRY_MAX + 1))
    expect(cachedImage('https://x.example/huge.png')).toBeNull()
    expect(imageCacheSize().entries).toBe(0)
  })

  /*
   * And the whole store stays under its cap however many are put in it.
   *
   * Sixty-four entries at the entry maximum is well past the total, so if
   * nothing is being dropped this ends up holding 128MB - which is the bug
   * this is here to catch, and it is the kind that only shows up in
   * production on a busy day.
   */
  it('and drops the oldest rather than growing forever', () => {
    for (let i = 0; i < 64; i += 1) {
      holdImage(`https://x.example/${i}.png`, 'image/png', bytes(MEDIA_CACHE_ENTRY_MAX))
    }
    const { bytes: held } = imageCacheSize()
    expect(held).toBeLessThanOrEqual(64 * 1024 * 1024)
    /* The most recent is still there and the first one is not, which is
       what "oldest" has to mean for a burst of people opening one link. */
    expect(cachedImage('https://x.example/63.png')).not.toBeNull()
    expect(cachedImage('https://x.example/0.png')).toBeNull()
  })

  /* Asking for one keeps it: otherwise the picture everybody is looking at
     is the one evicted, being the oldest by the time they arrive. */
  it('and keeps what is being asked for', () => {
    const many = 40
    for (let i = 0; i < many; i += 1) {
      holdImage(`https://x.example/${i}.png`, 'image/png', bytes(MEDIA_CACHE_ENTRY_MAX))
    }
    /* The first survivor, touched, then pushed past the cap again. */
    const alive = [...Array(many).keys()]
      .map((i) => `https://x.example/${i}.png`)
      .find((u) => cachedImage(u) !== null)!
    for (let i = many; i < many + 20; i += 1) {
      holdImage(`https://x.example/${i}.png`, 'image/png', bytes(MEDIA_CACHE_ENTRY_MAX))
    }
    expect(cachedImage(alive)).not.toBeNull()
  })
})

/**
 * And the route actually uses it.
 *
 * The store above is tested properly; the wiring is not testable the same
 * way. /api/media is declared inline in index.ts rather than in a route
 * module, so nothing can inject a request at it without starting the server,
 * and the proxy refuses private addresses by design - so there is no local
 * host to point it at either. An end-to-end test of this route needs a real
 * image on the real internet, which is why there has never been one.
 *
 * What can be checked, and is the failure worth catching, is that the route
 * still consults the store before going out. A cache nothing reads is the
 * quiet version of this whole change not existing.
 */
describe('the route', () => {
  const src = readFileSync(join(__dirname, 'index.ts'), 'utf8').split('\r\n').join('\n')
  const from = src.indexOf("app.get('/api/media'")
  const to = src.indexOf('\napp.', from + 10)
  const route = src.slice(from, to)

  /*
   * The slice is a slice, and not the rest of the file.
   *
   * If either marker were missing, indexOf answers -1, the slice runs to the
   * end of index.ts, and every assertion below would pass by finding these
   * calls somewhere else entirely. That has happened three times in this
   * codebase now, so it is asserted rather than assumed.
   */
  it('is one route, bounded at both ends', () => {
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(route.length).toBeLessThan(4000)
    expect(route).toContain("app.get('/api/media'")
  })

  it('looks in the store before fetching anything', () => {
    expect(route).toContain('cachedImage(url)')
    expect(route.indexOf('cachedImage(url)')).toBeLessThan(route.indexOf('fetchRemoteImage'))
  })

  /*
   * Two budgets, and the order they are spent in.
   *
   * There was one, at 120 a minute, described in its own comment as counting
   * outbound requests - which it did, until the cache meant most requests are
   * not outbound. Counting a hit against that budget made the limit stricter
   * than its stated reason: a channel dense with pictures, scrolled quickly,
   * would turn them back into links while causing no outbound traffic at all.
   *
   * The wide one is not decoration. Serving a held picture costs upload
   * whether or not anybody went out for it, so a hit cannot simply be free -
   * a thousand requests for one cached 2MB file is two gigabytes of somebody's
   * home connection.
   */
  it('spends a wide budget on serving and a tight one on going out', () => {
    const serving = route.indexOf('`media:${user.id}`')
    const fetching = route.indexOf('`mediafetch:${user.id}`')
    const cache = route.indexOf('cachedImage(url)')
    expect(serving, 'a budget for serving').toBeGreaterThan(-1)
    expect(fetching, 'and a separate one for fetching').toBeGreaterThan(-1)

    /* Serving is checked before anything happens; fetching only after the
       cache has been asked, or a hit would spend it for nothing. */
    expect(serving).toBeLessThan(cache)
    expect(cache).toBeLessThan(fetching)
  })

  it('and the going-out budget is the tighter of the two', () => {
    const wide = /`media:\$\{user\.id\}`, (\d+),/.exec(route)
    const tight = /`mediafetch:\$\{user\.id\}`, (\d+),/.exec(route)
    expect(wide, 'the serving budget has a number').toBeTruthy()
    expect(tight, 'so does the fetching one').toBeTruthy()
    expect(Number(tight![1])).toBeLessThan(Number(wide![1]))
  })

  it('and keeps what it fetched', () => {
    expect(route).toContain('holdImage(url, type,')
  })

  /* On the end of the stream, not as the bytes arrive: a fetch that dies
     halfway would otherwise be handed to everybody else as the picture. */
  it('but only a response that finished', () => {
    expect(route).toMatch(/on\('end'[\s\S]{0,120}holdImage/)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
