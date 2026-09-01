import { useEffect, useState } from 'react'
import { dismissToast, onToast, TOAST_MS, type Toast } from '../lib/toast'
import { Over } from './Over'

/**
 * Where the app says the small things.
 *
 * Over everything and out of the way at the bottom, because none of it is
 * worth pushing the app down for - the notices at the top are for things you
 * have to decide about, and this is for things that have already happened.
 */
export function Toasts() {
  const [live, setLive] = useState<Toast[]>([])
  useEffect(() => onToast(setLive), [])

  /*
   * One timer per line, restarted when its id changes. Saying the same thing
   * again gives it a new id on purpose, so the second save resets the clock
   * rather than the line vanishing mid-sentence because the first one's timer
   * was still running.
   */
  useEffect(() => {
    const timers = live.map((t) => setTimeout(() => dismissToast(t.id), TOAST_MS))
    return () => { for (const t of timers) clearTimeout(t) }
  }, [live])

  if (live.length === 0) return null
  return (
    <Over>
      <div className="toasts">
        {live.map((t) => (
          /* Pressable, for anybody who would rather it went now. */
          <button className="toast" key={t.id} onClick={() => dismissToast(t.id)}>
            {t.said}
          </button>
        ))}
      </div>
    </Over>
  )
}
