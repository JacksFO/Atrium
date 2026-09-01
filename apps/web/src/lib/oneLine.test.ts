import { describe, expect, it } from 'vitest'
import { oneLine } from './markdown'

describe('a message quoted in one line', () => {
  it('drops the markers and keeps the words', () => {
    expect(oneLine('**bold** and _quiet_ and ~~gone~~')).toBe('bold and quiet and gone')
  })

  /* A quote is one line high. A code block drawn as itself in a quote is the
     reply's own body again in miniature, and it pushes everything under it
     down the screen. */
  it('and does not draw a code block inside itself', () => {
    expect(oneLine('look:\n```js\nconst x = 1\n```')).toBe('look: code')
  })

  it('and never says what a spoiler was hiding', () => {
    expect(oneLine('the ending is ||she leaves||')).toBe('the ending is spoiler')
  })

  it('and folds the newlines away', () => {
    expect(oneLine('one\n\ntwo\n   three')).toBe('one two three')
  })

  it('and stops, rather than running off the end', () => {
    const out = oneLine('x'.repeat(400), 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('\u2026')).toBe(true)
  })

  /* A message that is only a picture has no words at all, and the caller
     shows something else — it must not be a lie about being empty. */
  it('and is empty when there was nothing to say', () => {
    expect(oneLine('')).toBe('')
  })
})
