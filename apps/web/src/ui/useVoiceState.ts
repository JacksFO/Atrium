import { useEffect, useRef } from 'react'
import type { Call } from '../lib/call'
import type { Id } from '../lib/wire'

/**
 * Telling the server where you are in voice, and what you are doing there.
 *
 * The gateway keeps one map of who is in which room, and it is filled by
 * these three frames and nothing else. The React port sent none of them, so
 * as far as the server was concerned nobody was ever in a voice channel: the
 * rooms said "Nobody in here" with people sitting in them, a screen share
 * reached nobody because the two ends were never known to be in a room
 * together, and a call in a conversation could never end - the count of
 * people in it was zero before anybody joined and zero after, so the two
 * minute clock had nothing to run out on and "Join call" stayed for ever.
 *
 * The original client sent all three, from the view that owned the call. This
 * is that, as a hook, so the frames follow the state rather than being
 * remembered at each of the places that change it.
 *
 * Leaving is announced rather than left to the socket closing. Without it the
 * server only drops somebody when their connection goes, so walking out of a
 * room leaves your avatar sitting in it for everybody else until you reload.
 */
export function useVoiceState(
  call: Call,
  meId: Id,
  send: (frame: Record<string, unknown>) => void,
) {
  /*
   * Whether a screen or a camera is going comes from the media server's own
   * roster rather than from anything set here. That is the honest source: it
   * is what is actually being published, and a flag kept alongside it would
   * be a second answer that can disagree with the first.
   */
  const mine = call.members.find((m) => m.id === meId)
  const sharing = !!mine?.sharing
  const camera = !!mine?.cam
  /* What the server was last told, so nothing is sent that says nothing. A
     re-render is not news. */
  const told = useRef<string | null>(null)
  const inRoom = useRef<Id | null>(null)

  useEffect(() => {
    const here = call.channel

    /* Left, or never in one. Said out loud, once. */
    if (!here) {
      if (inRoom.current !== null) {
        inRoom.current = null
        told.current = null
        send({ t: 'voice-leave' })
      }
      return
    }

    /*
     * Arriving, or moving. A move is a join of the new room - the server
     * treats a second join as a move and keeps what it can, which is why
     * there is no leave in front of it: a leave would empty the room for a
     * moment and end a call that is still happening.
     */
    if (inRoom.current !== here) {
      inRoom.current = here
      told.current = null
      send({
        t: 'voice-join',
        channelId: here,
        muted: call.muted,
        deafened: call.deaf,
      })
    }

    /* And what has changed about being there. Compared as one string so a
       render that changed nothing sends nothing. */
    const now = [call.muted, call.deaf, sharing, camera].join(',')
    if (told.current === now) return
    told.current = now
    send({
      t: 'voice-update',
      muted: call.muted,
      deafened: call.deaf,
      sharing,
      camera,
    })
  }, [call.channel, call.muted, call.deaf, sharing, camera, send])
}
