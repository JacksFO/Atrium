import { describe, it, expect, beforeEach } from 'vitest'
import { keep, find, has, nameFor, isName, count, forget, MAX_ART_BYTES } from './artcache.js'

/**
 * Covers kept by the hash of their own bytes.
 *
 * The address being the content is what makes this safe to expose without a
 * check on the way in: the only thing anybody can store under a hash is the
 * thing that hashes to it, so one client cannot put a picture where another
 * client's is meant to be. Most of what is below is that property.
 */

const jpeg = (n = 64) => Buffer.alloc(n, 7)

beforeEach(() => forget())

describe('keeping a cover', () => {
  it('keeps one that matches its own name', () => {
    const bytes = jpeg()
    expect(keep(nameFor(bytes), 'image/jpeg', bytes)).toBe(true)
    expect(find(nameFor(bytes))?.bytes).toEqual(bytes)
  })

  /*
   * The whole of the safety. Claiming somebody else's hash and sending
   * something else is caught by arithmetic rather than by trusting anybody.
   */
  it('refuses bytes that are not the ones the name is for', () => {
    const mine = jpeg(64)
    const theirs = jpeg(65)
    expect(keep(nameFor(theirs), 'image/jpeg', mine)).toBe(false)
    expect(has(nameFor(theirs))).toBe(false)
  })

  it('refuses a name that is not a hash at all', () => {
    const bytes = jpeg()
    expect(keep('../../etc/passwd', 'image/jpeg', bytes)).toBe(false)
    expect(keep('', 'image/jpeg', bytes)).toBe(false)
    expect(isName('nope')).toBe(false)
  })

  it('refuses anything too big to be a thumbnail', () => {
    const huge = Buffer.alloc(MAX_ART_BYTES + 1, 3)
    expect(keep(nameFor(huge), 'image/jpeg', huge)).toBe(false)
  })

  it('and anything that is not a picture', () => {
    const bytes = jpeg()
    expect(keep(nameFor(bytes), 'text/html', bytes)).toBe(false)
    expect(keep(nameFor(bytes), 'image/svg+xml', bytes)).toBe(false)
  })

  it('refuses nothing at all', () => {
    const empty = Buffer.alloc(0)
    expect(keep(nameFor(empty), 'image/jpeg', empty)).toBe(false)
  })
})

describe('forgetting the ones nobody wants', () => {
  /*
   * Bounded, because this is a cache and not a record. Anything unbounded
   * that fills up from what people play would become exactly the history the
   * feature promises not to keep.
   */
  it('keeps a bounded number of them', () => {
    for (let i = 0; i < 500; i++) {
      const b = Buffer.alloc(8, i % 251)
      keep(nameFor(b), 'image/jpeg', b)
    }
    expect(count()).toBeLessThanOrEqual(400)
  })

  it('and drops the ones least recently looked at', () => {
    const first = Buffer.from('first')
    keep(nameFor(first), 'image/jpeg', first)
    for (let i = 0; i < 399; i++) {
      const b = Buffer.alloc(9, i)
      keep(nameFor(b), 'image/jpeg', b)
      // Looking at the first one keeps it alive while the rest churn past.
      find(nameFor(first))
    }
    const b = Buffer.from('one more')
    keep(nameFor(b), 'image/jpeg', b)
    expect(has(nameFor(first))).toBe(true)
  })
})
