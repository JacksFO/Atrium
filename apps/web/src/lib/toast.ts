/**
 * A line that appears, says one thing, and goes.
 *
 * For work that finished quietly. Saving a setting had nothing to show for
 * itself except the field keeping the value you typed, which is also exactly
 * what a save that silently failed looks like.
 *
 * Not for failures. A refusal has to stay on screen next to the thing that
 * was refused - something that fades after two seconds is the app mentioning
 * in passing that it did not do what you asked.
 */

export type Toast = { id: number; said: string }

type Listener = (toasts: Toast[]) => void

let live: Toast[] = []
let listeners: Listener[] = []
let next = 1

/** How long one stays. Long enough to read six words, short enough to ignore. */
export const TOAST_MS = 2600

export function onToast(f: Listener): () => void {
  listeners.push(f)
  f(live)
  return () => { listeners = listeners.filter((l) => l !== f) }
}

function tell(): void {
  for (const l of listeners) l(live)
}

/**
 * Say something, once.
 *
 * The same words already showing are refreshed rather than stacked: saving
 * three fields in a row is three saves and one thing worth saying, and a
 * column of identical lines says nothing the first one did not.
 */
export function toast(said: string): void {
  const already = live.find((t) => t.said === said)
  if (already) {
    live = live.filter((t) => t !== already).concat({ ...already, id: next++ })
  } else {
    live = live.concat({ id: next++, said })
  }
  tell()
}

export function dismissToast(id: number): void {
  live = live.filter((t) => t.id !== id)
  tell()
}

/** For tests, which must not inherit the last one's leftovers. */
export function clearToasts(): void {
  live = []
  listeners = []
  next = 1
}
