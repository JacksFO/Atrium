import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

/* Rendered the way the browser would, so what is asserted on is the markup
   that actually reaches the page rather than a shape in the middle. */
/* Spread rather than passed, because "no options" and "options that are
   undefined" are different things under exactOptionalPropertyTypes — which is
   the point of that flag, and the reason a profile update carrying no status
   used to write undefined over somebody's presence. */
const html = (text: string, options?: Parameters<typeof Markdown>[0]['options']) =>
  renderToStaticMarkup(<Markdown text={text} {...(options ? { options } : {})} />)

describe('a message that is trying something', () => {
  /* The old renderer built a string of markup and relied on every value
     having been through `esc` by somebody who remembered. The rule meant to
     catch a miss was not checking anything. This cannot be got wrong: React
     puts text into the document as text, and there is no way in here to hand
     it markup instead. */
  it('cannot open a tag', () => {
    const out = html('<img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('cannot close one either, to escape from something', () => {
    const out = html('</span><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script')
  })

  it('cannot smuggle one through bold', () => {
    expect(html('**<script>alert(1)</script>**')).not.toContain('<script')
  })

  it('cannot smuggle one through code, which is kept exactly', () => {
    const out = html('`<script>alert(1)</script>`')
    expect(out).toContain('<code')
    expect(out).not.toContain('<script')
  })

  it('cannot put quotes into an attribute through a mention', () => {
    const names = new Set(['a"onmouseover="alert(1)'])
    const out = html('@a"onmouseover="alert(1)', { names })
    expect(out).not.toContain('onmouseover="alert')
  })

  /* React renders an href without checking it, so this is the one value the
     parser has to refuse rather than escape. */
  it('cannot make a link that runs when clicked', () => {
    expect(html('javascript:alert(1)')).not.toContain('href="javascript')
    expect(html('data:text/html,<script>')).not.toContain('href="data:')
  })
})

describe('and an ordinary message still reads properly', () => {
  it('draws the emphasis it was given', () => {
    const out = html('**bold** and *italic* and ~~gone~~')
    expect(out).toContain('<b>bold</b>')
    expect(out).toContain('<i>italic</i>')
    expect(out).toContain('<s>gone</s>')
  })

  it('links what should be linked, with the safety attributes on it', () => {
    const out = html('see https://example.com/x')
    expect(out).toContain('href="https://example.com/x"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('keeps a quote together', () => {
    const out = html('> one\n> two')
    expect(out).toContain('<blockquote')
    expect((out.match(/<blockquote/g) ?? []).length).toBe(1)
  })

  it('and a name that exists becomes a mention', () => {
    const out = html('@papapk', { names: new Set(['papapk']) })
    expect(out).toContain('class="mention"')
    expect(out).toContain('@papapk')
  })
})
