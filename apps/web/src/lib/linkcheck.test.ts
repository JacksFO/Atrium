import { describe, expect, it } from 'vitest'
import { linksIn, render } from './markdown'

describe('a link somebody pasted', () => {
  const url = 'https://fxtwitter.com/Ersan1337/status/2092895879359332495/video/1'

  it('is drawn as a link', () => {
    expect(JSON.stringify(render(url))).toContain('"k":"link"')
  })

  it('and is found for a preview', () => {
    expect(linksIn(url)).toEqual([url])
  })

  it('and still is with shortcodes turned on', () => {
    const out = render(url, { shortcodes: true, emoji: new Map([['fire', '🔥']]) })
    expect(JSON.stringify(out)).toContain('"k":"link"')
  })
})
