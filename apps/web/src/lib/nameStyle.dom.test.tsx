import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { nameLook } from './nameStyle'

/* Does the effect actually reach the DOM, or is it lost between the look and
   the element? Reasoning about the stylesheet is no use if the class and the
   custom properties never arrive. */
describe('an effect reaching the page', () => {
  const jack = {
    accent: '#5CD8F0', accent_2: '#FF6E7F',
    name_font: 'serif', name_effect: 'gradient',
  } as never

  it('names the class', () => {
    expect(nameLook(jack).className).toBe('fx-gradient')
  })

  it('and carries both colours', () => {
    const s = nameLook(jack).style as Record<string, string>
    expect(s['--name-colour']).toBe('#5CD8F0')
    expect(s['--name-colour-2']).toBe('#FF6E7F')
  })

  it('and React writes them onto the element', () => {
    const look = nameLook(jack)
    const html = renderToStaticMarkup(
      <span className={`nm ${look.className}`} style={look.style}>Jack</span>,
    )
    expect(html).toContain('fx-gradient')
    expect(html).toContain('--name-colour:#5CD8F0')
    expect(html).toContain('--name-colour-2:#FF6E7F')
  })

  /* A gradient fills the letters itself, so setting the colour as well would
     paint over it. */
  it('and does not set a flat colour over a gradient', () => {
    expect((nameLook(jack).style as Record<string, string>).color).toBeUndefined()
  })
})
