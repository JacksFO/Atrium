import { describe, expect, it } from 'vitest'
import { isStale } from './stale'

describe('whether this page is still the one being served', () => {
  it('is no while they match', () => {
    expect(isStale('abc', 'abc')).toBe(false)
  })

  it('and yes once the server has a different one', () => {
    expect(isStale('abc', 'def')).toBe(true)
  })

  /*
   * In development every reload is a different build, and a banner on each
   * one is a banner nobody reads. No stamp means nothing to compare.
   */
  it('and never without a build of our own to compare', () => {
    expect(isStale('', 'def')).toBe(false)
  })

  /* A server that answers with nothing, or with something that is not a
     build, has not said this page is old — it has said nothing. */
  it('and never on an answer that is not one', () => {
    expect(isStale('abc', undefined)).toBe(false)
    expect(isStale('abc', '')).toBe(false)
    expect(isStale('abc', 42)).toBe(false)
  })
})
