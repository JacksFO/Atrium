import type { Conversation } from '../lib/dms'
import type { Id } from '../lib/wire'
import type { World } from '../lib/world'
import { ago, whatWaits } from '../lib/waiting'
import { Icon } from './Icon'

/**
 * What was said while you were away.
 *
 * The home page said it answered this in its own doc comment and drew a grid
 * of the same conversations already listed down the left instead - which
 * answers a question nobody standing on the home page is asking, and took the
 * width to do it.
 *
 * Nothing is fetched. The server counts what is waiting at sign-in and says
 * which of it has your name in it; the socket keeps both in step. This is
 * arranging what is already held.
 */
export function WhileAway({ world, chats, onOpen }: {
  world: World
  chats: readonly Conversation[]
  onOpen: (id: Id) => void
}) {
  const waiting = whatWaits(world, chats)
  if (waiting.length === 0) return null

  const named = waiting.filter((r) => r.named).length
  const total = waiting.reduce((n, r) => n + r.count, 0)

  return (
    <div className="card away">
      <div className="away-head">
        <h4>While you were away</h4>
        <span className="gw" />
        {/* Said once, at the top, rather than made of the rows underneath -
            which are capped, so counting them would understate it. */}
        <span className="away-sum">
          {total} {total === 1 ? 'message' : 'messages'}
          {named > 0 && <b> · {named} for you</b>}
        </span>
      </div>

      <div className="away-rows">
        {waiting.map((r) => (
          <button className={r.named ? 'away-row you' : 'away-row'} key={r.id}
            onClick={() => onOpen(r.id)}>
            <span className="away-ic">
              <Icon name={r.kind === 'dm' ? 'chat' : 'hash'} size={15} />
            </span>
            <span className="away-txt">
              <span className="away-where">{r.where}</span>
              {/* Which server, only where there is one to say. A conversation
                  is not in a server and would get an empty line. */}
              {r.space && <span className="away-space">{r.space}</span>}
            </span>
            {r.named && <span className="away-tag">Named you</span>}
            <span className="away-when">{ago(r.at)}</span>
            <span className="away-n">{r.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
