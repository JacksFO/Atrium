import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isProviderUrl, importableHost, klipyResults } from './gifs.js'

/**
 * The guard on "the server will go and fetch this".
 *
 * Setting a GIF as an avatar means the server downloads it and keeps its own
 * copy, so members' addresses are never handed to the provider. That is the
 * right shape - and it means a member gets to name a URL the server will
 * request, which is server-side request forgery unless something says no.
 */
describe('urls the server is willing to fetch', () => {
  it('takes a picture from a provider', () => {
    expect(isProviderUrl('https://media.giphy.com/media/abc/giphy.gif')).toBe(true)
    expect(isProviderUrl('https://giphy.com/a.gif')).toBe(true)
    expect(isProviderUrl('https://media.klipy.com/gifs/x.gif')).toBe(true)
    expect(isProviderUrl('https://klipy.com/a.gif')).toBe(true)
  })

  /*
   * Tenor is not a provider any more. Google stopped issuing keys in January
   * 2026 and switched the API off on 30 June, so a tenor.com URL can only
   * have been made up by whoever sent it.
   */
  it('no longer takes one from Tenor', () => {
    expect(isProviderUrl('https://media1.tenor.com/x/y.gif')).toBe(false)
    expect(isProviderUrl('https://tenor.com/a.gif')).toBe(false)
  })

  /*
   * The reason this is matched by label and not by endsWith. Both of these
   * are somebody else's domain, and both pass a careless check.
   */
  it('is not fooled by a lookalike domain', () => {
    expect(isProviderUrl('https://evil-giphy.com/a.gif')).toBe(false)
    expect(isProviderUrl('https://notgiphy.com/a.gif')).toBe(false)
    expect(isProviderUrl('https://giphy.com.attacker.net/a.gif')).toBe(false)
    expect(isProviderUrl('https://evil-klipy.com/a.gif')).toBe(false)
    expect(isProviderUrl('https://notklipy.com/a.gif')).toBe(false)
    expect(isProviderUrl('https://klipy.com.attacker.net/a.gif')).toBe(false)
  })

  /*
   * The things this exists to refuse. A machine on the far side of the
   * firewall, reachable only from the server, read back out of an avatar.
   */
  it('refuses anything that is not a provider', () => {
    expect(isProviderUrl('https://192.168.0.1/admin')).toBe(false)
    expect(isProviderUrl('http://localhost:8787/api/admin/health')).toBe(false)
    expect(isProviderUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
    expect(isProviderUrl('file:///etc/passwd')).toBe(false)
  })

  it('and refuses plain http even from a provider', () => {
    expect(isProviderUrl('http://media.giphy.com/a.gif')).toBe(false)
    expect(isProviderUrl('http://media.klipy.com/a.gif')).toBe(false)
  })

  it('and anything that is not a url at all', () => {
    expect(isProviderUrl('')).toBe(false)
    expect(isProviderUrl('media.giphy.com/a.gif')).toBe(false)
    expect(isProviderUrl('javascript:alert(1)')).toBe(false)
  })
})

/**
 * The same boundary, drawn a second time for the import.
 *
 * GIPHY's CDN hosts are a known closed set and are listed one at a time.
 * KLIPY's are not published anywhere, so they are matched by domain - which
 * is a wider net over the same trust boundary, not a hole in it: no name
 * under klipy.com is a machine only this server can reach.
 */
describe('hosts the import will take a file from', () => {
  it('takes the providers own CDNs', () => {
    expect(importableHost('media.giphy.com')).toBe(true)
    expect(importableHost('media3.giphy.com')).toBe(true)
    expect(importableHost('media.klipy.com')).toBe(true)
    expect(importableHost('cdn.klipy.com')).toBe(true)
    expect(importableHost('klipy.com')).toBe(true)
  })

  it('is not fooled by a lookalike', () => {
    expect(importableHost('evil-klipy.com')).toBe(false)
    expect(importableHost('klipy.com.attacker.net')).toBe(false)
    expect(importableHost('notklipy.com')).toBe(false)
    // GIPHY stays an exact list, so a subdomain it does not use is refused.
    expect(importableHost('anything.giphy.com')).toBe(false)
  })

  it('and refuses what it exists to refuse', () => {
    expect(importableHost('localhost')).toBe(false)
    expect(importableHost('192.168.0.1')).toBe(false)
    expect(importableHost('169.254.169.254')).toBe(false)
  })

  it('and is not case sensitive, because hostnames are not', () => {
    expect(importableHost('MEDIA.KLIPY.COM')).toBe(true)
    expect(importableHost('Media.Giphy.Com')).toBe(true)
  })
})

/*
 * A KLIPY answer, in the shape their docs and working integrations show:
 * one object per size, each holding one object per format.
 */
const answer = (rows: unknown[]) => ({ result: true, data: { data: rows, has_next: true } })

const full = {
  id: 4711,
  slug: 'cat-typing',
  title: 'Cat Typing',
  file: {
    xs: { jpg: { url: 'https://media.klipy.com/c/xs.jpg', width: 80, height: 60 } },
    sm: { gif: { url: 'https://media.klipy.com/c/sm.gif', width: 160, height: 120 } },
    md: {
      gif: { url: 'https://media.klipy.com/c/md.gif', width: 320, height: 240 },
      mp4: { url: 'https://media.klipy.com/c/md.mp4', width: 320, height: 240 },
      webp: { url: 'https://media.klipy.com/c/md.webp', width: 320, height: 240 },
    },
    hd: { gif: { url: 'https://media.klipy.com/c/hd.gif', width: 640, height: 480 } },
  },
}

describe('reading what KLIPY sends back', () => {
  it('finds the results under data.data', () => {
    expect(klipyResults(answer([full]))).toHaveLength(1)
  })

  it('and under data, if it is ever the array itself', () => {
    expect(klipyResults({ result: true, data: [full] })).toHaveLength(1)
  })

  it('takes the medium size rather than the HD one', () => {
    // The picker draws a tile about a hundred pixels tall; pulling HD for it
    // would be somebody else's bandwidth spent for nothing.
    const [gif] = klipyResults(answer([full]))
    expect(gif!.mp4).toBe('https://media.klipy.com/c/md.mp4')
    expect(gif!.width).toBe(320)
    expect(gif!.height).toBe(240)
  })

  it('prefers webp for the animation, and jpg for the still', () => {
    const [gif] = klipyResults(answer([full]))
    expect(gif!.preview).toBe('https://media.klipy.com/c/md.webp')
    expect(gif!.still).toBe('https://media.klipy.com/c/xs.jpg')
  })

  it('carries the title through as the description', () => {
    expect(klipyResults(answer([full]))[0]!.description).toBe('Cat Typing')
  })

  /*
   * The one that is easy to get wrong.
   *
   * Picking a GIF sends `mp4 || preview` to the import, and the import stores
   * image/gif and video/mp4 and nothing else. So on a result with no mp4 the
   * preview *is* what gets imported, and preferring webp there would produce
   * a tile that looks perfect and refuses to send with "unexpected GIF type".
   */
  it('falls back to the gif, not the webp, when there is no mp4', () => {
    const noVideo = {
      id: 12, title: 'No Video',
      file: {
        md: {
          gif: { url: 'https://media.klipy.com/n/md.gif', width: 300, height: 200 },
          webp: { url: 'https://media.klipy.com/n/md.webp', width: 300, height: 200 },
        },
      },
    }
    const [gif] = klipyResults(answer([noVideo]))
    expect(gif!.mp4).toBe('')
    expect(gif!.preview).toBe('https://media.klipy.com/n/md.gif')
  })

  it('drops a result there is nothing to show for', () => {
    // webp only: nothing to draw that could also be sent.
    const webpOnly = {
      id: 13, title: 'Webp Only',
      file: { md: { webp: { url: 'https://media.klipy.com/w/md.webp' } } },
    }
    expect(klipyResults(answer([webpOnly, { id: 14, title: 'Empty', file: {} }]))).toHaveLength(1)
  })

  it('falls back a size at a time rather than giving up', () => {
    const small = {
      id: 15, slug: 'only-sm', title: 'Only Small',
      file: { sm: { mp4: { url: 'https://media.klipy.com/s/sm.mp4', width: 100, height: 100 } } },
    }
    const [gif] = klipyResults(answer([small]))
    expect(gif!.mp4).toBe('https://media.klipy.com/s/sm.mp4')
  })

  it('reads formats sitting straight on file, with no size between', () => {
    const flat = {
      id: 16, title: 'Flat',
      file: { mp4: { url: 'https://media.klipy.com/f/x.mp4', width: 200, height: 150 } },
    }
    expect(klipyResults(answer([flat]))[0]!.mp4).toBe('https://media.klipy.com/f/x.mp4')
  })

  it('uses the slug when there is no title', () => {
    const untitled = { ...full, title: undefined }
    expect(klipyResults(answer([untitled]))[0]!.description).toBe('cat-typing')
  })

  /*
   * A picker that throws is a picker that shows an error where a grid should
   * be. Anything unexpected should read as "no results", not as a crash.
   */
  it('does not throw on anything unexpected', () => {
    expect(klipyResults(null)).toEqual([])
    expect(klipyResults({})).toEqual([])
    expect(klipyResults({ data: {} })).toEqual([])
    expect(klipyResults({ data: { data: 'nonsense' } })).toEqual([])
    expect(klipyResults(answer([null, undefined, 7, 'x']))).toEqual([])
    expect(klipyResults(answer([{ id: 1 }]))).toEqual([])
  })
})

/**
 * Searches are remembered, because the quota is small and shared.
 *
 * A test key is 100 provider calls an hour for the whole server. The picker
 * spends one per search and one per scroll, and before this it spent a fresh
 * one every time - so ten people asking for "cat" cost ten calls to produce
 * one answer, and one person scrolling could empty the hour's budget in
 * about two minutes.
 *
 * The provider is forced here rather than read from .env: a test that only
 * works on a machine with a key is a test that quietly stops running.
 */
describe('the same search is not asked for twice', () => {
  let gifs: typeof import('./gifs.js')
  let calls: string[]

  beforeAll(async () => {
    process.env.GIPHY_API_KEY = 'test-key-for-the-cache'
    process.env.KLIPY_API_KEY = ''
    vi.resetModules()
    gifs = await import('./gifs.js')
    // The precondition. Without it every check below would pass on the empty
    // array a missing provider returns, and prove nothing at all.
    expect(gifs.gifProvider(), 'no provider, so nothing here is being tested')
      .toBe('giphy')
  })

  afterEach(() => {
    gifs.forgetSearches()
    gifs.forgetBudget()
    vi.unstubAllGlobals()
  })

  const stub = (data: unknown[]) => {
    calls = []
    vi.stubGlobal('fetch', async (url: URL | string) => {
      calls.push(String(url))
      return { ok: true, json: async () => ({ data }) } as Response
    })
  }

  const one = [{
    id: 'abc', title: 'A Cat',
    images: {
      fixed_height_small: {
        url: 'https://media.giphy.com/a.gif', webp: 'https://media.giphy.com/a.webp',
        mp4: 'https://media.giphy.com/a.mp4', width: 100, height: 100,
      },
      fixed_height_small_still: { url: 'https://media.giphy.com/a-still.gif' },
    },
  }]

  it('asks once and answers twice', async () => {
    stub(one)
    const first = await gifs.searchGifs('cat', 24, 0)
    const second = await gifs.searchGifs('cat', 24, 0)
    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(calls, 'the provider was asked a second time').toHaveLength(1)
  })

  it('but a different search is a different question', async () => {
    stub(one)
    await gifs.searchGifs('cat', 24, 0)
    await gifs.searchGifs('dog', 24, 0)
    expect(calls).toHaveLength(2)
  })

  it('and so is the next page of the same one', async () => {
    stub(one)
    await gifs.searchGifs('cat', 24, 0)
    await gifs.searchGifs('cat', 24, 24)
    expect(calls).toHaveLength(2)
  })

  it('trending is remembered too, and separately from a search for it', async () => {
    stub(one)
    await gifs.trendingGifs(24, 0)
    await gifs.trendingGifs(24, 0)
    expect(calls).toHaveLength(1)
  })

  /*
   * An empty answer is not worth keeping for an hour. A provider hiccup, or a
   * word nothing matched yet, would otherwise be the answer everybody gets
   * until the hour turns over.
   */
  it('does not remember having found nothing', async () => {
    stub([])
    await gifs.searchGifs('qwertyuiop', 24, 0)
    await gifs.searchGifs('qwertyuiop', 24, 0)
    expect(calls).toHaveLength(2)
  })

  it('and forgets the oldest rather than growing without limit', async () => {
    stub(one)
    /*
     * The budget is put back each time round. Three hundred and twenty
     * distinct searches is nearly four times the hourly allowance, which is
     * the whole point of the budget and nothing to do with what this test
     * is about - without this it fails on call ninety-one, having proved
     * nothing about the cache at all.
     */
    for (let i = 0; i < 320; i++) {
      gifs.forgetBudget()
      await gifs.searchGifs(`thing-${i}`, 24, 0)
    }
    gifs.forgetBudget()
    const spent = calls.length
    // The first one asked for is long gone; the last one is still there.
    await gifs.searchGifs('thing-0', 24, 0)
    expect(calls.length, 'the oldest search was still remembered').toBe(spent + 1)
    await gifs.searchGifs('thing-319', 24, 0)
    expect(calls.length, 'the newest search was forgotten').toBe(spent + 1)
  })
})

/**
 * The provider's budget is respected rather than discovered.
 *
 * A test key is 100 calls an hour for the whole server. Above that the
 * provider simply starts refusing, and the picker breaks for everybody until
 * the hour turns over with nothing saying why - so this stops at ninety and
 * says something true instead.
 *
 * The cache handles the repeats. This is for a hundred *different* searches,
 * which one bored person can reach on their own.
 */
describe('and the hourly budget is not overspent', () => {
  let gifs: typeof import('./gifs.js')
  let calls: number

  beforeAll(async () => {
    process.env.GIPHY_API_KEY = 'test-key-for-the-budget'
    process.env.KLIPY_API_KEY = ''
    vi.resetModules()
    gifs = await import('./gifs.js')
    expect(gifs.gifProvider(), 'no provider, so nothing here is being tested')
      .toBe('giphy')
  })

  afterEach(() => {
    gifs.forgetSearches()
    gifs.forgetBudget()
    vi.unstubAllGlobals()
  })

  const stub = () => {
    calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return { ok: true, json: async () => ({ data: [{
        id: 'x' + calls, title: 'A Cat',
        images: {
          fixed_height_small: { url: 'https://media.giphy.com/a.gif', mp4: 'https://media.giphy.com/a.mp4', width: 100, height: 100 },
        },
      }] }) } as Response
    })
  }

  const spendAll = async () => {
    for (let i = 0; i < 90; i++) await gifs.searchGifs(`thing-${i}`, 24, 0)
  }

  it('stops before the provider does', async () => {
    stub()
    await spendAll()
    expect(calls, 'it stopped early or late').toBe(90)
    await expect(gifs.searchGifs('one too many', 24, 0)).rejects.toThrow(gifs.OVER_BUDGET)
    expect(calls, 'it asked anyway').toBe(90)
  })

  it('and trending spends from the same budget', async () => {
    stub()
    await spendAll()
    await expect(gifs.trendingGifs(24, 0)).rejects.toThrow(gifs.OVER_BUDGET)
  })

  /*
   * The property that makes running out survivable. A search somebody already
   * made costs nothing, so it must keep working - that is the whole point of
   * remembering them, and it is why spend() sits after the cache and not
   * before it.
   */
  it('but a search already made still answers', async () => {
    stub()
    const first = await gifs.searchGifs('cat', 24, 0)
    expect(first).toHaveLength(1)
    for (let i = 0; i < 89; i++) await gifs.searchGifs(`thing-${i}`, 24, 0)
    // The budget is gone.
    await expect(gifs.searchGifs('brand new', 24, 0)).rejects.toThrow(gifs.OVER_BUDGET)
    // And this one still comes back, without asking anybody.
    const again = await gifs.searchGifs('cat', 24, 0)
    expect(again).toEqual(first)
    expect(calls).toBe(90)
  })

  it('and the hour rolls rather than resetting on a boundary', async () => {
    stub()
    vi.useFakeTimers()
    try {
      await spendAll()
      // Fifty-nine minutes on: still spent, because the window rolls.
      vi.setSystemTime(Date.now() + 59 * 60_000)
      await expect(gifs.searchGifs('too soon', 24, 0)).rejects.toThrow(gifs.OVER_BUDGET)
      // An hour and a minute on: the oldest calls have aged out.
      vi.setSystemTime(Date.now() + 2 * 60_000)
      gifs.forgetSearches()
      await expect(gifs.searchGifs('later', 24, 0)).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * And it lifts when the key stops needing it.
 *
 * Production access is unlimited. A hard ninety would survive the upgrade and
 * become the only thing still rationing GIFs - a limit nobody put there on
 * purpose, enforced by code whose comment says it is protecting a limit that
 * no longer exists. That is the shape of bug that outlives everybody who
 * remembers it, so there is a test for the lifting.
 */
describe('the budget lifts for a production key', () => {
  let gifs: typeof import('./gifs.js')
  let calls: number

  beforeAll(async () => {
    process.env.GIPHY_API_KEY = 'test-key-for-unlimited'
    process.env.KLIPY_API_KEY = ''
    process.env.GIF_CALLS_PER_HOUR = '0'
    vi.resetModules()
    gifs = await import('./gifs.js')
    expect(gifs.gifProvider()).toBe('giphy')
  })

  afterAll(() => { delete process.env.GIF_CALLS_PER_HOUR })
  afterEach(() => { gifs.forgetSearches(); gifs.forgetBudget(); vi.unstubAllGlobals() })

  it('spends past ninety without complaining', async () => {
    calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return { ok: true, json: async () => ({ data: [{
        id: 'x' + calls, title: 'A Cat',
        images: { fixed_height_small: { url: 'https://media.giphy.com/a.gif', mp4: 'https://media.giphy.com/a.mp4', width: 100, height: 100 } },
      }] }) } as Response
    })
    for (let i = 0; i < 150; i++) await gifs.searchGifs(`thing-${i}`, 24, 0)
    expect(calls, 'something was still rationing them').toBe(150)
  })
})

/**
 * A typo in the limit must not mean "no limit".
 *
 * Found in an audit of the hour-old code above. It read
 * Number(process.env.GIF_CALLS_PER_HOUR ?? 90), and Number('abc') is NaN
 * while Number('') is 0 - so GIF_CALLS_PER_HOUR=90O, with a letter O, or a
 * variable set to nothing at all, silently switched off the thing it was
 * setting. A guard that fails open on a misspelling is worse than no guard,
 * because it looks set.
 */
describe('a limit that cannot be misread into nothing', () => {
  const load = async (raw: string | undefined) => {
    if (raw === undefined) delete process.env.GIF_CALLS_PER_HOUR
    else process.env.GIF_CALLS_PER_HOUR = raw
    vi.resetModules()
    return (await import('./config.js')).config.gifCallsPerHour
  }

  afterAll(() => { delete process.env.GIF_CALLS_PER_HOUR })

  it('falls back to the default when it is not a number', async () => {
    expect(await load('abc')).toBe(90)
    expect(await load('90O')).toBe(90)
    expect(await load('ninety')).toBe(90)
  })

  it('and when it is blank or missing', async () => {
    expect(await load('')).toBe(90)
    expect(await load('   ')).toBe(90)
    expect(await load(undefined)).toBe(90)
  })

  it('and refuses a negative rather than reading it as unlimited', async () => {
    expect(await load('-5')).toBe(90)
  })

  /* Zero stays meaningful: it is how the limit is deliberately lifted. */
  it('but zero still means zero, because that is how it is lifted', async () => {
    expect(await load('0')).toBe(0)
  })

  it('and a real number is used as written', async () => {
    expect(await load('40')).toBe(40)
    expect(await load('5000')).toBe(5000)
  })
})
