import { describe, expect, it } from 'vitest'
import { MOST_LINES, MOST_PER_LINE, whatChanged, worthShowing } from './releasenotes'

describe('what a release said it changed', () => {
  /* What the provider actually sends: the release body, as HTML. */
  it('reads a release written as markdown', () => {
    const html = '<h2>Fixed</h2>\n<ul>\n<li>The ring is in tune</li>\n'
      + '<li>Avatars stop when you tab out</li>\n</ul>\n<h2>Added</h2>\n<ul>\n'
      + '<li>The message box grows downwards</li>\n</ul>'
    expect(whatChanged(html)).toEqual([
      { kind: 'heading', text: 'Fixed' },
      { kind: 'item', text: 'The ring is in tune' },
      { kind: 'item', text: 'Avatars stop when you tab out' },
      { kind: 'heading', text: 'Added' },
      { kind: 'item', text: 'The message box grows downwards' },
    ])
  })

  it('keeps a paragraph that was not written as a list', () => {
    expect(whatChanged('<p>Mostly a quiet one: the profile card fits again.</p>'))
      .toEqual([{ kind: 'text', text: 'Mostly a quiet one: the profile card fits again.' }])
  })

  /* A release body typed by hand, with no markup at all. */
  it('and a note written as plain lines', () => {
    expect(whatChanged('Fixed the ring\n- Avatars pause\n* Composer grows'))
      .toEqual([
        { kind: 'text', text: 'Fixed the ring' },
        { kind: 'item', text: 'Avatars pause' },
        { kind: 'item', text: 'Composer grows' },
      ])
  })

  it('writes escaped characters back out', () => {
    expect(whatChanged('<li>Fixed &amp; tidied &quot;the profile&quot;</li>'))
      .toEqual([{ kind: 'item', text: 'Fixed & tidied "the profile"' }])
  })

  /*
   * The point of the whole file. This is text from a release page, which is
   * to say text from somewhere else, and it is going into an app that has a
   * login. Nothing may come out of here that is still markup.
   */
  describe('and nothing that is not words', () => {
    it('drops a script rather than passing it on', () => {
      const out = whatChanged('<li>Fine<script>alert(1)</script></li>')
      expect(out).toEqual([{ kind: 'item', text: 'Fine alert(1)' }])
      expect(JSON.stringify(out)).not.toMatch(/</)
    })

    it('drops an image with a handler on it', () => {
      const out = whatChanged('<p><img src=x onerror="alert(1)">Broken picture</p>')
      expect(out.map((l) => l.text).join(' ')).not.toMatch(/onerror|alert/)
    })

    it('and an anchor keeps its words but not its href', () => {
      const out = whatChanged('<li><a href="javascript:alert(1)">Read more</a></li>')
      expect(out).toEqual([{ kind: 'item', text: 'Read more' }])
    })

    it('and an entity cannot smuggle a tag back in', () => {
      const out = whatChanged('<li>&lt;script&gt;alert(1)&lt;/script&gt;</li>')
      /* It comes out as the characters somebody typed - which is right, and
         safe, because it is rendered as text and never as markup. */
      expect(out).toEqual([{ kind: 'item', text: '<script>alert(1)</script>' }])
    })
  })

  describe('and it cannot become the whole screen', () => {
    it('stops after a couple of dozen lines', () => {
      const many = Array.from({ length: 80 }, (_, i) => `<li>Change ${i}</li>`).join('')
      expect(whatChanged(many)).toHaveLength(MOST_LINES)
    })

    it('and cuts a line somebody wrote an essay on', () => {
      const long = 'x'.repeat(MOST_PER_LINE * 3)
      const [line] = whatChanged(`<li>${long}</li>`)
      expect(line!.text.length).toBeLessThanOrEqual(MOST_PER_LINE + 1)
      expect(line!.text.endsWith('…')).toBe(true)
    })
  })

  /*
   * The shape the Settings pane actually gets.
   *
   * GitHub's API hands over the markdown somebody typed, not HTML - and until
   * this was handled, every heading came through as an ordinary line reading
   * "## Fixed", hashes and all. Which is exactly how it looked on screen, and
   * why no section could be told from the next.
   */
  describe('a release body as markdown, which is what the API sends', () => {
    const md = [
      'The app now tells you what changed.',
      '',
      '## Fixed',
      '',
      '- The ring is in tune',
      '- Long titles scroll',
      '',
      '## Added',
      '',
      '- The box grows downwards',
    ].join('\n')

    it('reads the headings as headings', () => {
      expect(whatChanged(md)).toEqual([
        { kind: 'text', text: 'The app now tells you what changed.' },
        { kind: 'heading', text: 'Fixed' },
        { kind: 'item', text: 'The ring is in tune' },
        { kind: 'item', text: 'Long titles scroll' },
        { kind: 'heading', text: 'Added' },
        { kind: 'item', text: 'The box grows downwards' },
      ])
    })

    it('at any depth, since people write # or ###', () => {
      expect(whatChanged('# One\n### Three\n###### Six')).toEqual([
        { kind: 'heading', text: 'One' },
        { kind: 'heading', text: 'Three' },
        { kind: 'heading', text: 'Six' },
      ])
    })

    /* A hash with no space is not a heading in markdown either. */
    it('but not a hash stuck to a word, which is a tag or a number', () => {
      expect(whatChanged('#1 was fixed')).toEqual([
        { kind: 'text', text: '#1 was fixed' },
      ])
    })

    it('and takes the marks off emphasis rather than showing them', () => {
      expect(whatChanged('- **Fixed** the `ring` at last')).toEqual([
        { kind: 'item', text: 'Fixed the ring at last' },
      ])
    })

    it('and keeps the words of a link without the link', () => {
      expect(whatChanged('- See [the notes](https://example.com/x) for more')).toEqual([
        { kind: 'item', text: 'See the notes for more' },
      ])
    })

    /* A rule is a break between sections, not a line worth reading out. */
    it('and drops a horizontal rule', () => {
      expect(whatChanged('- One\n---\n- Two')).toEqual([
        { kind: 'item', text: 'One' },
        { kind: 'item', text: 'Two' },
      ])
    })

    /* A heading on its own is still a shape with nothing in it. */
    it('and a release of nothing but headings is still not worth showing', () => {
      expect(worthShowing(whatChanged('## Fixed\n## Added'))).toBe(false)
    })
  })

  describe('and whether it is worth interrupting anybody', () => {
    it('an empty release is not', () => {
      expect(worthShowing(whatChanged(''))).toBe(false)
      expect(worthShowing(whatChanged(null))).toBe(false)
      expect(worthShowing(whatChanged('<p></p>'))).toBe(false)
    })

    /* Headings alone are a shape with nothing in it. */
    it('nor is a release that is only headings', () => {
      expect(worthShowing(whatChanged('<h2>Fixed</h2><h2>Added</h2>'))).toBe(false)
    })

    it('but one line about one thing is', () => {
      expect(worthShowing(whatChanged('<li>The ring is a marimba now</li>'))).toBe(true)
    })
  })
})

