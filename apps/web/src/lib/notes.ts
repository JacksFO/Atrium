/**
 * Small changes, between releases.
 *
 * Most of what happens to this app never becomes a release: the server is
 * updated, or the client is rebuilt and served, and the version somebody is
 * running does not move. There is no release to hang those on, so without
 * this they go unsaid — and "nothing has changed since March" is not what the
 * changelog should say about a week of changes.
 *
 * Newest first. One line each, in the words somebody using the app would use
 * rather than the words the commit used: this says what is different for
 * them, not what was edited.
 */

export type Note = {
  /**
   * When it landed: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` where the time
   * matters - which is whenever more than one release goes out in a day.
   *
   * A day on its own is taken as the *start* of that day, which is the
   * earliest it could have been. A bare date cannot say which side of a
   * release published that afternoon it falls on, and guessing late would
   * file work under a version that had not shipped when it happened - so it
   * files under the version that was certainly current. New entries should
   * carry a time; the ones written before any of this did not have to.
   */
  at: string
  said: string
}

/** One of these as a moment, so it can be put beside a release. */
export function noteTime(at: string): number {
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(at.trim())
  const ms = Date.parse(bare ? `${at.trim()}T00:00:00` : at)
  return Number.isFinite(ms) ? ms : 0
}

export const NOTES: readonly Note[] = [
  { at: '2026-08-31T00:20', said: 'Voice activation works again. It was measuring the microphone it had just silenced, so it shut at the first quiet moment and stayed shut — nobody could hear you, and no ring appeared round anybody who was talking.' },
  { at: '2026-08-31T00:20', said: 'Deafening yourself says Deafened under your own face, rather than Muted.' },
  { at: '2026-08-30T23:40', said: 'A server can have a banner of its own, changed beside its icon in the server settings.' },
  { at: '2026-08-30T23:40', said: 'The button under the servers that marks everything read says Read all, instead of being a tick nobody could read.' },
  { at: '2026-08-29T16:50', said: 'The message box on somebody’s card no longer draws a box of its own inside the one around it.' },
  { at: '2026-08-29T16:45', said: 'Quitting the desktop app keeps it quit, instead of reopening itself when a waiting update would not install.' },
  { at: '2026-08-29T16:20', said: 'Spotify shows even while a browser is playing something — Windows only ever named one of them.' },
  { at: '2026-08-29T16:05', said: 'The member list says what somebody is playing or listening to, instead of what they wrote about themselves.' },
  { at: '2026-08-29T16:00', said: 'The home button comes back to what you were reading, rather than to the greeting.' },
  { at: '2026-08-29T15:05', said: 'A card says the servers and friends you actually share, not just the ones you had happened to open.' },
  { at: '2026-08-29T14:40', said: 'A server you have just made or joined arrives with its channels, rather than two empty headings.' },
  { at: '2026-08-29T14:10', said: 'Accepting a friend request opens the conversation for both of you, and names whoever asked.' },
  { at: '2026-08-29', said: 'The app is quicker to become usable after a reload, and every delete works again.' },
  { at: '2026-08-29', said: 'A server can be deleted by whoever made it, after typing its name.' },
  { at: '2026-08-29', said: 'Headings appear as soon as they are made, rather than whenever something else happened to refresh.' },
  { at: '2026-08-29', said: 'GIFs play as GIFs again, and the Reload button can be pressed anywhere on it.' },
  { at: '2026-08-29', said: 'A profile shows what you wrote about yourself under your name, and what you are playing on its own card.' },
  { at: '2026-08-29', said: 'Drag a file onto the app to attach it, videos and PDFs included, and picking a GIF sends it.' },
  { at: '2026-08-29', said: 'The Conversations button carries a badge, like every server already did.' },
  { at: '2026-08-29', said: 'You can make a server, or join one with a code — there was no way to do either.' },
  { at: '2026-08-29', said: 'The app can tell you a newer build is being served, which it could not before.' },
  { at: '2026-08-29', said: 'The desktop window can be moved by its own top bar again.' },
  { at: '2026-08-29', said: 'The order of your conversations survives a reload.' },
  { at: '2026-08-29', said: 'A call can be sent to a chosen speaker or headset, and the device menus read as menus rather than shouting.' },
  { at: '2026-08-29', said: 'Read all clears everything waiting where you are looking, and a status shows on a profile even when they are away.' },
  { at: '2026-08-29', said: 'A video plays where it was sent, instead of arriving as a broken picture, and anything else is offered as a file.' },
  { at: '2026-08-29', said: 'You can say something to somebody from their card, without going anywhere first.' },
  { at: '2026-08-29', said: 'A game or a track shows on somebody card with its picture, the artist, and where the track has got to.' },
  { at: '2026-08-29', said: 'Voice channels know who is in them again, and a call that everybody has left ends instead of offering to be joined.' },
  { at: '2026-08-29', said: 'A conversation moves to the top of the list when something is said in it.' },
  { at: '2026-08-29', said: 'Reading a channel clears its badge, in the list and on the taskbar icon.' },
  { at: '2026-08-29', said: 'The small changes here are gathered together, and the ones since your last visit are marked.' },
  { at: '2026-08-29', said: 'The home page says what was said while you were away, and how big this place is.' },
  { at: '2026-08-29', said: 'Calls leave a line in the conversation, with a way back in for two minutes.' },
  { at: '2026-08-29', said: 'Editing a message happens where the message is, rather than in the box at the bottom.' },
  { at: '2026-08-29', said: 'Servers, channels and categories can be dragged into a different order.' },
  { at: '2026-08-29', said: 'The app has its sounds back — arriving, leaving, sharing, and a call ringing.' },
  { at: '2026-08-29', said: 'What somebody is playing or listening to shows on their card and in the member list.' },
  { at: '2026-08-29', said: 'Typing @ offers people and roles, / offers commands, and : offers emoji.' },
  { at: '2026-08-29', said: 'A mention follows somebody through a rename, and opens them when pressed.' },
  { at: '2026-08-29', said: 'Right-clicking the message box gives copy, paste and formatting.' },
  { at: '2026-08-29', said: 'Links show a preview again, and pictures open at the size of the window.' },
  { at: '2026-08-29', said: 'The panels between columns can be dragged to resize.' },
]

