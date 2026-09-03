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
  const { me, everyone } = namedHow(body, w)
  return me || everyone
}

/**
 * The same question, answered in its two halves.
 *
 * Being named personally and being caught by an @everyone are different
 * things, and somebody who has turned @everyone off in a server is saying
 * exactly that: tell me what is about me, not what is about everybody. One
 * boolean cannot carry that, which is why this exists beside the one that
 * can.
 */
export function namedHow(body: string, w: World): { me: boolean; everyone: boolean } {
  if (!body || !body.includes('@')) return { me: false, everyone: false }

  const mine = w.me.username?.toLowerCase()
  const wide = ['everyone', 'here']
  const tokens: string[] = []
  if (mine) tokens.push(mine)

  /* The roles you hold that may be named. @everyone is not among them - it is
     the word above, and every account holds the role. */
  const held = new Set(
    w.assignments.filter((a) => a.user_id === w.me.id).map((a) => a.role_id),
  )
  for (const r of w.roles) {
    if (!held.has(r.id) || r.kind === 'everyone') continue
    if ((r as { mentionable?: number }).mentionable === 0) continue
    tokens.push(r.name.toLowerCase())
  }

  const text = body.toLowerCase()
  /** Whether any of these words is in there as a mention. */
  const has = (words: readonly string[]): boolean => {
    for (const token of [...words].sort((a, b) => b.length - a.length)) {
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

  /* And the way a mention is actually written when it is picked from the
     list, which survives a rename and is what most of them are. */
  const byId = body.includes(`<@${w.me.id}>`)
  return { me: byId || has(tokens), everyone: has(wide) }
}
