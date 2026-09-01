import { useEffect, useRef, useState } from 'react'
import { isWatching, onAttentionChange } from '../lib/attention'
import { orderedActivities, stamp, type Heard } from '../lib/activity'
import type { Activity } from '../lib/wire'

/**
 * Activities with the moment each was first heard about, kept ticking.
 *
 * A track's position is where the player said it was, plus however long ago
 * it said so - so something has to remember when it said, and something has
 * to redraw while the number moves. Both existed in lib/activity.ts and
 * neither was ever called, so a progress bar sat exactly where the last
 * report left it and an elapsed time never elapsed.
 *
 * The moment is kept per activity rather than per card: closing a profile and
 * opening it again would otherwise start the count from nothing and show 0:00
 * forty seconds into a song. The same track still playing keeps the moment it
 * was first heard, so a game starting beside it does not reset the bar.
 *
 * Nothing ticks while the window is not being looked at. A second is a cheap
 * interval and a profile nobody can see is a free one.
 */
export function useHeard(activities: readonly Activity[] | undefined): {
  heard: Heard[]
  /** How long since each was heard, for the bar and the clock. */
  ran: number
} {
  const held = useRef<Heard[]>([])
  const [, tick] = useState(0)
  const [watching, setWatching] = useState(() => isWatching())

  /* Ordered before stamping, so game is always above music and the moment
     each was first heard travels with it. */
  held.current = stamp(orderedActivities(activities), held.current)

  useEffect(() => onAttentionChange(setWatching), [])

  useEffect(() => {
    if (!watching || held.current.length === 0) return
    const timer = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [watching, activities])

  const first = held.current[0]
  return { heard: held.current, ran: first ? Date.now() - first.heardAt : 0 }
}
