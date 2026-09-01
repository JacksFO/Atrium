import { describe, expect, it } from 'vitest'
import {
  hasRules, nextVerdict, rulesBody, verdictOf, verdictsFor, type Override,
} from './overrides'

const rule = (
  subjectId: string, permission: string, allow: boolean,
  kind: 'role' | 'member' = 'role',
): Override => ({ kind, subjectId, permission, allow })

describe('what a channel says about one subject', () => {
  const rules = [
    rule('r1', 'send_messages', false),
    rule('r1', 'read_history', true),
    rule('r2', 'send_messages', true),
    rule('u1', 'send_messages', true, 'member'),
  ]

  it('is only that subject’s', () => {
    const out = verdictsFor(rules, 'role', 'r1')
    expect(out.get('send_messages')).toBe('refuse')
    expect(out.get('read_history')).toBe('allow')
    expect(out.size).toBe(2)
  })

  /* A role and a person can share an id in principle, and reading one as the
     other puts somebody's personal rule onto a role everybody holds. */
  it('and never the other kind of subject with the same id', () => {
    expect(verdictsFor(rules, 'member', 'r1').size).toBe(0)
    expect(verdictsFor(rules, 'role', 'u1').size).toBe(0)
  })

  /* Anything not mentioned is inherited, not refused. Read as refused, a
     channel with one rule in it would take away everything else the server
     allows — a private channel by accident. */
  it('and anything unmentioned is inherited rather than refused', () => {
    const out = verdictsFor(rules, 'role', 'r1')
    expect(verdictOf(out, 'attach_files')).toBe('inherit')
    expect(verdictOf(new Map(), 'send_messages')).toBe('inherit')
  })
})

describe('rounding the three states', () => {
  /* Saying nothing, then yes, then no, then back to saying nothing. Cycling
     yes and no alone cannot express "I did not decide this", which is the
     state nearly every permission is in. */
  it('goes nothing, allow, refuse, nothing', () => {
    expect(nextVerdict('inherit')).toBe('allow')
    expect(nextVerdict('allow')).toBe('refuse')
    expect(nextVerdict('refuse')).toBe('inherit')
  })

  it('and comes back round to where it started', () => {
    let v = nextVerdict('inherit')
    v = nextVerdict(v)
    expect(nextVerdict(v)).toBe('inherit')
  })
})

describe('what is sent', () => {
  /* Only what was decided. Sending inherit as `false` writes a refusal, so a
     panel that sent every permission would turn every untouched one into a
     denial the moment anybody saved anything. */
  it('leaves out everything nobody decided', () => {
    const v = new Map<string, 'allow' | 'refuse' | 'inherit'>([
      ['send_messages', 'allow'], ['read_history', 'refuse'],
      ['attach_files', 'inherit'],
    ])
    expect(rulesBody(v)).toEqual({ send_messages: true, read_history: false })
  })

  /* Clearing every rule sends an empty object, which is what puts a subject
     back to inheriting — not an absent request, which changes nothing. */
  it('and is empty when a subject has been cleared', () => {
    const v = new Map<string, 'allow' | 'refuse' | 'inherit'>([['send_messages', 'inherit']])
    expect(rulesBody(v)).toEqual({})
    expect(rulesBody(new Map())).toEqual({})
  })
})

describe('which subjects the list marks', () => {
  it('is the ones something has been said about', () => {
    const rules = [rule('r1', 'send_messages', false)]
    expect(hasRules(rules, 'role', 'r1')).toBe(true)
    expect(hasRules(rules, 'role', 'r2')).toBe(false)
    expect(hasRules(rules, 'member', 'r1')).toBe(false)
  })
})
