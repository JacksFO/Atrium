import { describe, expect, it } from 'vitest'
import { drawn } from './mount'
import { Menu, rows, type MenuItem } from './Menu'

const pick = () => {}
const item = (label: string, over: Partial<MenuItem> = {}): MenuItem =>
  ({ kind: 'item', label, onPick: pick, ...over } as MenuItem)

/* Mounted rather than rendered to a string: the menu goes through a portal to
   the body, and the string renderer cannot follow one. */
const draw = (items: MenuItem[]) =>
  drawn(<Menu x={10} y={10} items={items} onClose={pick} />)

describe('the side-by-side items', () => {
  it('are gathered into one row', () => {
    const out = rows([
      item('a', { wide: true }), item('b', { wide: true }),
      { kind: 'rule' },
      item('Edit'),
    ])
    /* Two: the pair that share a line, then everything that does not. */
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ wide: true })
    expect(out[0]?.items).toHaveLength(2)
    expect(out[1]).toMatchObject({ wide: false })
    expect(out[1]?.items).toHaveLength(2)
  })

  /* Four reactions stacked one per line push Edit and Delete off the bottom
     of a short menu, which is the whole reason they share a row. */
  it('and are drawn in one, not four', () => {
    const out = draw([item('A', { wide: true }), item('B', { wide: true })])
    expect((out.match(/class="mquick"/g) ?? []).length).toBe(1)
    expect((out.match(/class="mq"/g) ?? []).length).toBe(2)
  })

  it('while an ordinary item keeps its own line', () => {
    const out = draw([item('Edit'), item('Delete', { danger: true })])
    expect(out).not.toContain('mquick')
    expect((out.match(/class="mitem/g) ?? []).length).toBe(2)
  })
})

describe('an item that destroys something', () => {
  it('says so', () => {
    expect(draw([item('Delete', { danger: true })])).toContain('mitem danger')
    expect(draw([item('Edit')])).not.toContain('danger')
  })
})

describe('what closes it', () => {
  /* A menu with nothing over the rest of the page stays open behind whatever
     is clicked next, and a second right-click then opens the browser's own
     menu on top of it. */
  it('is a sheet over everything else', () => {
    expect(draw([item('Edit')])).toContain('class="ctxscrim"')
  })
})
