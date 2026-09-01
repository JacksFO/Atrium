import { describe, expect, it } from 'vitest'
import { afterRequest } from './friendRequest'

describe('after asking somebody to be a friend', () => {
  it('closes, and opens the list it went into', () => {
    expect(afterRequest({})).toEqual({ kind: 'done', tab: 'sent' })
  })

  it('and stays open on a refusal, saying why', () => {
    /* Closing on a refusal is the app saying nothing about what went wrong. */
    expect(afterRequest({ error: 'slow down a moment' }))
      .toEqual({ kind: 'refused', said: 'slow down a moment' })
  })

  it('opens All when the ask made you friends there and then', () => {
    /* They had already asked you, so this accepted theirs - and Sent is the
       one list it is certainly not in. */
    expect(afterRequest({ accepted: true })).toEqual({ kind: 'done', tab: 'all' })
  })

  it('and when you were friends already', () => {
    expect(afterRequest({ already: 'friends' })).toEqual({ kind: 'done', tab: 'all' })
  })

  it('but Sent when you had simply asked before', () => {
    expect(afterRequest({ already: 'asked' })).toEqual({ kind: 'done', tab: 'sent' })
  })

  it('and copes with an answer that says nothing at all', () => {
    /* An unknown name answers exactly as a sent request does, on purpose:
       otherwise this box tells you which names exist. */
    expect(afterRequest(undefined)).toEqual({ kind: 'done', tab: 'sent' })
    expect(afterRequest(null)).toEqual({ kind: 'done', tab: 'sent' })
  })
})
