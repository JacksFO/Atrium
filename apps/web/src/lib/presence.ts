import type { Id, Presence, User } from './wire'

/**
 * Who is here, and which kind of here they are.
 *
 * Two facts, and reading one as the other is what cost most of a day. They
 * are kept apart on purpose:
 *
 *   whether somebody has a socket open is a fact about the network, and the
 *   server answers it with `online: boolean` and with the `online` list in
 *   the ready frame;
 *
 *   what they have chosen to appear as is a fact about them, and lives on
 *   their row as `presence`.
 *
 * The old client had one function that took both and a second that took the
 * map, and they disagreed: every Away or Busy member of every server was
 * drawn correctly for one frame and then turned plain Online, on every
 * reload. One answer cannot disagree with itself, so there is one here.
 */

/** What the screen calls each of the server's four words. */
export type Status = 'online' | 'away' | 'busy' | 'offline'

const IN: Record<Presence, Status> = {
  online: 'online',
  idle: 'away',
  dnd: 'busy',
  offline: 'offline',
}
const OUT: Record<Status, Presence> = {
  online: 'online',
  away: 'idle',
  busy: 'dnd',
  offline: 'offline',
}

/** Their word, in ours. Anything unrecognised is somebody being here. */
export const statusOf = (p: Presence | undefined): Status =>
  (p && IN[p]) || 'online'

/** Ours, in theirs — for saying how you wish to appear. */
export const presenceOf = (s: Status): Presence => OUT[s]

/**
 * Everybody who is here, and how they appear, from the two things that decide
 * it. A person the roster knows nothing about is still here if they have a
 * socket: not knowing what they chose is not a reason to say they are gone.
 */
export class Presences {
  /** Who has a socket open. Ids only — this says nothing about how they look. */
  private here = new Set<Id>()
  /** What each has chosen. Absent until somebody's row has been seen. */
  private chose = new Map<Id, Presence>()

  /** The list the ready frame opens with, replacing whatever was known. */
  replaceHere(ids: readonly Id[]): void {
    this.here = new Set(ids)
  }

  /** One person arriving or leaving, from a presence event. */
  setHere(id: Id, online: boolean): void {
    if (online) this.here.add(id)
    else this.here.delete(id)
  }

  /**
   * Somebody's row, from wherever it came — the ready frame, a roster, a
   * profile update. Every source is welcome, and the newest wins, which is
   * why the caller must feed the oldest first: a snapshot of yourself from
   * sign-in applied after a fresh roster is how your own name flickered.
   */
  remember(u: Pick<User, 'id' | 'presence'>): void {
    if (u.presence) this.chose.set(u.id, u.presence)
  }

  /** Whether they are here at all. */
  isHere(id: Id): boolean {
    return this.here.has(id)
  }

  /** The one answer: what to draw under this person's name. */
  statusFor(id: Id): Status {
    if (!this.here.has(id)) return 'offline'
    return statusOf(this.chose.get(id))
  }

  /** The same answer for everybody at once, for anything drawing a list. */
  all(): Map<Id, Status> {
    const out = new Map<Id, Status>()
    for (const id of this.here) out.set(id, statusOf(this.chose.get(id)))
    return out
  }
}
