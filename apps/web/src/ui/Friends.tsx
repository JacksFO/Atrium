import type { Friend } from '../lib/load'
import type { Id } from '../lib/wire'
import type { World } from '../lib/world'
import { AvatarWithStatus } from './Avatar'
import { Icon } from './Icon'

export type FriendTab = 'online' | 'all' | 'pending' | 'sent'

/**
 * Everybody you know, and everybody waiting on an answer.
 *
 * Somebody waiting on you and somebody you are waiting on are different
 * things to be looking at, and one list for both means the number on the tab
 * says nothing about whether there is anything to do.
 */
export function Friends({
  world, friends, tab, onTab, onOpenDm, onAccept, onRemove, onAdd, onWho, onNav, phone,
}: {
  world: World
  friends: readonly Friend[]
  /**
   * Which list is showing.
   *
   * Held outside rather than in here, because sending a request has to be
   * able to land you on Sent - the confirmation for a request is seeing it in
   * the list, and a dialog that stays open saying "Sent." is a dialog you
   * then have to close yourself to go and look.
   */
  tab: FriendTab
  onTab: (tab: FriendTab) => void
  onOpenDm: (id: Id) => void
  onAccept: (id: Id) => void
  /** Ignoring, taking a request back, and unfriending are one call. */
  onRemove: (id: Id) => void
  onAdd: () => void
  onWho: (id: Id, el: Element) => void
  onNav: () => void
  phone: boolean
}) {
  const accepted = friends.filter((f) => f.state === 'accepted')
  const incoming = friends.filter((f) => f.state === 'incoming')
  const sent = friends.filter((f) => f.state === 'outgoing')

  const shown = tab === 'online'
    ? accepted.filter((f) => world.presence.appearsHere(f.id))
    : tab === 'all' ? accepted
      : tab === 'pending' ? incoming
        : sent

  return (
    <div className="pane chatpane">
      <div className="chd">
        {phone && (
          <button className="navtog" onClick={onNav} aria-label="Channels">
            <Icon name="menu" size={20} />
          </button>
        )}
        <span className="tt t"><Icon name="people" size={20} /> Friends</span>
        <span style={{ display: 'flex', gap: 3, marginLeft: 12 }}>
          {([['online', 'Online'], ['all', 'All'], ['pending', 'Pending'],
            ['sent', 'Sent']] as const).map(([k, label]) => (
            <button key={k} className={tab === k ? 'ftab on' : 'ftab'}
              onClick={() => onTab(k)}>
              {label}
              {/* Only what is waiting on *you* gets the loud one. A count of
                  what you have sent is information; a count of what somebody
                  is waiting for from you is a thing to do. */}
              {k === 'pending' && incoming.length > 0 && (
                <span className="pill" style={{ marginLeft: 6 }}>{incoming.length}</span>
              )}
              {k === 'sent' && sent.length > 0 && (
                <span className="cnt2" style={{ marginLeft: 6 }}>{sent.length}</span>
              )}
            </button>
          ))}
        </span>
        <span className="gw" />
        <button className="btn p" onClick={onAdd}>
          <Icon name="addp" size={15} /> Add someone
        </button>
      </div>

      <div className="stream" style={{ padding: '18px 26px 20px' }}>
        {shown.length === 0 ? <Empty tab={tab} /> : shown.map((f) => (
          <Row
            key={f.id}
            friend={f}
            tab={tab}
            here={world.presence.appearsHere(f.id)}
            onOpenDm={() => onOpenDm(f.id)}
            onAccept={() => onAccept(f.id)}
            onRemove={() => onRemove(f.id)}
            onWho={(el) => onWho(f.id, el)}
          />
        ))}
      </div>
    </div>
  )
}

export function Row({ friend, tab, here, onOpenDm, onAccept, onRemove, onWho }: {
  friend: Friend
  tab: FriendTab
  here: boolean
  onOpenDm: () => void
  onAccept: () => void
  onRemove: () => void
  onWho: (el: Element) => void
}) {
  const name = friend.display_name || friend.username

  if (tab === 'pending') {
    return (
      <div className="frow">
        <AvatarWithStatus user={friend} size="lg" status={here ? 'online' : 'offline'} />
        <span className="ftx">
          <span className="fn">{name}</span>
          <span className="fa">Wants to be friends</span>
        </span>
        <span className="facts">
          <button className="btn p" onClick={onAccept}>Accept</button>
          <button className="btn" onClick={onRemove}>Ignore</button>
        </span>
      </div>
    )
  }

  if (tab === 'sent') {
    return (
      <div className="frow">
        <AvatarWithStatus user={friend} size="lg" status={here ? 'online' : 'offline'} />
        <span className="ftx">
          <span className="fn">{name}</span>
          <span className="fa">Waiting for them</span>
        </span>
        <span className="facts">
          <button className="btn d" onClick={onRemove}>Take it back</button>
        </span>
      </div>
    )
  }

  return (
    <button className="frow" onClick={onOpenDm}>
      <AvatarWithStatus user={friend} size="lg" status={here ? 'online' : 'offline'} />
      <span className="ftx">
        <span className="fn">{name}</span>
        <span className="fa">{here ? 'Online' : 'Offline'}</span>
      </span>
      <span className="facts">
        <span className="fic" title="Message"><Icon name="chat" size={17} /></span>
        <span
          className="fic"
          title="More"
          onClick={(e) => { e.stopPropagation(); onWho(e.currentTarget) }}
        >
          <Icon name="dots" size={17} />
        </span>
      </span>
    </button>
  )
}

/** What an empty list means, which is different on every tab. */
function Empty({ tab }: { tab: FriendTab }) {
  if (tab === 'pending') {
    return (
      <div className="fempty">
        <Icon name="addp" size={30} />
        <p>Nobody is waiting on you.</p>
        <span>Requests other people send you show up here.</span>
      </div>
    )
  }
  if (tab === 'sent') {
    return (
      <div className="fempty">
        <Icon name="addp" size={30} />
        <p>Nothing sent.</p>
        <span>
          Requests you send sit here until they answer, and you can take one
          back at any point.
        </span>
      </div>
    )
  }
  return (
    <div className="fempty">
      <Icon name="people" size={30} />
      <p>{tab === 'online' ? 'Nobody around.' : 'No friends yet.'}</p>
      <span>
        Add someone by their name — they get a request, and nothing is shared
        until they accept.
      </span>
    </div>
  )
}
