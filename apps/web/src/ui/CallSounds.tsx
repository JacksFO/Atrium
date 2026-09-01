import { useEffect, useRef } from 'react'
import { audible, volumeOf, type Call } from '../lib/call'
import type { Id } from '../lib/wire'

/**
 * Every sound in the call, as elements React owns.
 *
 * This is the whole fix for a class of bug the old client kept hitting. There,
 * a sound was an <audio> put into the document by hand and found again later
 * by an id built from the person and the kind — "a7" for a voice, "sa7" for
 * the sound of what they were sharing. Four separate places went looking with
 * a selector that guessed at how those ids were spelled, and each guess was
 * wrong about one of the two kinds: stopping a share deleted the sharer's
 * *voice*, deafening left everybody's game playing, and a share's element was
 * never removed at all.
 *
 * Here the map is the truth and the elements are drawn from it. A sound that
 * leaves the map leaves the page, because React takes it away — there is no
 * lookup to get wrong, and no fifth place that could forget.
 *
 * They are here rather than on a tile on purpose: a tile that scrolls out of
 * view, or a stage somebody has closed, would take the sound with it.
 */
export function CallSounds({ call, master, me, sink }: {
  call: Call
  /** The one in settings, 0–100. Voices only — a share is set on its tile. */
  master: number
  me: Id
  /** Which output to play through, or '' for whatever the machine uses. */
  sink: string
}) {
  return (
    <>
      {[...call.sounds].map(([key, stream]) => (
        <Sound
          key={key}
          stream={stream}
          muted={!audible(call, key, me)}
          volume={volumeOf(call, key, master)}
          sink={sink}
        />
      ))}
    </>
  )
}

function Sound({ stream, muted, volume, sink }: {
  stream: MediaStream
  muted: boolean
  volume: number
  /** Which output to play through, or '' for whatever the machine uses. */
  sink: string
}) {
  const el = useRef<HTMLAudioElement>(null)

  /* srcObject is not an attribute, so React cannot set it — it has to be
     assigned to the element. Written only when it changes: assigning the same
     stream again restarts playback, which sounds like a stutter every time
     anything else in the call re-renders. */
  useEffect(() => {
    const a = el.current
    if (a && a.srcObject !== stream) a.srcObject = stream
  }, [stream])

  /* Likewise volume, which is a property rather than an attribute. */
  useEffect(() => {
    if (el.current) el.current.volume = volume
  }, [volume])

  /*
   * Which output it comes out of.
   *
   * setSinkId is not everywhere - Firefox does not have it without a flag -
   * so this is attempted and its refusal ignored. Somebody on a browser
   * without it keeps hearing the call through whatever the machine is using,
   * which is what they had before there was a choice.
   */
  useEffect(() => {
    const a = el.current as (HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>
    }) | null
    if (!a?.setSinkId) return
    void a.setSinkId(sink).catch(() => {
      /* Refused, or the device has gone. Nothing to say: it is still playing
         somewhere, which is the part that matters. */
    })
  }, [sink])

  return <audio ref={el} autoPlay muted={muted} />
}
