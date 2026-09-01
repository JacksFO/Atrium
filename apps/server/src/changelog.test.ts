import { afterEach, describe, expect, it, vi } from 'vitest'
import { changelog, forgetChangelog } from './changelog.js'

/** A release as GitHub sends one, with only the fields this reads. */
const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.24',
  published_at: '2026-08-26T12:25:17Z',
  body: '## Fixed\n- The ring is a marimba now',
  draft: false,
  prerelease: false,
  ...over,
})

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response)

afterEach(() => {
  forgetChangelog()
  vi.unstubAllGlobals()
})

describe('the changelog', () => {
  it('reads what the releases said', async () => {
    vi.stubGlobal('fetch', respond([release()]))
    expect(await changelog()).toEqual([{
      version: '0.2.24',
      published: '2026-08-26T12:25:17Z',
      notes: '## Fixed\n- The ring is a marimba now',
    }])
  })

  it('and drops the v off the version, the way people say it', async () => {
    vi.stubGlobal('fetch', respond([release({ tag_name: 'v1.0.0' })]))
    expect((await changelog())[0]!.version).toBe('1.0.0')
  })

  /*
   * A draft is a release nobody has made yet - and there have been two of
   * those sitting in this repository by accident. A prerelease is one not
   * meant for everybody. Neither belongs in a settings pane.
   */
  it('never shows a draft or a prerelease', async () => {
    vi.stubGlobal('fetch', respond([
      release({ tag_name: 'v0.2.25', draft: true }),
      release({ tag_name: 'v0.2.24-rc1', prerelease: true }),
      release({ tag_name: 'v0.2.24' }),
    ]))
    expect((await changelog()).map((r: { version: string }) => r.version)).toEqual(['0.2.24'])
  })

  it('and skips anything without a version at all', async () => {
    vi.stubGlobal('fetch', respond([release({ tag_name: '' }), release()]))
    expect(await changelog()).toHaveLength(1)
  })

  it('cuts a release somebody wrote an essay on', async () => {
    vi.stubGlobal('fetch', respond([release({ body: 'x'.repeat(9000) })]))
    expect((await changelog())[0]!.notes.length).toBe(4000)
  })

  it('and survives GitHub sending something that is not a list', async () => {
    vi.stubGlobal('fetch', respond({ message: 'Not Found' }))
    expect(await changelog()).toEqual([])
  })

  describe('and asks as rarely as it can', () => {
    it('holds the answer rather than asking twice', async () => {
      const fetching = respond([release()])
      vi.stubGlobal('fetch', fetching)
      await changelog()
      await changelog()
      await changelog()
      expect(fetching).toHaveBeenCalledTimes(1)
    })

    /*
     * Ten people opening Settings at the same moment is one request, not ten.
     * Without this the hold only starts once the first answer arrives, so a
     * crowd all miss it together.
     */
    it('and makes one request for a crowd arriving at once', async () => {
      let release_: (v: unknown) => void = () => {}
      const waiting = new Promise((ok) => { release_ = ok })
      const fetching = vi.fn(async () => {
        await waiting
        return { ok: true, status: 200, json: async () => [release()] } as unknown as Response
      })
      vi.stubGlobal('fetch', fetching)

      const all = Promise.all([changelog(), changelog(), changelog()])
      release_(null)
      await all
      expect(fetching).toHaveBeenCalledTimes(1)
    })
  })

  describe('when GitHub cannot be reached', () => {
    it('says so, when there is nothing held', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
      await expect(changelog()).rejects.toThrow()
    })

    /*
     * But hands back what it has if it has anything. Last week's changelog is
     * better than an error, and the alternative to stale here is nothing.
     */
    it('and hands back what it has, however old, when it does', async () => {
      vi.stubGlobal('fetch', respond([release()]))
      const first = await changelog()

      vi.setSystemTime(Date.now() + 60 * 60 * 1000)
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
      expect(await changelog()).toEqual(first)
      vi.useRealTimers()
    })
  })
})

/*
 * Reported: "I also dont see the new changelog in the settings?" - having just
 * updated, which is the one circumstance in which this was guaranteed to be
 * wrong. Two separate ways of getting stuck, both of them silent.
 */
describe('and cannot get stuck holding the wrong thing', () => {
  it('looks again when the version asking is not in what it holds', async () => {
    const first = respond([release({ tag_name: 'v0.2.24' })])
    vi.stubGlobal('fetch', first)
    await changelog('0.2.24')

    /*
     * Somebody who has just updated. Their release cannot possibly be in a
     * snapshot taken before it existed - so the person most certain to open
     * this pane was the one certain to find their own version missing from it.
     */
    const after = respond([release({ tag_name: 'v0.2.25' }), release()])
    vi.stubGlobal('fetch', after)
    expect((await changelog('0.2.25')).map((r) => r.version)).toContain('0.2.25')
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('but not on every open, for a version that will never be a release', async () => {
    vi.stubGlobal('fetch', respond([release()]))
    await changelog()

    vi.setSystemTime(Date.now() + 5 * 60 * 1000)
    const again = respond([release()])
    vi.stubGlobal('fetch', again)

    /* Anybody on a local build. It is never going to be found, so looking
       every time would be one request per open, for ever. */
    await changelog('9.9.9-local')
    await changelog('9.9.9-local')
    await changelog('9.9.9-local')
    expect(again).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  /*
   * The one that turns half an hour stale into permanently stale. A failed
   * fetch leaves the timestamp alone, so the held copy stays older than the
   * window and every single request tries again - and sixty an hour is all
   * GitHub allows an address with no key on it.
   */
  it('and leaves GitHub alone for a while after a refresh has failed', async () => {
    vi.stubGlobal('fetch', respond([release()]))
    await changelog()

    vi.setSystemTime(Date.now() + 40 * 60 * 1000)
    const failing = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', failing)

    await changelog()
    await changelog()
    await changelog()
    expect(failing).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
