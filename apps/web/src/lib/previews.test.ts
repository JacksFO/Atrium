import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetPreviews, looksLikeImage, previewOf } from './previews'
import type { Api } from './api'

beforeEach(forgetPreviews)

/*
 * The answer as the route really sends it.
 *
 * These tests handed back the fields flat, which is not what the route does,
 * and so they went on passing for as long as link previews were completely
 * broken in the app. A fake that agrees with the code rather than with the
 * server tests nothing at all — see the wire check at the bottom of this file,
 * which reads the route's own source.
 */
const fake = (answer: unknown) => {
  const get = vi.fn(async () => ({ preview: answer }))
  return { server: { get } as unknown as Api, get }
}

describe('a link that is a picture', () => {
  /* Shown as itself. A card whose picture is the whole of what it describes
     is a picture with a caption saying "picture". */
  it('is recognised by what it ends in', () => {
    expect(looksLikeImage('https://x.example/a/b.png')).toBe(true)
    expect(looksLikeImage('https://x.example/A/B.JPEG')).toBe(true)
    expect(looksLikeImage('https://x.example/page')).toBe(false)
  })

  /*
   * Or by a query that names the type, which is not the same as a query that
   * mentions a file.
   *
   * `?to=a.png` is a page that will send you to a picture; `?format=jpg` is
   * the picture. The first was already right and has to stay right — reading
   * the whole address for anything ending .png would draw a broken image
   * where a card belongs.
   */
  it('and by a query that says what the thing is, but not one that points at one', () => {
    expect(looksLikeImage('https://x.example/page?to=a.png')).toBe(false)
    expect(looksLikeImage('https://x.example/go?next=https://y.example/b.jpg')).toBe(false)
    expect(looksLikeImage('https://x.example/a.png?w=100')).toBe(true)
    expect(looksLikeImage('https://x.example/thing?format=png')).toBe(true)
    expect(looksLikeImage('https://x.example/thing?fm=webp')).toBe(true)
    /* A format that is not a picture is still not a picture. */
    expect(looksLikeImage('https://x.example/thing?format=json')).toBe(false)
  })

  /*
   * And not an SVG, which is the one kind that is a picture and a program.
   *
   * In an <img> it cannot run script. But a linked picture is fetched through
   * this server now and handed over as a blob url made by our own origin, and
   * a blob url opened as a document - right-click, open image in a new tab -
   * inherits that origin. Script in the file would then run on Atrium's,
   * holding the session. The media proxy refuses image/svg+xml for the same
   * reason, so this is the two of them agreeing rather than one offering what
   * the other will not serve.
   */
  it('and never an svg, however it is spelled', () => {
    expect(looksLikeImage('https://x.example/logo.svg')).toBe(false)
    expect(looksLikeImage('https://x.example/LOGO.SVG')).toBe(false)
    expect(looksLikeImage('https://x.example/thing?format=svg')).toBe(false)
  })

  /*
   * The one that was reported: a picture from Twitter's CDN.
   *
   * No extension anywhere in the path, the type in the query, and the
   * address answers with a jpeg rather than a page - so it came out as a
   * bare link with nothing to look at and no card either, because there was
   * no markup to read a title off.
   */
  it('and a twitter image, which keeps its type in the query', () => {
    expect(looksLikeImage(
      'https://pbs.twimg.com/media/HQ6-pr5WcAAYhrK?format=jpg&name=large')).toBe(true)
  })

  it('and something that is not an address at all is not one', () => {
    expect(looksLikeImage('not a url .png')).toBe(false)
  })
})

describe('asking what a link is', () => {
  /*
   * Once per address, however many messages mention it — and a re-render is
   * none at all, which matters because the list redraws every time anybody
   * types a letter.
   */
  it('asks the server once and answers everybody from that', async () => {
    const { server, get } = fake({ title: 'A page' })
    const [a, b] = await Promise.all([
      previewOf(server, 'https://x.example/a'),
      previewOf(server, 'https://x.example/a'),
    ])
    expect(get).toHaveBeenCalledTimes(1)
    expect(a?.title).toBe('A page')
    expect(b).toBe(a)
  })

  it('and separately for a different address', async () => {
    const { server, get } = fake({ title: 'A page' })
    await previewOf(server, 'https://x.example/a')
    await previewOf(server, 'https://x.example/b')
    expect(get).toHaveBeenCalledTimes(2)
  })

  /*
   * Nothing worth drawing is nothing drawn. A card holding only the address
   * it was made from is the address again, in a box — and the server answers
   * that way for a page it could not read.
   */
  it('and answers with nothing when there is nothing to show', async () => {
    const { server } = fake({ url: 'https://x.example/a' })
    expect(await previewOf(server, 'https://x.example/a')).toBe(null)
  })

  it('and a picture alone is worth a card', async () => {
    const { server } = fake({ image: 'https://x.example/a.png' })
    expect(await previewOf(server, 'https://x.example/a')).not.toBe(null)
  })

  /* A link that will not resolve is not an error on screen: the message is
     still the message, and the card simply is not there. */
  it('and a refusal is not something to show anybody', async () => {
    const server = { get: async () => { throw new Error('nope') } } as unknown as Api
    expect(await previewOf(server, 'https://x.example/a')).toBe(null)
  })

  it('and fills in what the answer left out rather than passing undefined on', async () => {
    const { server } = fake({ title: 'A page' })
    const p = await previewOf(server, 'https://x.example/a')
    expect(p).toMatchObject({ description: '', image: '', site: '', videoWidth: 0 })
  })
})

/**
 * The shape the route actually answers with.
 *
 * The fields were read straight off the response for as long as link previews
 * existed, and the route has always wrapped them in `{ preview: ... }`. So
 * every link resolved to nothing, silently, with a correct server, a correct
 * fetch and a correct card component that was simply never given anything to
 * draw. Nothing in either half looked wrong on its own.
 */
describe('the preview route answers under a key', () => {
  /* The server that is actually running, which is apps/server — lab/ is the
     prototype it grew out of and answers nothing. */
  const routes = readFileSync(
    resolve(process.cwd(), '../server/src/index.ts'), 'utf8',
  )
  const at = routes.indexOf("app.get('/api/preview'")
  const body = routes.slice(at, at + 1200)

  it('finds the route at all', () => {
    expect(at).toBeGreaterThan(-1)
  })

  it('and it wraps the preview in { preview }', () => {
    expect(body).toMatch(/\{\s*preview:\s*await fetchPreview/)
  })

  it('and takes the address as ?url=', () => {
    expect(body).toMatch(/\{\s*url\s*\}\s*=\s*req\.query/)
  })

  it('so a nested answer becomes a preview', async () => {
    forgetPreviews()
    const server = {
      get: async (path: string) => {
        expect(path).toContain('url=https%3A%2F%2Ffxtwitter.com%2F')
        return { preview: { title: 'Rafael', site: 'FxTwitter', image: 'https://x/i.jpg' } }
      },
    } as unknown as Api
    const p = await previewOf(server, 'https://fxtwitter.com/a/status/1?s=20')
    expect(p?.title).toBe('Rafael')
    expect(p?.site).toBe('FxTwitter')
  })

  /* And a flat one does not, which is what the server never sends. */
  it('and an answer with nothing in it stays nothing', async () => {
    forgetPreviews()
    const server = { get: async () => ({ preview: null }) } as unknown as Api
    expect(await previewOf(server, 'https://example.com/nothing')).toBe(null)
  })
})
