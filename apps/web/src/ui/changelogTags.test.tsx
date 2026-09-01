import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Changes, tagKind } from './Changelog'

/**
 * Release notes drawn as notes, in both places that draw them.
 *
 * There were two renderers. One took the body apart into headings and points;
 * the other printed the string. So a release arrived on screen with
 * `## Security` and `- the app is handed to a page` written out literally,
 * hashes and dashes and all - and it was reported twice, because fixing the
 * first one left the second saying exactly what it had before.
 *
 * One component now. The guard below is about that as much as about the
 * output: two places drawing the same thing two ways is the fault.
 */

const notes = [
  '## Security',
  '- The app is handed only to a page that is actually Atrium.',
  '',
  '## Fixed',
  '- Muting somebody in voice now actually mutes them.',
  '- A mute in one server no longer follows them into private calls.',
].join('\n')

const html = () => renderToStaticMarkup(<Changes notes={notes} />)

describe('what a reader is shown', () => {
  it('has no markdown left in it', () => {
    const out = html()
    expect(out, 'the hashes are still there').not.toContain('##')
    expect(out, 'the dashes are still there').not.toContain('>- ')
  })

  it('and the words themselves survive', () => {
    const out = html()
    expect(out).toContain('Security')
    expect(out).toContain('Muting somebody in voice now actually mutes them.')
  })

  it('draws each heading as a tag', () => {
    const out = html()
    expect((out.match(/class="reltag"|class="reltag" /g) ?? []).length + (out.match(/reltag/g) ?? []).length)
      .toBeGreaterThan(0)
    expect(out).toContain('data-kind="security"')
    expect(out).toContain('data-kind="fixed"')
  })

  it('and each point as a point', () => {
    expect((html().match(/class="reli"/g) ?? [])).toHaveLength(3)
  })

  it('with nothing to say, says so once', () => {
    expect(renderToStaticMarkup(<Changes notes="" />)).toContain('No notes for this one.')
  })
})

describe('which tag a heading gets', () => {
  it('knows the three that matter', () => {
    expect(tagKind('Security')).toBe('security')
    expect(tagKind('Fixed')).toBe('fixed')
    expect(tagKind('Added')).toBe('added')
  })

  it('and matches loosely, because these are written by hand', () => {
    expect(tagKind('## Security fixes')).toBe('security')
    expect(tagKind('Bug fixes')).toBe('fixed')
    expect(tagKind('New')).toBe('added')
    expect(tagKind('WHAT CHANGED')).toBe('other')
  })

  it('and always answers something, so a heading is never left untagged', () => {
    for (const h of ['', 'Notes', 'Miscellany', '???']) {
      expect(tagKind(h).length).toBeGreaterThan(0)
    }
  })
})

describe('the two places that show them', () => {
  it('both go through the one component', () => {
    /* The whole of why this was reported twice. */
    const src = readFileSync(join(__dirname, 'Changelog.tsx'), 'utf8')
    expect((src.match(/<Changes notes=/g) ?? []).length,
      'a renderer that does not use it').toBe(2)
    expect(src, "What's New prints the raw body again")
      .not.toMatch(/className="wnw-b">\{r\.notes\}/)
  })
})
