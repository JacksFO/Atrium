/**
 * Being signed in, across reloads.
 *
 * Small, but every line is a decision that was got wrong somewhere.
 *
 * Reading is wrapped because storage throws rather than returning nothing in
 * a private window and wherever site data is blocked — an unguarded read
 * there takes the whole app down before anything has drawn, which looks like
 * the app being broken rather than a browser setting.
 *
 * And signing out clears the token before anything else happens, so a failed
 * request on the way out cannot leave somebody signed in to a session they
 * asked to end.
 */

const KEY = 'atrium.token'

export function readToken(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeToken(token: string): void {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    /* A session that lasts until the tab closes is worse than one that lasts,
       and much better than not signing in at all. */
  }
}

export function clearToken(): void {
  writeToken('')
}