/*
 * Reported, of the card after an update: "cuts off at the bottom? 'It happens
 * a...'". Not the bottom - every note was being stopped dead at 240
 * characters, mid-word, which reads as the app having broken rather than as
 * there being more to read. The card's body scrolls, so there was never a
 * reason for this function to be shortening anything of ordinary length.
 */
describe('a note is left alone unless it is absurd', () => {
  const noteOf = (text: string) => whatChanged(`<ul><li>${text}</li></ul>`)[0]!.text

  it('a real paragraph arrives whole', () => {
    const note = 'Installers left behind by earlier updates are cleared off your PC. '
      + 'Each one is about a hundred megabytes and nothing will ever use them again; '
      + 'in the app this was measured on there were two hundred megabytes sitting '
      + 'there. It happens a minute after launch, quietly, and never touches the one '
      + 'you are running.'
    expect(note.length).toBeGreaterThan(240)
    expect(noteOf(note)).toBe(note)
  })

  it('and when one truly must be cut, it is cut between words', () => {
    const note = 'sentence '.repeat(300).trim()
    const text = noteOf(note)
    expect(text.endsWith('…')).toBe(true)

    const kept = text.slice(0, -1)
    expect(note.startsWith(kept)).toBe(true)
    /* The character it stopped before is a space, not the middle of a word. */
    expect(note[kept.length]).toBe(' ')
  })

  it('and something that is not prose at all is still bounded', () => {
    expect(noteOf('x'.repeat(9000)).length).toBeLessThanOrEqual(MOST_PER_LINE + 1)
  })
})
