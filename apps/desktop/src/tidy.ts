/**
 * Clearing up after an update, in the apps that took it.
 *
 * Asked for directly: if somebody already downloaded an old build, can a new
 * one take the leftovers away? It can, and it is worth doing - measured on
 * one machine, the updater's cache held 298 MB:
 *
 *   Atrium-Setup-0.2.24.exe   99.7 MB   today's, in use
 *   installer.exe                99.7 MB   the same file under the name
 *                                          electron-updater installs from
 *   package.7z                   99.1 MB   left from an update two days
 *                                          earlier, and never wanted again
 *
 * A third of a gigabyte, on every friend's PC, for one app they use to talk.
 * The installers are not small and there is no reason to keep the old ones.
 *
 * The rule is deliberately timid, because this is somebody else's disk and
 * the folder belongs to the updater rather than to us. Nothing is removed
 * while an update is in flight, nothing recent is removed at all, and any
 * file that will not delete is left exactly where it is. Getting this wrong
 * means breaking an update; getting it too cautiously right means a few
 * hundred megabytes sit there a week longer.
 */

/** What is known about a file without opening it. */
export type Leftover = { name: string; modified: number; bytes: number }

/**
 * How long something has to have been untouched before it is rubbish.
 *
 * A week. Long enough that an update downloaded and not yet installed - the
 * app was closed before restarting, and reopened days later - is still there
 * to install from, and short enough that nothing lingers for a month.
 */
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The updater's own bookkeeping, which is small and not ours to judge.
 *
 * These are how it knows what it has already fetched, so removing them makes
 * it download from the beginning rather than continuing. They are kilobytes.
 */
const ITS_OWN = /^(update-info\.json|.*\.blockmap|.*\.yml)$/i

/**
 * What may be deleted from the updater's cache.
 *
 * Returns the names, largest first, so the caller can log what it did in a
 * useful order.
 */
export function whatToTidy(
  files: readonly Leftover[],
  now: number,
  /** Do nothing at all while something is being downloaded or waiting to install. */
  busy: boolean,
): Leftover[] {
  if (busy) return []

  return files
    .filter((f) => !ITS_OWN.test(f.name))
    // Anything touched recently might be the update about to be installed.
    .filter((f) => now - f.modified > STALE_AFTER_MS)
    // Only things big enough to be worth the risk of touching at all.
    .filter((f) => f.bytes > 1024 * 1024)
    .sort((a, b) => b.bytes - a.bytes)
}

/** For saying what was freed, in a way a person reads. */
export function humanBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} bytes`
}
