/*
 * Kept on this machine, and only for a couple of minutes.
 *
 * Its own small wrapper rather than a shared one, because everything it
 * stores is worthless the moment it cannot be read: a resume that throws in
 * a private window should be no resume, not an error.
 */
const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value) } catch { /* private window */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key) } catch { /* private window */ }
  },
}

/**
 * What to put back after a reload.
 *
 * Updating the web app means reloading the page, and reloading the page drops
 * you out of voice. That is a rotten way to ship an update to people who are
 * mid-conversation, so the channel is remembered on the way out and rejoined
 * on the way in.
 *
 * Deliberately short-lived. Rejoining a call from an hour ago because a tab
 * was left open is worse than not rejoining at all - the point is to survive
 * a reload, not to follow you around.
 */

const KEY = 'atrium.voice.resume'
const MAX_AGE_MS = 2 * 60_000

type Resume = {
  channelId: string; at: number; muted: boolean; deafened: boolean
  /**
   * Whether a screen was being shared, and which one.
   *
   * Absent when it was not. A string is the source the desktop shell was
   * capturing, so the same window can come back without asking again; null
   * is "was sharing, but nothing here can say what" - a browser, where the
   * picker belongs to the browser and never tells the page what was picked.
   *
   * A capture does not survive the page that owns it and cannot be started
   * again without somebody pressing something: a page that could silently
   * re-capture your screen after a reload could do it after a reload it
   * caused. So this is the offer of one press, not a resume.
   */
  share?: string | null
  /**
   * Which tab wrote it.
   *
   * Storage is shared by every tab on this origin, so a note left by one was
   * read by all of them - open a second one within two minutes and it joined
   * a call it had never been in. The id is per page load, so only the session
   * that was actually in the call is put back into it.
   */
  sessionId: string
}

/**
 * This page load, distinctly.
 *
 * sessionStorage rather than localStorage on purpose: it is per tab, which is
 * exactly the granularity a resume needs.
 */
let mySession: string | null = null
export function sessionId(): string {
  if (mySession) return mySession
  try {
    const held = sessionStorage.getItem('atrium.session')
    if (held) { mySession = held; return held }
    const made = Math.random().toString(36).slice(2) + Date.now().toString(36)
    sessionStorage.setItem('atrium.session', made)
    mySession = made
    return made
  } catch {
    mySession = 'no-storage'
    return mySession
  }
}

export function rememberVoice(
  channelId: string, muted: boolean, deafened: boolean, share?: string | null,
): void {
  const value: Resume = {
    channelId, at: Date.now(), muted, deafened, sessionId: sessionId(),
    ...(share === undefined ? {} : { share }),
  }
  storage.set(KEY, JSON.stringify(value))
}

/** Called when someone deliberately leaves, so they are not dragged back in. */
export function forgetVoice(): void {
  storage.remove(KEY)
}

/** The channel to rejoin, if the page was reloaded moments ago. */
export function voiceToResume(): Resume | null {
  try {
    const raw = storage.get(KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Resume
    if (!value?.channelId) return null
    /*
     * Only the tab that was actually in the call comes back to it.
     *
     * Storage is shared by every tab on this origin, so a note left by one
     * was read by all of them: open the app somewhere else within two minutes
     * and it walked into a call nobody had asked it to join. Leave it on the
     * desktop, open the browser, and you were back in from the wrong device.
     *
     * Strictly, including a note with no session on it at all — anything
     * unstamped is from before this existed, and letting those through is
     * letting through exactly the case this is for.
     */
    if (value.sessionId !== sessionId()) return null
    if (Date.now() - value.at > MAX_AGE_MS) {
      storage.remove(KEY)
      return null
    }
    return value
  } catch {
    return null
  }
}

/**
 * Keep the timestamp fresh while a call is in progress.
 *
 * Without this a two-hour call would look stale the moment it ended, and the
 * reload after an update would not rejoin.
 */
export function keepVoiceFresh(
  channelId: string, muted: boolean, deafened: boolean, share?: string | null,
): void {
  rememberVoice(channelId, muted, deafened, share)
}

/**
 * Which source the desktop shell is capturing.
 *
 * Held here rather than in the call, because the only thing that knows it is
 * the picker - the shell hands the page a list, the page answers with an id,
 * and the stream that comes back says nothing about where it came from.
 * Nothing in a browser ever sets this: its picker is the browser's own and
 * the page is never told what was chosen.
 */
let source: string | null = null
export const shareSource = (): string | null => source
export const rememberShareSource = (id: string | null): void => { source = id }

/**
 * A share waiting to be put back, once somebody presses something.
 *
 * Read once and cleared, by the picker: with this set it answers the shell
 * with the remembered source instead of asking again, so resuming is one
 * press rather than one press and the same choice a second time.
 */
let intended: string | null = null
export const intendToResume = (id: string | null): void => { intended = id }
export function takeResumeIntent(): string | null {
  const held = intended
  intended = null
  return held
}
