/**
 * Spotting an invite somebody has been sent.
 *
 * An invite arrives in a conversation as text - "Join Somewhere: at-1a2b3c4d"
 * when it was sent from the member list, or pasted by hand as a code or a
 * link. All three are the same thing said differently, and all three should
 * turn into a card with a button rather than something to copy out and type
 * into a box somewhere else.
 *
 * Pure, and separate from anything that draws or fetches, so what counts as
 * an invite can be tested against the awkward cases rather than eyeballed in
 * a chat window.
 */

/**
 * Codes are `at-` and hex, and `jc-` for every one handed out before the
 * app was renamed - three of those are live and five messages carry one,
 * so both are read. Eight characters once, eighteen now - a range,
 * because codes made before that are still in the database and still valid.
 *
 * Anchored on both sides so it matches the code and not a fragment of
 * something longer: a word ending in the same eight characters is not an
 * invite, and neither is a code with more on the end of it.
 */
const CODE = /(?:^|[^\w-])((?:at|jc)-(?:[0-9a-f]{18}|[0-9a-f]{8}))(?![\w-])/gi

/**
 * Every invite named in a message, in the order they appear, without
 * repeats.
 *
 * A link counts as much as a bare code - somebody who copies the address bar
 * has done the same thing as somebody who copies the code, and telling them
 * apart would only be a way of being unhelpful to one of them.
 */
export function invitesIn(body: string): string[] {
  if (!body) return []
  const found: string[] = []
  // A fresh instance: a /g regex kept between calls carries lastIndex, and
  // the second message it is asked about starts halfway through.
  const re = new RegExp(CODE.source, 'gi')
  for (const m of body.matchAll(re)) {
    const code = m[1]!.toLowerCase()
    if (!found.includes(code)) found.push(code)
  }
  return found
}

/**
 * The one to show, if any.
 *
 * One card per message, like the link preview beside it. Somebody who pastes
 * six invites should not turn a message into six cards - the first is the one
 * they meant, and the rest are still readable as text.
 */
export function firstInvite(body: string): string | null {
  return invitesIn(body)[0] ?? null
}
