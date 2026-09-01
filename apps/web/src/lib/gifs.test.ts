import { describe, expect, it } from 'vitest'
import { CREDIT, importGif, searchGifs, sendableUrl, type Gif } from './gifs'
import type { Api } from './api'

const gif = (over: Partial<Gif> = {}): Gif => ({
  id: 'g1', preview: 'https://cdn.example/g1.gif', still: 'https://cdn.example/g1.png',
  mp4: 'https://cdn.example/g1.mp4', width: 320, height: 240, description: 'a cat',
  ...over,
})

/** A server that records what it was asked and answers with what it is told. */
function fake(answers: Record<string, unknown>) {
  const asked: string[] = []
  const posted: Array<{ path: string; body: unknown }> = []
  const server = {
    get: async (path: string) => { asked.push(path); return answers[path.split('?')[0]!] },
    post: async (path: string, body: unknown) => {
      posted.push({ path, body })
      const a = answers[path]
      if (a instanceof Error) throw a
      return a
    },
  } as unknown as Api
  return { server, asked, posted }
}

describe('which address a GIF is sent by', () => {
  /* A fraction of the bytes of the same thing as a GIF, far less to decode,
     and what everything here is built to play. */
  it('is the mp4 wherever there is one', () => {
    expect(sendableUrl(gif())).toBe('https://cdn.example/g1.mp4')
  })

  it('and the animated one where there is not', () => {
    expect(sendableUrl(gif({ mp4: '' }))).toBe('https://cdn.example/g1.gif')
  })

  /* A GIF that does not move is not a GIF, so a still is never the thing
     sent — better to refuse than to send somebody a frozen frame. */
  it('and never the still frame', () => {
    expect(sendableUrl(gif({ mp4: '', preview: '' }))).toBe('')
  })
})

describe('sending one', () => {
  /*
   * The bug this exists to prevent. The panel hands back the provider's own
   * CDN address; the send path checks every attachment against the ledger
   * written when a file was uploaded here, and a provider URL has no row
   * there — so the message is not sent without the picture, it is refused
   * entirely, saying the file is not one you uploaded.
   */
  it('imports it here first, and attaches what came back', async () => {
    const { server, posted } = fake({
      '/api/gifs/import': { url: '/uploads/abc.mp4?sig=x', filename: 'a-cat.mp4' },
    })
    const out = await importGif(server, gif())

    expect(posted[0]?.path).toBe('/api/gifs/import')
    expect(posted[0]?.body).toMatchObject({ url: 'https://cdn.example/g1.mp4' })
    expect(out).toEqual({ url: '/uploads/abc.mp4?sig=x', filename: 'a-cat.mp4', is_gif: true })
  })

  /* Never the provider's address — attaching that is the refusal. */
  it('and never attaches the address the panel gave', async () => {
    const { server } = fake({
      '/api/gifs/import': { url: '/uploads/abc.mp4', filename: 'a.mp4' },
    })
    const out = await importGif(server, gif())
    expect(out.url).not.toContain('cdn.example')
  })

  it('and says so when it could not be saved', async () => {
    const { server } = fake({ '/api/gifs/import': { error: 'that is not a GIF provider URL' } })
    await expect(importGif(server, gif())).rejects.toThrow('not a GIF provider URL')
  })

  it('and refuses one with no address at all rather than posting nothing', async () => {
    const { server, posted } = fake({})
    await expect(importGif(server, gif({ mp4: '', preview: '' }))).rejects.toThrow()
    expect(posted).toHaveLength(0)
  })
})

describe('searching', () => {
  /* `offset`, not a page number — asked without it, every page of a search
     was the first one and the panel's scroll fetched the same twenty again. */
  it('asks with the query and the offset', async () => {
    const { server, asked } = fake({ '/api/gifs': { provider: 'klipy', gifs: [], offset: 48 } })
    await searchGifs(server, 'cat', 48)
    expect(asked[0]).toContain('q=cat')
    expect(asked[0]).toContain('offset=48')
  })

  /* A server with no key is a server without GIFs, not a broken one. */
  it('and a server with no provider is not an error', async () => {
    const { server } = fake({ '/api/gifs': { provider: null, gifs: [] } })
    const page = await searchGifs(server, '')
    expect(page.provider).toBe(null)
    expect(page.gifs).toEqual([])
  })

  it('and fills in what a result left out rather than passing undefined on', async () => {
    const { server } = fake({ '/api/gifs': { provider: 'klipy', gifs: [{ id: 'x' }] } })
    const page = await searchGifs(server, '')
    expect(page.gifs[0]).toEqual({
      id: 'x', preview: '', still: '', mp4: '', width: 0, height: 0, description: '',
    })
  })
})

describe('attribution', () => {
  /* Both providers require to be named wherever their results are shown, and
     it went missing once already on the way between builds. */
  it('has a name for every provider the server can answer with', () => {
    expect(CREDIT.klipy).toBe('KLIPY')
    expect(CREDIT.giphy).toBe('GIPHY')
  })
})
