import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReleaseNotes } from './Changelog'

/**
 * A release body is markdown - that is what GitHub stores and what the
 * updater hands over. Drawn as one block of text it shows its own
 * punctuation: "## Fixed" as a line starting with two hashes, and a list as
 * lines starting with dashes. Reported exactly that way, twice.
 */

const release = (notes: string) => ({ version: '0.2.37', published: '', notes })

describe('a release note', () => {
  it('turns a markdown heading into a heading', () => {
    const html = renderToStaticMarkup(<ReleaseNotes release={release('## Fixed')} />)
    expect(html).toContain('relh')
    expect(html, 'and not the hashes').not.toContain('## Fixed')
    expect(html).toContain('Fixed')
  })

  it('and a dashed line into a point', () => {
    const html = renderToStaticMarkup(
      <ReleaseNotes release={release('- the mute button works')} />,
    )
    expect(html).toContain('reli')
    expect(html).not.toContain('- the mute button')
    expect(html).toContain('the mute button works')
  })

  it('keeping the order they were written in', () => {
    const html = renderToStaticMarkup(
      <ReleaseNotes release={release('## Changed\n- one\n## Fixed\n- two')} />,
    )
    expect(html.indexOf('Changed')).toBeLessThan(html.indexOf('one'))
    expect(html.indexOf('one')).toBeLessThan(html.indexOf('Fixed'))
    expect(html.indexOf('Fixed')).toBeLessThan(html.indexOf('two'))
  })

  it('and an ordinary line as an ordinary line', () => {
    const html = renderToStaticMarkup(
      <ReleaseNotes release={release('Everything is faster now.')} />,
    )
    expect(html).toContain('Everything is faster now.')
  })

  it('says so plainly when there are none', () => {
    expect(renderToStaticMarkup(<ReleaseNotes release={release('')} />))
      .toContain('No notes for this one')
  })

  it('and takes the shape the updater sends as readily as the API one', () => {
    /* electron-updater converts the body to HTML before handing it over; the
       API hands over the markdown. Both roads have to end up the same. */
    const html = renderToStaticMarkup(
      <ReleaseNotes release={release('<h2>Fixed</h2><ul><li>the mute button</li></ul>')} />,
    )
    expect(html).toContain('relh')
    expect(html).toContain('reli')
    expect(html).not.toContain('<h2>')
  })
})
