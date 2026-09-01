/**
 * Whether the page in this tab is still the page on the server.
 *
 * A deploy replaces the folder the server reads from, and anybody who
 * already has the app open goes on running what they loaded — for days, if
 * they never close the tab. So the build says which one it is, and this asks
 * the server whether that is still the current one.
 *
 * Compared by build rather than by version: two builds of the same version
 * are two different pages, and the question is whether this exact one is
 * still what is being served.
 */

/** How often to ask. Rare enough to be free, often enough to matter. */
export const EVERY_MS = 5 * 60_000

export function isStale(mine: string, theirs: unknown): boolean {
  if (!mine) return false
  if (typeof theirs !== 'string' || !theirs) return false
  return theirs !== mine
}

/**
 * The build this page was made from, written into it at deploy time.
 *
 * Absent in development, where every reload is a different build and saying
 * so on each one would be a banner that never goes away.
 */
export function runningBuild(): string {
  const el = typeof document === 'undefined'
    ? null
    : document.querySelector('meta[name="build"]')
  return el?.getAttribute('content') ?? ''
}
