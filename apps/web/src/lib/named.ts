import type { World } from './world'

/**
 * Whether a message names you.
 *
 * The server works this out and says so in the opening frame, and it is the
 * authority: it can see every role and every member. But it says it once, and
 * messages keep arriving, so something here has to answer the same question
 * for a message that has just landed.
 *
 * This mirrors the server's rule rather than inventing one - `@` then a
 * username, a mentionable role's name, or the two broadcast words, ending on
 * a word boundary. Longest first, so a short name that begins a longer one
 * does not win the match, which is the same reason the server sorts them.
 *
 * It errs towards saying no. Being told about a mention that was not one is
 * worse than missing one, because the first teaches people to distrust the
 * mark and the second is corrected by the next sign-in.
 */
export function namesMe(body: string, w: World): boolean {
  if (!body || !body.includes('@')) return false

  const me = w.me.username?.toLowerCase()
  const tokens = ['everyone', 'here']
  if (me) tokens.push(me)

  /* The roles you hold that may be named. @everyone is not among them - it is
     the word above, and every account holds the role. */
  const mine = new Set(
    w.assignments.filter((a) => a.user_id === w.me.id).map((a) => a.role_id),
  )
  for (const r of w.roles) {
    if (!mine.has(r.id) || r.kind === 'everyone') continue
    if ((r as { mentionable?: number }).mentionable === 0) continue
    tokens.push(r.name.toLowerCase())
  }

  const text = body.toLowerCase()
  for (const token of tokens.sort((a, b) => b.length - a.length)) {
    let at = text.indexOf(`@${token}`)
    while (at !== -1) {
      const after = text[at + token.length + 1]
      /* A word boundary, so @sam does not fire on @sammy. */
      if (after === undefined || !/[a-z0-9_.-]/.test(after)) return true
      at = text.indexOf(`@${token}`, at + 1)
    }
  }
  return false
}
