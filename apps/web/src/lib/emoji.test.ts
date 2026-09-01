import { describe, expect, it } from 'vitest'
import { ALL_EMOJI, BY_NAME, EMOJI_GROUPS, groupsFor, searchEmoji } from './emoji'
import { render } from './markdown'

describe('finding an emoji by name', () => {
  it('matches on part of the name', () => {
    expect(searchEmoji('fire').map((e) => e.glyph)).toContain('🔥')
  })

  /*
   * Names that start with it before names that merely contain it. Typing "s"
   * and being offered melting before smile is a list in table order, which is
   * no order at all from where somebody is sitting.
   */
  it('and puts what starts with it first', () => {
    const out = searchEmoji('s')
    const first = out.findIndex((e) => e.name.startsWith('s'))
    const contains = out.findIndex((e) => !e.name.startsWith('s'))
    expect(first).toBeLessThan(contains)
  })

  it('and everything when nothing has been typed', () => {
    expect(searchEmoji('')).toHaveLength(ALL_EMOJI.length)
    expect(searchEmoji('   ')).toHaveLength(ALL_EMOJI.length)
  })

  it('and says nothing rather than everything when there is no match', () => {
    expect(searchEmoji('notanemoji')).toEqual([])
    expect(groupsFor('notanemoji')).toEqual([])
  })

  /* A picker that drops its headings while filtering makes the result read as
     a different thing from the list it came out of. */
  it('and keeps the headings of the groups that still have something in', () => {
    const out = groupsFor('fire')
    expect(out).toHaveLength(1)
    expect(out[0]?.[0]).toBe('Nature')
  })
})

describe('the table the picker shows and the table messages are drawn from', () => {
  /*
   * One table, because two would be two answers to the same question — and
   * the one on screen would be the wrong one. Somebody picks :fire: from the
   * list, sends it, and it arrives as the literal text.
   */
  it('are the same table', () => {
    for (const e of ALL_EMOJI) expect(BY_NAME.get(e.name)).toBe(e.glyph)
    expect(BY_NAME.size).toBe(ALL_EMOJI.length)
  })

  it('so a shortcode in a message becomes the emoji the picker offered', () => {
    const out = render('that is :fire:', { shortcodes: true, emoji: BY_NAME })
    expect(JSON.stringify(out)).toContain('🔥')
  })

  /* Without the table the renderer leaves the text alone, which is what it
     did for as long as nothing passed one — the setting existed and did
     nothing at all. */
  it('and is left as typed when there is no table to read', () => {
    const out = render('that is :fire:', { shortcodes: true })
    expect(JSON.stringify(out)).toContain(':fire:')
  })
})

describe('every name in the table', () => {
  /* A duplicate name is one of the two being unreachable, silently. */
  it('is unique', () => {
    const seen = new Set(ALL_EMOJI.map((e) => e.name))
    expect(seen.size).toBe(ALL_EMOJI.length)
  })

  it('and every group has something in it', () => {
    for (const [name, list] of EMOJI_GROUPS) {
      expect(list.length, `${name} is empty`).toBeGreaterThan(0)
    }
  })
})
