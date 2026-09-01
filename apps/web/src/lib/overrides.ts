import type { Id } from './wire'

/**
 * What one channel says about one role or one person.
 *
 * Three states per permission and no fourth: allow, refuse, or say nothing
 * and let the server's own answer stand. Neutral is the *absence* of a rule
 * rather than a rule meaning "default", so only what somebody actually
 * decided is ever stored — and clearing one really clears it rather than
 * leaving a row behind quietly saying yes.
 */

export type Verdict = 'allow' | 'refuse' | 'inherit'

export type Override = {
  kind: 'role' | 'member'
  subjectId: Id
  permission: string
  allow: boolean
}

export type ChannelRules = {
  scope: 'channel' | 'category'
  targetId: Id
  /** Following its category, so editing here breaks that first. */
  synced: boolean
  category: { id: Id; name: string } | null
  overrides: Override[]
}

/** What one subject is currently given, as three-state answers. */
export function verdictsFor(
  rules: readonly Override[],
  kind: 'role' | 'member',
  subjectId: Id,
): Map<string, Verdict> {
  const out = new Map<string, Verdict>()
  for (const o of rules) {
    if (o.kind !== kind || o.subjectId !== subjectId) continue
    out.set(o.permission, o.allow ? 'allow' : 'refuse')
  }
  return out
}

export const verdictOf = (
  verdicts: ReadonlyMap<string, Verdict>,
  permission: string,
): Verdict => verdicts.get(permission) ?? 'inherit'

/**
 * Round the three states, in the order somebody means them.
 *
 * Saying nothing, then yes, then no, then back to saying nothing. Cycling
 * yes → no → yes with no way back to neutral is the version that cannot
 * express "I did not decide this", which is the state most rules are in.
 */
export function nextVerdict(now: Verdict): Verdict {
  if (now === 'inherit') return 'allow'
  if (now === 'allow') return 'refuse'
  return 'inherit'
}

/**
 * The body the server takes: every decided permission, and nothing else.
 *
 * A whole subject at a time, because that is the unit the panel edits and
 * because it makes clearing obvious — send no rules and the subject goes back
 * to inheriting everything.
 */
export function rulesBody(verdicts: ReadonlyMap<string, Verdict>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [permission, verdict] of verdicts) {
    if (verdict === 'inherit') continue
    out[permission] = verdict === 'allow'
  }
  return out
}

/** Whether a subject has anything said about it at all, for the list. */
export const hasRules = (
  rules: readonly Override[],
  kind: 'role' | 'member',
  subjectId: Id,
): boolean => rules.some((o) => o.kind === kind && o.subjectId === subjectId)
