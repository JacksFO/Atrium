import { Icon } from './Icon'
import { badgeLabel } from '../lib/shell'

/**
 * A bar under the channel header saying what arrived while you were away.
 *
 * The list already draws a line where you came in, which is the right thing
 * once you are looking at the place it marks - but it is inside the list, so
 * a channel with forty new messages opens showing the end of them and the
 * line is somewhere above, off screen, with nothing saying it is there. The
 * count you actually want is the one you want before scrolling anywhere.
 *
 * So this sits between the header and the messages, always visible, and says
 * the two things the line cannot: how many, and since when. Pressing it goes
 * to the line; the button on the right clears the lot without going anywhere,
 * which is what somebody does when they know they do not care.
 */
export function NewSince({ count, since, onGo, onRead }: {
  /** How many arrived, captured when the channel was opened. */
  count: number
  /** When the last one was read, or null if that is not known. */
  since: number | null
  /** Take me to where I left off. */
  onGo: () => void
  /** I have seen enough - clear it. */
  onRead: () => void
}) {
  /*
   * Nothing at all when there is nothing new.
   *
   * Absent rather than empty: a bar that is always there, saying "0 new",
   * costs a strip of every channel for the case where there is nothing to
   * say. The list moves down when this appears, which is the honest signal
   * that something is being announced.
   */
  if (count < 1) return null

  /*
   * A time, not a date.
   *
   * Everything this is about happened while somebody was away from the app,
   * which is hours rather than weeks - and "since 14 March" reads as a
   * backlog nobody is going to catch up on. A day or more, and how long ago
   * stops being the useful part, so it says the day instead.
   */
  const when = since ? new Date(since) : null
  const clock = when && Date.now() - since! < 20 * 60 * 60_000
    ? when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : when?.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <div className="newsince">
      {/*
        * The whole strip is the way back, because that is what somebody is
        * reaching for - a small target beside a large inert bar is a button
        * to hunt for. The one on the right is the other decision, and has to
        * be its own control so pressing it does not also jump.
        */}
      <button className="newsince-go" onClick={onGo}>
        {/*
          * The same ceiling the badge uses, and for a better reason here.
          *
          * The server stops counting at a hundred, so a channel with five
          * hundred waiting reports a hundred - and "100 new messages" reads
          * as an exact number somebody could scroll back through. badgeLabel
          * already owns the rule that past ninety-nine it says how many
          * there roughly are, so this asks it rather than keeping a second
          * copy that could disagree with the badge in the rail.
          */}
        {count === 1 ? '1 new message' : `${badgeLabel(count)} new messages`}
        {clock ? ` since ${clock}` : ''}
      </button>
      <button className="newsince-read" onClick={onRead}>
        Mark as read <Icon name="check" size={13} />
      </button>
    </div>
  )
}
