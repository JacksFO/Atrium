import { describe, expect, it } from 'vitest'
import { isEmptySearch, parseSearch } from './searchQuery.js'

/**
 * What the search box understands.
 *
 * Search took a bare string, which meant the only question it could answer
 * was "which messages contain this word" - and the question people actually
 * have is "that thing Bailey posted in general last week", which is three
 * constraints and often no words at all.
 *
 * The awkward cases are all about a colon meaning two different things. A URL
 * has one, a time of day has one, and an emoticon is nothing but one; none of
 * them are filters, and treating them as filters would break searching for
 * the most ordinary things there are.
 */

describe('the filters', () => {
  it('takes the person out of the words', () => {
    const t = parseSearch('from:bailey the map')
    expect(t.from).toBe('bailey')
    expect(t.text).toBe('the map')
  })

  it('and the channel, with or without its hash', () => {
    expect(parseSearch('in:general hello').in).toBe('general')
    expect(parseSearch('in:#general hello').in).toBe('general')
  })

  it('and a channel whose name has a space in it', () => {
    const t = parseSearch('in:"off topic" hello')
    expect(t.in).toBe('off topic')
    expect(t.text).toBe('hello')
  })

  it('and what the message has to carry', () => {
    expect(parseSearch('has:image').has).toBe('image')
    expect(parseSearch('HAS:LINK').has).toBe('link')
  })

  it('and a date at either end', () => {
    const t = parseSearch('after:2026-01-01 before:2026-02-01')
    expect(t.after).toBeTypeOf('number')
    expect(t.before).toBeTypeOf('number')
    expect(t.before! > t.after!).toBe(true)
  })

  /*
   * Both exclude the day named. "Before the fifth" does not mean "and some of
   * the fifth", and a range of one day either side of a boundary is where
   * that difference is felt.
   */
  it('and excludes the day it names, at both ends', () => {
    const before = parseSearch('before:2026-03-05').before!
    const after = parseSearch('after:2026-03-05').after!
    expect(after - before).toBe(24 * 60 * 60 * 1000)
  })

  it('and takes several at once', () => {
    const t = parseSearch('from:jack in:general has:image the screenshot')
    expect(t.from).toBe('jack')
    expect(t.in).toBe('general')
    expect(t.has).toBe('image')
    expect(t.text).toBe('the screenshot')
  })

  /* Filters with no words at all is a real search - "everything Bailey ever
     posted a picture of" has nothing to match on. */
  it('and works with no words left over', () => {
    const t = parseSearch('from:bailey has:image')
    expect(t.text).toBe('')
    expect(isEmptySearch(t)).toBe(false)
  })
})

describe('a colon that is not a filter', () => {
  /*
   * The case that matters most. A colon appears in a URL, in a time, and in
   * an emoticon, and none of those are filters - treating them as filters
   * would break searching for the most ordinary things there are.
   */
  it('leaves a URL alone', () => {
    const t = parseSearch('https://example.com/thing')
    expect(t.text).toBe('https://example.com/thing')
    expect(t.from).toBeUndefined()
  })

  it('and a time of day', () => {
    expect(parseSearch('meeting at 16:30').text).toBe('meeting at 16:30')
  })

  it('and a word it has never heard of', () => {
    const t = parseSearch('colour:blue')
    expect(t.text).toBe('colour:blue')
  })

  it('and a has: it does not know', () => {
    const t = parseSearch('has:banana')
    expect(t.has).toBeUndefined()
    expect(t.text, 'a filter it cannot honour swallowed the search').toBe('has:banana')
  })

  it('and a date that is not a date', () => {
    expect(parseSearch('before:soon').before).toBeUndefined()
    expect(parseSearch('before:soon').text).toBe('before:soon')
  })

  /* 2026-02-31 is a real-looking date that is not a day. Left alone rather
     than quietly becoming the 3rd of March, which is what a naive parse does
     everywhere. */
  it('and a date that does not exist', () => {
    expect(parseSearch('before:2026-02-31').before).toBeUndefined()
  })

  /* An emoticon is a colon with nothing useful after it, and half a filter is
     somebody still typing. Both stay as words so the results do not jump
     about mid-keystroke. */
  it('and half a filter somebody is still typing', () => {
    expect(parseSearch('from:').text).toBe('from:')
    expect(parseSearch('from:').from).toBeUndefined()
  })

  it('and a leading colon', () => {
    expect(parseSearch(':shush:').text).toBe(':shush:')
  })
})

describe('nothing asked for', () => {
  it('is empty', () => {
    expect(isEmptySearch(parseSearch(''))).toBe(true)
    expect(isEmptySearch(parseSearch('   '))).toBe(true)
  })

  it('but a filter on its own is not', () => {
    expect(isEmptySearch(parseSearch('in:general'))).toBe(false)
    expect(isEmptySearch(parseSearch('before:2026-01-01'))).toBe(false)
  })
})
