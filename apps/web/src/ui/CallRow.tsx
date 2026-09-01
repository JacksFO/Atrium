import { Icon } from './Icon'
import type { Message, User } from '../lib/wire'

/**
 * A call, in the conversation it happened in.
 *
 * Calls used to leave no trace here: somebody who was away had no way of
 * knowing anybody had rung, and the person who rang had no way of knowing
 * whether it had landed. This is the only place either of them will look.
 *
 * The server has written these rows all along — a `call` message, with when
 * it ended and whether it was ever picked up — and this client drew nothing
 * for them, so every call in a conversation was an empty line.
 *
 * Deliberately not shaped like a message. It is not something somebody said,
 * and dressing it as one — avatar, name, timestamp on its own line — gives a
 * single line of housekeeping the same weight as a paragraph.
 */

/**
 * How long it went on, in the words a person would use.
 *
 * Not a stopwatch. "A few seconds" is the honest reading of eleven seconds:
 * nobody wants to know a call was 00:11, they want to know it barely
 * happened.
 */
export function howLong(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 30) return 'a few seconds'
  if (seconds < 90) return 'about a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 1 && rest === 0) return 'an hour'
  if (rest === 0) return `${hours} hours`
  return `${hours}h ${rest}m`
}

/** What the line says, which is the whole of this component worth testing. */
export function callSaid(m: Message, who: string, mine: boolean): string {
  const missed = m.call_missed === 1
  const over = typeof m.call_ended_at === 'number' && m.call_ended_at !== null
  if (!over) {
    /* Still going. The person who started it reads "you", so it does not tell
       them somebody else is calling when it is them. */
    return `${who} started a call.`
  }
  /* The words people actually use, and the ones they scan for. */
  if (missed) return mine ? 'No answer.' : `Missed call from ${who}.`
  return `${who} started a call that lasted ${howLong((m.call_ended_at ?? 0) - m.created_at)}.`
}

export function CallRow({ message, author, me, canJoin, onJoin }: {
  message: Message
  author: User | undefined
  me: User
  /**
   * Whether there is still a call here to walk into.
   *
   * A call stays open for two minutes after somebody is left in it alone, so
   * this is exactly that window — and joining is offered rather than done,
   * which is the whole point: opening the app on a second device should not
   * drag you into a call nobody asked it to join.
   */
  canJoin?: boolean
  onJoin?: () => void
}) {
  const mine = message.author_id === me.id
  const missed = message.call_missed === 1
  const who = mine ? 'You' : (author?.display_name || author?.username || 'Somebody')
  const over = typeof message.call_ended_at === 'number' && message.call_ended_at !== null
  /*
   * Open, so there is a room to walk into.
   *
   * Not "open and answered": a call nobody has picked up yet is exactly the
   * one somebody needs a way into, and that is the whole of how a call is
   * answered here. `missed` only means anything once it is over, where it
   * becomes the word for what happened.
   */
  const joinable = !over && canJoin && onJoin

  const at = new Date(message.created_at).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className={`callrow${missed && over ? ' missed' : ''}${over ? '' : ' live'}`}>
      <span className="calli" aria-hidden>
        <Icon name={missed && over ? 'phoneoff' : 'phone'} size={15} />
      </span>
      <span className="calls">{callSaid(message, who, mine)}</span>
      <span className="callat">{at}</span>
      {/* Offered, never taken. Walking into a call has to be something a
          person did on purpose, on the device they meant to do it on. */}
      {joinable && (
        <button className="calljoin" onClick={onJoin}>Join call</button>
      )}
    </div>
  )
}
