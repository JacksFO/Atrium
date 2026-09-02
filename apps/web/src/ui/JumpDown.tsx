import { Icon } from './Icon'
import { badgeLabel } from '../lib/shell'

/**
 * The way back to the newest message, once somebody has scrolled away.
 *
 * The conversation follows along while you are at the end and lets go the
 * moment you go up - which is right, and leaves you with no way back but
 * scrolling. In a channel with a few thousand messages loaded that is a long
 * way to drag, and there was nothing on screen saying how far.
 *
 * So this appears when the reader has let go, and puts them back. It also
 * says how many arrived while they were up there, because the useful question
 * is not "where is the end" but "how much have I missed" - and if the answer
 * is none, the bar says only that there is an end to go to.
 *
 * Not the same thing as the bar at the top. That one is about what was missed
 * while somebody was away from the channel entirely, is captured on the way
 * in, and clears by being read. This is about where the reader is standing
 * right now, and goes as soon as they come back down.
 */
export function JumpDown({ show, count, onGo }: {
  /** Whether the reader has let go of the end. */
  show: boolean
  /** How many have arrived since they let go. */
  count: number
  /** Put me back at the newest message. */
  onGo: () => void
}) {
  if (!show) return null

  return (
    /*
     * The strip takes no clicks itself, only the control in it: it lies over
     * the last line or two of the conversation, and a transparent band that
     * swallowed presses meant for a message would be worse than not being
     * there at all.
     */
    <div className="jumpdown">
      <button className="jumpdown-go" onClick={onGo}>
        <span>
          {count > 0
            ? `${badgeLabel(count)} new ${count === 1 ? 'message' : 'messages'}`
            : 'Jump to present'}
        </span>
        {/* The chevron the rest of the app uses, turned to point down -
            four other places do the same rather than keep a second glyph
            that differs only in which way it faces. */}
        <Icon name="chev" size={14} />
      </button>
    </div>
  )
}
