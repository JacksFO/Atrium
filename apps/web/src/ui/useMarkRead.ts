import { useEffect, useState } from 'react'
import { isWatching, onAttentionChange } from '../lib/attention'
import { readFrame } from '../lib/actions'
import type { Id } from '../lib/wire'

/**
 * Saying that a channel has been read.
 *
 * The frame existed, the server has always handled it, and nothing ever sent
 * one - so opening a conversation and reading it changed nothing anywhere.
 * The count stayed on the channel, the dot stayed beside its name, and the
 * number stayed on the taskbar icon until something else happened to clear
 * it. Reported as reading a message and the notification staying put, which
 * is exactly what it was.
 *
 * Two conditions, and both matter. The channel has to be open, and the window
 * has to be being looked at: a conversation sitting open on a second monitor
 * while somebody is in a game has not been read, and marking it read there
 * loses the one thing that would have told them about it.
 *
 * Sent when there is something to clear, and once when a channel is opened
 * with nothing waiting - so a busy channel is one frame per message that
 * arrives while you are watching it, not one per anything at all.
 *
 * That last case is not housekeeping. The server keeps when each channel was
 * last read and works the badges out from it, and a channel that has never
 * been marked read has no such time - so it counted nothing as unread there,
 * deliberately, or a new member would arrive to a thousand. Only sending when
 * something was already waiting meant a channel somebody reads every day
 * never got a time at all: the badge was drawn from the client's own tally
 * and vanished on reload, and the line saying where you got up to had nothing
 * to be worked out from.
 */
export function useMarkRead(
  openId: Id | null,
  waiting: number,
  send: (frame: ReturnType<typeof readFrame>) => void,
) {
  /* Attention is not React state, so it is brought in as some - otherwise
     coming back to the window would not re-run the effect below. */
  const [watching, setWatching] = useState(() => isWatching())
  useEffect(() => onAttentionChange(setWatching), [])

  useEffect(() => {
    if (!openId || !watching) return
    send(readFrame(openId))
  }, [openId, waiting, watching, send])
}
