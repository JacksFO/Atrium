import { Icon } from './Icon'
import type { Poll } from '../lib/wire'

/**
 * A question in the conversation, and the answers to it.
 *
 * The numbers are always on, before and after answering. Hiding them until
 * somebody takes part turns a question into a toll gate: everybody who only
 * wanted the answer picks something to get past it, which makes the number
 * they were curious about wrong.
 */

/** How long is left, in the words somebody would use. */
export function timeLeft(closesAt: number, now = Date.now()): string {
  const ms = closesAt - now
  if (ms <= 0) return 'Closed'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'Closing now'
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h left`
  const days = Math.round(hours / 24)
  return `${days}d left`
}

export function PollCard({ poll, onVote, asked }: {
  poll: Poll
  /** The whole answer, not one option toggled — see the route. */
  onVote?: (picked: number[]) => void
  /**
   * Who asked it.
   *
   * The message header above already says, but a poll is often the second
   * thing somebody posts in a row and then there is no header at all - the
   * card floats in the conversation with no author on it. Saying it on the
   * card costs a line and is true wherever the card ends up.
   */
  asked?: string
}) {
  const mine = poll.options.filter((o) => o.mine).map((o) => o.idx)
  /* The one in front, so it can be marked. Nothing is in front at nought. */
  const lead = Math.max(...poll.options.map((o) => o.votes), 0)
  const shut = poll.closed || !onVote

  const pick = (idx: number) => {
    if (shut || !onVote) return
    if (!poll.multi) {
      /* Picking what you already picked takes it back, which is the only way
         to change your mind to nothing in a question that takes one answer. */
      onVote(mine.includes(idx) ? [] : [idx])
      return
    }
    onVote(mine.includes(idx) ? mine.filter((i) => i !== idx) : [...mine, idx])
  }

  return (
    <div className={poll.closed ? 'poll shut' : 'poll'}>
      <div className="ph2">
        <span className="q">{poll.question}</span>
        <span className="tag2">
          {poll.closed ? 'Closed' : poll.multi ? 'Pick any' : 'Pick one'}
        </span>
      </div>

      <div className="popts">
        {poll.options.map((o) => (
          <button
            key={o.idx}
            className={[
              'popt',
              o.mine ? 'mine' : '',
              o.votes > 0 && o.votes === lead ? 'lead' : '',
            ].filter(Boolean).join(' ')}
            disabled={shut}
            onClick={() => pick(o.idx)}
          >
            {/* The bar is the picture of the number beside it, so it is drawn
                behind the words rather than beside them — a row of bars in
                their own column is a chart nobody asked for. */}
            <span className="bar" style={{ width: `${o.share}%` }} />
            <span className="tick">{o.mine && <Icon name="check" size={13} />}</span>
            <span className="tx2">{o.text}</span>
            <span className="pct">{o.share}%</span>
            <span className="cnt3">{o.votes}</span>
          </button>
        ))}
      </div>

      <div className="pft">
        {asked && <span className="pby">Asked by <b>{asked}</b></span>}
        {asked && <span className="dot2" />}
        <span>
          {poll.voters} {poll.voters === 1 ? 'person has' : 'people have'} answered
        </span>
        {mine.length > 0 && !poll.closed && (
          <>
            <span className="dot2" />
            <span>your answer is saved</span>
          </>
        )}
        <span className="gw" />
        {poll.closesAt !== null && (
          <span className="lab">{timeLeft(poll.closesAt)}</span>
        )}
      </div>
    </div>
  )
}
