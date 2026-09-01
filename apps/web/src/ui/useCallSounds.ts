import { useEffect, useRef } from 'react'
import type { Call } from '../lib/call'
import {
  playAnswered, playHangup, playShareStart, playShareStop,
  playSomeoneJoined, playSomeoneLeft, playVoiceJoin, playVoiceLeave,
  playWatchStart, playWatchStop,
} from '../lib/sound'

/**
 * What a call sounds like.
 *
 * Every one of these tones was written, tested and shipped in the original
 * build, came across whole with this module, and was played by nothing — so
 * the app had a complete set of sounds and made none of them.
 *
 * The placements are the original's, and so is the one rule that is easy to
 * get wrong: a conversation's call has its own sounds — ringing, answered,
 * hung up — and playing the room chimes over the top of those is two noises
 * for one thing. So a call between two people is left alone here.
 */
export function useCallSounds(call: Call, isCallRoom: (channelId: string | null) => boolean) {
  /* What was true last time, so this speaks about changes rather than about
     the state it happens to find. */
  const wasIn = useRef<string | null>(null)
  const wasHere = useRef<{ channel: string | null; who: Set<string> }>(
    { channel: null, who: new Set() },
  )
  const wasSharing = useRef<{ channel: string | null; who: Set<string> }>(
    { channel: null, who: new Set() },
  )
  const wasWatching = useRef<ReadonlySet<string>>(new Set<string>())

  /* You, arriving and leaving. */
  useEffect(() => {
    const now = call.channel
    const before = wasIn.current
    wasIn.current = now
    if (before === now) return
    if (isCallRoom(now ?? before)) return
    if (now) playVoiceJoin()
    else if (before) playVoiceLeave()
  }, [call.channel, isCallRoom])

  /*
   * Other people coming and going in the room you are in.
   *
   * Only once this room has been seen before, or walking into a room of six
   * plays six arrivals at once.
   */
  useEffect(() => {
    const mine = call.channel
    const who = new Set(call.members.map((m) => m.id))
    const before = wasHere.current
    wasHere.current = { channel: mine, who }
    if (!mine || before.channel !== mine) return
    if (isCallRoom(mine)) return
    if ([...who].some((id) => !before.who.has(id))) playSomeoneJoined()
    else if ([...before.who].some((id) => !who.has(id))) playSomeoneLeft()
  }, [call.members, call.channel, isCallRoom])

  /* Somebody putting a screen up, or taking one down. */
  useEffect(() => {
    const mine = call.channel
    const who = new Set(
      [...call.video.keys()].filter((k) => k.startsWith('share:')).map((k) => k.slice(6)),
    )
    const before = wasSharing.current
    wasSharing.current = { channel: mine, who }
    if (!mine || before.channel !== mine) return
    if ([...who].some((id) => !before.who.has(id))) playShareStart()
    else if ([...before.who].some((id) => !who.has(id))) playShareStop()
  }, [call.video, call.channel])

  /* And you choosing to watch one, or stopping. */
  useEffect(() => {
    const now = call.watching
    const before = wasWatching.current
    wasWatching.current = new Set<string>([...now])
    if (before.size === 0 && now.size === 0) return
    const has = (set: ReadonlySet<string>, k: string) => set.has(k as never)
    if ([...now].some((k) => !has(before, k))) playWatchStart()
    else if ([...before].some((k) => !has(now, k))) playWatchStop()
  }, [call.watching])
}

/** The two a conversation's call has instead, said out loud by whoever knows. */
export { playAnswered, playHangup }