/** The most recent few, for a card that has room for a handful. */
export const recentNotes = (most = 4): readonly Note[] => NOTES.slice(0, most)

/** A release, as much of one as filing a note against it needs. */
export type Published = { version: string; published: string }

/**
 * Which release each of these went out under.
 *
 * Asked for as: a release ships, then small changes trickle out and collect
 * in a box of their own; the next release ships and that box empties into the
 * one before it, leaving a fresh box for whatever comes next.
 *
 * So a note belongs to the release that was current when it landed - the
 * newest one published at or before it - and only the notes newer than every
 * release are still "since". Which is why they used to stay put: nothing
 * compared them to anything, so the same six sat under "Since" through three
 * releases in an afternoon, describing work those releases had carried.
 *
 * A note older than every release given here belongs to none of them; it goes
 * with the oldest, which is the only one it could have preceded on screen.
 */
export function fileNotes(
  releases: readonly Published[],
  notes: readonly Note[] = NOTES,
): { since: Note[]; byVersion: Record<string, Note[]> } {
  const byVersion: Record<string, Note[]> = {}
  if (releases.length === 0) return { since: [...notes], byVersion }

  /* Newest first, whatever order they arrived in. */
  const order = [...releases]
    .map((r) => ({ version: r.version, at: Date.parse(r.published) }))
    .filter((r) => Number.isFinite(r.at))
    .sort((a, b) => b.at - a.at)
  if (order.length === 0) return { since: [...notes], byVersion }

  const since: Note[] = []
  const oldest = order[order.length - 1]!

  for (const n of notes) {
    const at = noteTime(n.at)
    const carried = order.find((r) => r.at <= at)
    if (!carried) {
      /* Older than everything shown. */
      ;(byVersion[oldest.version] ??= []).push(n)
      continue
    }
    if (carried.version === order[0]!.version && at > order[0]!.at) {
      /* Newer than the newest release: still waiting for one. */
      since.push(n)
      continue
    }
    ;(byVersion[carried.version] ??= []).push(n)
  }

  return { since, byVersion }
}

/** Written the way a date is read, and left alone if it is not one. */
export function noteDay(at: string): string {
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return at
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/*
 * Which of these somebody has not seen yet.
 *
 * Marked against the newest note they had already been shown, by its own
 * words rather than by a date: several land on the same day, and a date can
 * only say "today", which would either mark all of them or none.
 *
 * Somebody arriving for the first time has no marker and is shown none as
 * new. Everything being new on a first visit is technically true and useless
 * - the tag means "since you were last here", and there is no last time.
 *
 * If the marker names a note that has since been trimmed off the end, nothing
 * is marked. Guessing would mean marking the whole list, which is the loud
 * way to be wrong about something nobody asked to be told twice.
 */
const SEEN = 'atrium.notes.seen'

function read(): string | null {
  try { return localStorage.getItem(SEEN) } catch { return null }
}

/** How many of the newest notes have arrived since they last looked. */
export function unseenCount(notes: readonly Note[] = NOTES): number {
  const marker = read()
  if (!marker) return 0
  const at = notes.findIndex((n) => n.said === marker)
  return at < 0 ? 0 : at
}

/**
 * Remember what they have now been shown.
 *
 * Called after the count is read, never before - doing it first would clear
 * the very thing being drawn.
 */
export function markNotesSeen(notes: readonly Note[] = NOTES): void {
  const newest = notes[0]
  if (!newest) return
  try { localStorage.setItem(SEEN, newest.said) } catch { /* private window */ }
}
