import { useCallback, useEffect, useRef, useState } from 'react'
import type { Gateway } from '../lib/gateway'
import type { Id } from '../lib/wire'

/** Nobody sends a "stopped typing", so a notice has to go out on its own. */
const LASTS = 5_000
/** One notice per this long while somebody keeps typing, not one per key. */
const EVERY = 2_000

/**
 * Who is typing, here.
 *
 * Three things went wrong with this in the old client and each of them is a
 * line below.
 *
 * It was filed under the *name* in the event rather than under the person, so
 * a name that did not arrive filed an empty one — a phantom typist nothing
 * could ever clear. Here it is keyed by id and the name is looked up when the
 * line is drawn, which also means somebody renaming themselves mid-sentence
 * does not appear twice.
 *
 * The channel was never checked, so somebody typing anywhere put a line above
 * whatever conversation you had open.
 *
 * And it only ever redrew when another event arrived, so the last person to
 * type before going quiet stayed there typing indefinitely.
 */
export function useTyping(gateway: Gateway | null, channelId: Id | null, meId: Id) {
  const [typing, setTyping] = useState<Map<Id, number>>(new Map())
  const sentAt = useRef(0)

  useEffect(() => {
    if (!gateway) return
    return gateway.on((e) => {
      if (e.t !== 'typing') return
      if (e.userId === meId) return
      if (e.channelId !== channelId) return
      setTyping((prev) => new Map(prev).set(e.userId, Date.now()))
    })
  }, [gateway, channelId, meId])

  /* Cleared when the conversation changes: who was typing in the last one is
     not news about this one. */
  useEffect(() => { setTyping(new Map()) }, [channelId])

  /* They expire on their own. The interval does nothing at all while nobody
     is shown as typing, which is nearly always. */
  useEffect(() => {
    if (typing.size === 0) return
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now()
        const next = new Map(prev)
        let changed = false
        for (const [id, at] of next) {
          if (now - at >= LASTS) { next.delete(id); changed = true }
        }
        return changed ? next : prev
      })
    }, 1_000)
    return () => clearInterval(t)
  }, [typing.size])

  /** Say that you are, at most every couple of seconds. */
  const iAmTyping = useCallback(() => {
    if (!gateway || !channelId) return
    const now = Date.now()
    if (now - sentAt.current < EVERY) return
    sentAt.current = now
    gateway.send({ t: 'typing', channelId })
  }, [gateway, channelId])

  return { typing: [...typing.keys()], iAmTyping }
}
