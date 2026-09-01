import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_QUICK, QUICK_COUNT, quickRow, readRecent, remember } from './recentEmoji'

/**
 * The row of faces, and what it learns.
 *
 * The interesting parts are the edges: a row that grows every time somebody
 * reacts, one that shows the same face twice, and one built from whatever
 * happened to be in storage.
 */
beforeEach(() => {
  localStorage.clear()
})

describe('the row', () => {
  it('is the defaults before anybody has reacted to anything', () => {
    expect(quickRow()).toEqual([...DEFAULT_QUICK])
  })

  it('puts what you just used at the front', () => {
    remember('👀')
    expect(quickRow()[0]).toBe('👀')
  })

  it('and stays the same length', () => {
    for (const face of ['👀', '🎉', '🙏', '😭', '🤝', '🫠']) remember(face)
    expect(quickRow()).toHaveLength(QUICK_COUNT)
  })

  it('and never shows the same face twice', () => {
    remember('👍')
    const row = quickRow()
    expect(new Set(row).size).toBe(row.length)
  })

  it('and keeps the defaults behind what has been used', () => {
    /* One reaction should not leave three gaps. */
    remember('👀')
    const row = quickRow()
    expect(row).toHaveLength(QUICK_COUNT)
    expect(row.slice(1).every((f) => (DEFAULT_QUICK as readonly string[]).includes(f))).toBe(true)
  })

  it('and using one already in it moves it to the front rather than adding it', () => {
    remember('❤️')
    expect(quickRow()[0]).toBe('❤️')
    expect(quickRow()).toHaveLength(QUICK_COUNT)
  })
})

describe('what is remembered', () => {
  it('survives being read back', () => {
    remember('🎉')
    remember('👀')
    expect(readRecent().slice(0, 2)).toEqual(['👀', '🎉'])
  })

  /* Storage is written by whichever version of the app ran last, and can be
     edited by hand. A row built from rubbish is a menu of blank buttons. */
  it('and rubbish in storage does not become a row of blank buttons', () => {
    for (const junk of ['not json', '{}', '[1,2,3]', '[""]', '["  "]', 'null']) {
      localStorage.setItem('atrium.recentEmoji', junk)
      expect(quickRow(), junk).toEqual([...DEFAULT_QUICK])
    }
  })

  it('and something absurdly long is ignored', () => {
    localStorage.setItem('atrium.recentEmoji', JSON.stringify(['x'.repeat(500), '👀']))
    expect(quickRow()[0]).toBe('👀')
  })

  it('and storage being unavailable is not fatal', () => {
    const real = localStorage.getItem
    ;(localStorage as any).getItem = () => { throw new Error('denied') }
    expect(() => quickRow()).not.toThrow()
    expect(quickRow()).toEqual([...DEFAULT_QUICK])
    ;(localStorage as any).getItem = real
  })
})
