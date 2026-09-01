import { describe, expect, it } from 'vitest'
import { inline, isJumbo, linksIn, render, safeHref, type MarkdownNode } from './markdown'

/* What a run of nodes says, with the markup thrown away — enough to assert on
   without asserting on a shape nobody reads. */
const words = (nodes: MarkdownNode[]): string =>
  nodes.map((n) => {
    switch (n.k) {
      case 'text': case 'code': case 'pre': return n.text
      case 'link': return n.text
      case 'mention': return `@${n.name}`
      case 'emphasis': return words(n.kids)
    }
  }).join('')

const kinds = (nodes: MarkdownNode[]): string[] => nodes.map((n) => n.k)

describe('nothing here produces markup', () => {
  /* The whole point. There is no string of HTML anywhere in the output, so
     there is no escaping to forget — which is what the old renderer got
     wrong, and what the rule meant to catch it did not catch. */
  it('leaves a tag somebody typed as the words they typed', () => {
    const out = inline('<img src=x onerror=alert(1)>')
    expect(kinds(out)).toEqual(['text'])
    expect(words(out)).toBe('<img src=x onerror=alert(1)>')
  })

  it('and does the same inside bold', () => {
    const out = inline('**<script>alert(1)</script>**')
    expect(words(out)).toBe('<script>alert(1)</script>')
    expect(out[0]?.k).toBe('emphasis')
  })
})

describe('a link', () => {
  it('is picked out of the words around it', () => {
    const out = inline('see https://example.com/x now')
    expect(kinds(out)).toEqual(['text', 'link', 'text'])
  })

  /* React renders an href without checking it, and `javascript:` in one runs
     when clicked. This is the only place a value becomes something the
     browser acts on rather than something it shows. */
  it('is refused unless it is plainly http or https', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('https://example.com')).toBe('https://example.com/')
  })
})

describe('mentions', () => {
  const names = new Set(['papapk', 'JacksFO'])

  it('only names that exist, so a stray @ stays a stray @', () => {
    expect(kinds(inline('@nobody', { names }))).toEqual(['text'])
    expect(kinds(inline('@papapk', { names }))).toEqual(['mention'])
  })

  it('matches however it was typed, and shows the real name', () => {
    const out = inline('@PAPAPK', { names })
    expect(out[0]).toMatchObject({ k: 'mention', name: 'papapk' })
  })

  it('marks your own', () => {
    expect(inline('@JacksFO', { names, me: 'jacksfo' })[0]).toMatchObject({ me: true })
    expect(inline('@papapk', { names, me: 'jacksfo' })[0]).toMatchObject({ me: false })
  })
})

describe('code is not read any further', () => {
  it('keeps its contents exactly, markers and all', () => {
    const out = inline('`**not bold**`')
    expect(out[0]).toEqual({ k: 'code', text: '**not bold**' })
  })

  it('and a block does the same', () => {
    const out = inline('```\n<b>hi</b>\n```')
    expect(out[0]).toEqual({ k: 'pre', text: '<b>hi</b>' })
  })
})

describe('emphasis', () => {
  it('reads the longer marker first, so ** is not eaten by *', () => {
    expect(inline('**bold**')[0]).toMatchObject({ k: 'emphasis', style: 'b' })
    expect(inline('*just italic*')[0]).toMatchObject({ k: 'emphasis', style: 'i' })
  })

  it('nests', () => {
    const out = inline('**bold with *italic* in it**')
    expect(out[0]?.k).toBe('emphasis')
    expect(words(out)).toBe('bold with italic in it')
  })

  it('takes the earliest one, not the first kind it looks for', () => {
    const out = inline('~~a~~ and **b**')
    expect(out[0]).toMatchObject({ style: 's' })
  })

  it('handles a spoiler', () => {
    expect(inline('||secret||')[0]).toMatchObject({ style: 'spoiler' })
  })
})

describe('the whole message', () => {
  it('is one block per line', () => {
    expect(render('a\nb').map((b) => b.k)).toEqual(['line', 'line'])
  })

  it('gathers a run of quoted lines into one quote', () => {
    const out = render('> one\n> two\nafter')
    expect(out.map((b) => b.k)).toEqual(['quote', 'line'])
    expect(out[0]?.k === 'quote' && out[0].lines).toHaveLength(2)
  })
})

describe('emoji on their own', () => {
  it('are drawn big, up to three', () => {
    expect(isJumbo('🔥')).toBe(true)
    expect(isJumbo('🔥🔥🔥')).toBe(true)
  })

  it('but not four, and not with words beside them', () => {
    expect(isJumbo('🔥🔥🔥🔥')).toBe(false)
    expect(isJumbo('hi 🔥')).toBe(false)
    expect(isJumbo('')).toBe(false)
  })

  it('and a shortcode becomes one when the table is given', () => {
    const emoji = new Map([['fire', '🔥']])
    expect(words(inline(':fire:', { emoji }))).toBe('🔥')
  })

  it('unless somebody turned that off', () => {
    const emoji = new Map([['fire', '🔥']])
    expect(words(inline(':fire:', { emoji, shortcodes: false }))).toBe(':fire:')
  })
})

describe('the links a message gets cards for', () => {
  it('drops the punctuation that belongs to the sentence', () => {
    expect(linksIn('see https://example.com/x.')).toEqual(['https://example.com/x'])
  })

  it('lists each one once', () => {
    expect(linksIn('https://a.com/one https://a.com/one')).toHaveLength(1)
  })

  it('and stops at three, because ten is a wall', () => {
    expect(linksIn('https://a.com/1 https://a.com/2 https://a.com/3 https://a.com/4'))
      .toHaveLength(3)
  })
})
