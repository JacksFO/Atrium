/**
 * An invite as a link somebody can be sent.
 *
 * The Make a link button copied a bare code, which is fine inside the app -
 * a code pasted into a conversation is read and turned into a card with a
 * Join button on it. Sent anywhere else, to a phone or a text message, it is
 * eight characters with nothing to press and no way to know what they are
 * for.
 *
 * So it copies an address instead, and arriving at that address does what
 * pressing the card does.
 *
 * The parsing and the building live together, and are pure, because they have
 * to agree exactly: a link this app writes and cannot read again would be
 * worse than the bare code it replaces.
 */

/**
 * Codes are `at-` and hex - and `jc-` before the app was renamed, which
 * every code already handed out still carries. How much hex has changed
 * once already too.
 *
 * They were four bytes; they are nine now, because thirty-two bits is thin
 * for the whole credential that joins a server. This matched exactly eight
 * characters, so widening the server broke every link the moment it shipped:
 * an address the app had just written could not be read back by the app that
 * wrote it, and pasting one simply did nothing.
 *
 * Both exact lengths rather than a range. The old codes are still in the
 * database and still valid - somebody holding a link sent last week should
 * not find it stops working because the next one is longer - but "eight to
 * sixty-four" would also accept a ten-character near-miss and send somebody
 * off to be refused by the server with something unhelpful, which is the
 * thing this was written strict to avoid.
 */
const PATH = /^\/invite\/((?:at|jc)-(?:[0-9a-f]{18}|[0-9a-f]{8}))\/?$/i

/**
 * The address to hand somebody, from a code.
 *
 * Built from where the app is actually being served rather than from a
 * setting: on a phone at the DuckDNS address that is the DuckDNS address, and
 * on a machine reaching it over the local network it is the local one - which
 * is the one that will work for whoever is being sent it from there.
 */
export function inviteLink(code: string, origin = globalThis.location?.origin ?? ''): string {
  return `${origin.replace(/\/+$/, '')}/invite/${code}`
}

/**
 * The code somebody has arrived with, if they arrived with one.
 *
 * Matched strictly, and against the whole path: a link that is nearly right
 * should read as no invite rather than as a code that will be refused later
 * with something unhelpful.
 */
export function inviteFromPath(pathname = globalThis.location?.pathname ?? ''): string | null {
  const m = PATH.exec(pathname)
  return m ? m[1]!.toLowerCase() : null
}
