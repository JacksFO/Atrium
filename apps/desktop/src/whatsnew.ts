/**
 * Whether to say what changed, and what to say.
 *
 * Asked for: a card on the first launch after an update, with what the update
 * was for. The words arrive with the update itself and are written down, so
 * the only question left is whether the copy on disk belongs to the version
 * now running - and that question is worth its own file, because "shows
 * exactly once" is the whole of the feature and the easy thing to get wrong.
 *
 * The rules, all of which have a way of going wrong quietly:
 *
 *   nothing saved            somebody who has never updated, which is most launches
 *   saved for this version   the one launch that should show it
 *   saved for another        an update that was downloaded and never installed,
 *                            or was installed over by a later one - stale either way
 *   saved with no words      a release with an empty body: nothing to interrupt for
 *
 * The caller deletes the file whatever this returns. A card nobody wants is a
 * small annoyance; a card that comes back every launch until somebody digs
 * out a JSON file is a bug people would actually complain about.
 */

export type Saved = { version?: unknown; notes?: unknown } | null | undefined

export type WhatsNew = { version: string; notes: string }

export function whatsNewFor(saved: Saved, running: string): WhatsNew | null {
  if (!saved || typeof saved !== 'object') return null

  const version = typeof saved.version === 'string' ? saved.version : ''
  const notes = typeof saved.notes === 'string' ? saved.notes : ''

  // Not the version these notes describe: stale, and not this launch's news.
  if (!version || version !== running) return null
  // A release with nothing written on it.
  if (!notes.trim()) return null

  return { version: running, notes }
}
