import { describe, expect, it } from 'vitest'
import { oEmbedFor } from './media.js'

/**
 * Which links are asked of a site's own API rather than scraped.
 *
 * YouTube answers a plain fetch with eight hundred kilobytes of JavaScript
 * and not one og: tag - measured - so a link to a video arrived in the chat
 * as a bare line of text. Its oEmbed endpoint answers with the title, the
 * channel and a thumbnail, which is the whole card.
 *
 * The host match is the security of it. This builds an address the server
 * then fetches, so a host test that can be talked into matching something
 * else is a request forgery with extra steps - the same reason isProviderUrl
 * compares whole labels rather than using endsWith.
 */
const at = (href: string) => oEmbedFor(new URL(href))

describe('links that go to the site’s own API', () => {
  it('a watch page', () => {
    expect(at('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toBe('https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json')
  })

  it('the short form, and the phone one', () => {
    expect(at('https://youtu.be/dQw4w9WgXcQ')).toContain('/oembed?url=')
    expect(at('https://m.youtube.com/watch?v=abc')).toContain('/oembed?url=')
    expect(at('https://youtube.com/watch?v=abc')).toContain('/oembed?url=')
  })

  it('always asks youtube.com itself, whatever the link said', () => {
    // The endpoint is built from a fixed host. Nothing from the link decides
    // where the request goes - only what is asked about.
    for (const link of [
      'https://youtu.be/abc',
      'https://m.youtube.com/watch?v=abc',
      'https://www.youtube.com/watch?v=abc',
    ]) {
      expect(at(link)!.startsWith('https://www.youtube.com/oembed?')).toBe(true)
    }
  })

  it('and puts the link in as a parameter, not as a path', () => {
    const built = at('https://youtu.be/abc?x=1&y=2')!
    expect(built).toContain(encodeURIComponent('https://youtu.be/abc?x=1&y=2'))
    // Nothing from the link can add a parameter of its own.
    expect(built.split('&').length).toBe(2)
  })
})

describe('and links that do not', () => {
  it('a host that merely ends with one', () => {
    expect(at('https://youtube.com.attacker.net/watch?v=abc')).toBeNull()
    expect(at('https://notyoutube.com/watch?v=abc')).toBeNull()
    expect(at('https://evil-youtu.be/abc')).toBeNull()
  })

  it('a subdomain nobody said was allowed', () => {
    // www. is stripped and m. is named. Anything else is not YouTube as far
    // as this is concerned, which is the safe direction.
    expect(at('https://music.youtube.com/watch?v=abc')).toBeNull()
    expect(at('https://internal.youtube.com/watch?v=abc')).toBeNull()
  })

  it('and everything else, which is scraped as before', () => {
    expect(at('https://example.com/')).toBeNull()
    expect(at('https://x.com/someone/status/1')).toBeNull()
    expect(at('https://fxtwitter.com/someone/status/1')).toBeNull()
  })
})
