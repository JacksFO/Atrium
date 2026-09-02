import { describe, expect, it } from 'vitest'
import { moved, switcherMatches, type Target } from './switcher'

/**
 * The quick switcher's ordering, which is the whole feature.
 *
 * A list that merely contains the right answer is not a switcher. The answer
 * has to be first after two or three letters, or somebody may as well have
 * reached for the mouse - and that is a claim about ordering, which is the
 * one part of this worth testing.
 */

const t = (name: string, kind: Target['kind'] = 'channel', id = name): Target =>
  ({ id, name, kind })

const names = (list: Target[]): string[] => list.map((x) => x.name)

describe('what comes first', () => {
  /* People type the beginning of a name. */
  it('puts what starts with it above what merely contains it', () => {
    const out = switcherMatches([t('off-topic'), t('topical'), t('top')], 'top')
    expect(names(out)[0]).toBe('top')
    expect(names(out).indexOf('topical')).toBeLessThan(names(out).indexOf('off-topic'))
  })

  /* Among names on the same footing, the shorter one. Typing "art" and being
     offered #articles before #art is the classic annoyance. */
  it('and the shorter of two that both start with it', () => {
    expect(names(switcherMatches([t('articles'), t('art')], 'art')))
      .toEqual(['art', 'articles'])
  })

  /* And no amount of shortness lets a mere containment overtake a proper
     beginning - the bands are far enough apart to stop it. */
  it('and never lets a short containment beat a long beginning', () => {
    const out = switcherMatches([t('xa'), t('aardvark-and-friends')], 'a')
    expect(names(out)[0]).toBe('aardvark-and-friends')
  })

  it('and is not fussy about case', () => {
    expect(names(switcherMatches([t('General')], 'gen'))).toEqual(['General'])
  })
})

describe('where you have been', () => {
  /*
   * With nothing typed, the list is the places you were, most recent first -
   * so going back to the last one is two keys. A switcher that opens showing
   * every channel in alphabetical order is a directory, and nobody opens a
   * directory to get somewhere they were a minute ago.
   */
  it('is all the switcher shows before anything is typed', () => {
    const all = [t('general'), t('random'), t('art')]
    expect(names(switcherMatches(all, '', ['art', 'general']))).toEqual(['art', 'general'])
  })

  it('and nothing at all when there is no history yet', () => {
    expect(switcherMatches([t('general')], '', [])).toEqual([])
  })

  /* Once something is typed it only breaks ties - a place you have been must
     not outrank a better match. */
  it('but only breaks a tie once something is typed', () => {
    const out = switcherMatches([t('art'), t('artichoke')], 'art', ['artichoke'])
    expect(names(out)[0], 'familiarity beat a better match').toBe('art')
  })

  it('and does break the tie when the names are level', () => {
    const out = switcherMatches([t('aaa', 'channel', 'one'), t('bbb', 'channel', 'two')], '', ['two', 'one'])
    expect(out.map((x) => x.id)).toEqual(['two', 'one'])
  })
})

describe('what it leaves out', () => {
  it('anything that does not match at all', () => {
    expect(switcherMatches([t('general'), t('random')], 'zzz')).toEqual([])
  })

  /* A switcher is asked again on every keystroke, so it stops once it has
     enough to fill the list. */
  it('and everything past what the list can show', () => {
    const many = Array.from({ length: 50 }, (_, i) => t('channel-' + i))
    expect(switcherMatches(many, 'channel', [], 12)).toHaveLength(12)
  })
})

describe('moving through the list', () => {
  it('goes down and up', () => {
    expect(moved(0, 1, 3)).toBe(1)
    expect(moved(2, -1, 3)).toBe(1)
  })

  /*
   * And wraps. The list is short, and a key that silently does nothing at the
   * end reads as the switcher having frozen rather than as having run out.
   */
  it('and wraps at both ends', () => {
    expect(moved(2, 1, 3)).toBe(0)
    expect(moved(0, -1, 3)).toBe(2)
  })

  it('and copes with an empty list', () => {
    expect(moved(0, 1, 0)).toBe(0)
  })
})
