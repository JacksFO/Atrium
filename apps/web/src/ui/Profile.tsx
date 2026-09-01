import { statusOf } from '../lib/status'
import { useState } from 'react'
import { useMutual } from './useMutual'
import type { Api } from '../lib/api'
import { ActivityCards } from './Activity'
import { useHeard } from './useHeard'
import { Still } from './Still'
import { nameLook } from '../lib/nameStyle'
import { nameIn } from '../lib/names'
import { nameColourFrom, roleColour, rolesOf } from '../lib/roles'
import type { Activity, Id, Space, User } from '../lib/wire'
import type { World } from '../lib/world'
import { AvatarWithStatus, seedOf } from './Avatar'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { Scene } from './Scene'
import { useAnchored, type Anchor } from './useAnchored'
import { useEscape } from './useEscape'

/**
 * Somebody's card.
 *
 * The face and who it belongs to share a line. They were three stacked
 * full-width rows — the avatar, then the name, then the handle — which is
 * what made a profile read as a column rather than a card, and it was
 * reported as "very vertical".
 *
 * Mutual servers are not offered on your own. It is a fact about two people
 * and there is only one here: every server you are in is trivially one you
 * share with yourself, which is a list of everything you already know under a
 * heading that is not true of it.
 */
export function Profile({
  user, server, world, space, anchor, phone, activities, onClose, onSay, onEdit,
  onOpenVoice,
}: {
  user: User
  /** To ask what the two of you have in common. */
  server: Api
  world: World
  space: Space | null
  anchor: Anchor | null
  phone: boolean
  activities: Activity[]
  onClose: () => void
  /**
   * Say something to them from here.
   *
   * The card is where you decide to say something, so it is where you can
   * say it - rather than a button that takes you somewhere else to start
   * typing, which loses the sentence you already had in your head.
   *
   * Absent for your own card, and where there is nothing to send with.
   */
  onSay?: (body: string) => Promise<void>
  /** Open the screen where your own name, picture and bio are changed. */
  onEdit?: () => void
  /**
   * Go and stand where they are standing.
   *
   * Absent rather than dead where it would do nothing - your own card, or a
   * room you are already in - so the button is never there to be pressed for
   * no effect. Shell decides that, because only Shell knows which call this
   * account is in.
   */
  onOpenVoice?: (channelId: Id) => void
}) {
  const { ref, at } = useAnchored(anchor, phone)
  const mine = user.id === world.me.id
  /* Their own decision about their own attention - so it is read from
     this account's list, not asked of the server per card. */
  const blocked = world.blocked.has(user.id)
  /* Escape shuts it. A card that can only be dismissed by clicking past it
     is a card somebody using a keyboard cannot put away. */
  useEscape(onClose, true)

  const status = world.presence.statusFor(user.id)
  const theirRoles = space ? rolesOf(user.id, space, world.roles, world.assignments) : []
  const colour = nameColourFrom(theirRoles)
  const look = nameLook(user)

  /*
   * Every server you are both in.
   *
   * Asked of each server's own roster. This used to ask whether the server
   * had any roles and whether this client had heard of the person at all —
   * both true of very nearly everything, so every server was listed as
   * shared with everybody.
   */
  /*
   * Off the server, not off what this client happens to hold.
   *
   * A server's roster is fetched when somebody opens that server, so asking
   * each roster whether it holds this person could only ever see the servers
   * you had already visited. The comment above describes fixing this once
   * already, from a worse answer to a wrong one.
   */
  const mutual = useMutual(server, mine ? null : user.id)
  const shared = mutual.spaces

  const [saying, setSaying] = useState('')
  const [sending, setSending] = useState(false)
  const [said, setSaid] = useState('')
  /* Stamped and ticking, so the bar moves and the clock counts. */
  const { heard, ran } = useHeard(activities)

  return (
    <>
      <div className="scrim" style={{ background: 'transparent' }} onClick={onClose} />
      <div className="pop" ref={ref} style={at ? { left: at.left, top: at.top } : undefined}>
        <div className="pcard">
          <div className="pbn">
            {user.banner_path
              ? <Still className="bimg" path={user.banner_path} />
              : <Scene seed={seedOf(user.id) + 3} height={76} />}
            <span className="vg" />
          </div>
          <div className="pbody">
            <div className="phead">
              <span className="pav">
                <AvatarWithStatus user={user} status={status} size="hu" />
              </span>
              <div className="pid">
                <div className="pnm">
                  <span className={`nm ${look.className}`}
                    style={{
                      ...look.style,
                      ...(colour && !look.style.color ? { color: colour } : {}),
                    }}>
                    {nameIn(world, space?.id ?? null, user)}
                  </span>
                </div>
                <div className="phn">@{user.username}</div>
              </div>
            </div>

            {/*
              * What they wrote about themselves, under their name.
              *
              * This used to say what they were playing - which the card
              * further down already says, with the game's own icon and how
              * long it has been running. Two lines for one fact, and the
              * poorer of the two was the one in the better place.
              *
              * A member list is the other way round: there is room for one
              * line there and what somebody is doing right now beats what
              * they wrote about themselves whenever they last thought about
              * it. Here there is room for both, so each goes where it reads
              * best.
              */}
            {statusOf(user) && (
              <div className="pact"><span>{statusOf(user)}</span></div>
            )}

            {/* Their own words, so anything in them is drawn as words. */}
            {user.bio && (
              <div className="pab"><Markdown text={user.bio} /></div>
            )}
          </div>
        </div>

        {/* What they are doing, as cards: the game above the music, each with
            its picture, and the track with where it has got to. This was a
            line of text saying the same words the line above already said. */}
        <ActivityCards heard={heard} ran={ran} />

        <div className="pmeta">

        </div>

        {space && (
          <div className="proles">
            <p className="lab">{theirRoles.length === 1 ? 'Role' : 'Roles'}</p>
            <div className="chips">
              {theirRoles.length
                ? theirRoles.map((r) => (
                  <span className="chip" key={r.id}
                    style={roleColour(r) ? { '--rc': roleColour(r) } as React.CSSProperties : undefined}>
                    <span className="cdot" />{r.name}
                  </span>
                ))
                /* Nothing of their own, so what they are is what everybody is.
                   Named from the server's own @everyone rather than the word
                   "Member", because a server that renamed it meant it. */
                : (
                  <span className="chip">
                    <span className="cdot" />
                    {world.roles.find((r) => r.space_id === space.id && r.kind === 'everyone')?.name
                      ?? 'Member'}
                  </span>
                )}
            </div>
          </div>
        )}

        {/*
          * Where they are, when it is a room rather than a game.
          *
          * world.voice holds only the rooms this account may see - the server
          * filters the occupancy per client through canAccessChannel - so
          * naming the room here cannot reveal one that was hidden. The
          * channel is looked up in what this client already has for the same
          * reason: a room missing from it is a room not to talk about, so the
          * section simply does not appear.
          */}
        {(() => {
          const where = world.voice.get(user.id)
          if (!where) return null
          const room = world.channels.find((c) => c.id === where.channelId)
          if (!room) return null
          const inServer = world.spaces.find((sp) => sp.id === room.space_id)
          return (
            <div className="proles pvoice">
              <p className="lab">In voice</p>
              <div className="pvrow">
                <span className="pvwhere">
                  <span className="pvn"><Icon name="vol" size={13} />{room.name}</span>
                  {inServer && <span className="pvs">in {inServer.name}</span>}
                </span>
              </div>
              {/* Absent when there is nothing for it to do. */}
              {onOpenVoice && (
                <button className="btn pvjoin" onClick={() => onOpenVoice(where.channelId)}>
                  Open Voice
                </button>
              )}
            </div>
          )
        })()}

        {/*
          * And the people you both know, which was on nobody's card.
          *
          * Only the overlap is sent - every name here is already in your own
          * friend list, so it says nothing you could not read there. Dropped
          * at zero rather than drawn as an empty heading.
          */}
        {!mine && mutual.friends.length > 0 && (
          <div className="proles pshared">
            <p className="lab">
              {mutual.friends.length === 1 ? 'A friend you share' : 'Friends you share'}
            </p>
            <div className="chips">
              {mutual.friends.map((f) => (
                <span className="chip" key={f.id}>
                  <span className="tbi">
                    {f.avatar_path
                      ? <Still path={f.avatar_path} />
                      : (f.display_name || f.username).slice(0, 2).toUpperCase()}
                  </span>
                  {/* Their own name. This is the friends you have in
                      common, which is not a fact about any one server -
                      so it is not somewhere a server's nickname belongs. */}
                  {f.display_name || f.username}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* How long they have been here, which the card never said. One of
            the two facts anybody actually reads off somebody else's card. */}
        {user.created_at > 0 && (
          <div className="proles">
            <p className="lab">Member since</p>
            <div className="pab">
              {new Date(user.created_at).toLocaleDateString(undefined, {
                day: 'numeric', month: 'short', year: 'numeric',
              })}
            </div>
          </div>
        )}

        {!mine && shared.length > 0 && (
          /* Its own name as well as the shared look: roles and shared servers
             are different things, and one class for both is how a question
             about either of them cannot be answered. */
          <div className="proles pshared">
            <p className="lab">{shared.length === 1 ? 'A server you share' : 'Servers you share'}</p>
            <div className="chips">
              {shared.map((s) => (
                /* With its icon, or its initials where it has none — the same
                   two the rail and the top bar show, so all three agree. */
                <span className="chip" key={s.id}>
                  <span className="tbi">
                    {s.icon_path
                      ? <Still path={s.icon_path} />
                      : s.name.slice(0, 2).toUpperCase()}
                  </span>
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/*
          * Say something from here.
          *
          * The card is where you decide to say something, so it is where you
          * can say it - a button that takes you somewhere else to start
          * typing loses the sentence you already had in your head.
          *
          * Not on your own card, and not where there is nothing to send with.
          */}
        {/*
          * And on your own card, the way to change what is on it.
          *
          * Reported as looking for it there: the card is where somebody
          * looks at their own name, picture and bio, so it is where they go
          * to change them. It was only in the menu under the same name in
          * the bottom corner, which is a different place for the same
          * thought.
          */}
        {mine && onEdit && (
          <div className="pedit">
            <button className="btn" onClick={() => { onClose(); onEdit() }}>
              Edit profile
            </button>
          </div>
        )}

        {/*
          * Nothing to say to somebody who is blocked.
          *
          * The box is absent rather than there and refused. The server will
          * not carry the message, so an enabled composer is a sentence
          * somebody types out and then loses - and the reason it failed
          * would arrive as an error rather than as the state it is.
          */}
        {blocked && !mine && (
          <p className="hint saysaid">
            Blocked. They cannot message you, and you cannot message them.
          </p>
        )}

        {onSay && !mine && !blocked && (
          <form className="saybox" onSubmit={(e) => {
            e.preventDefault()
            const body = saying.trim()
            if (!body || sending) return
            setSending(true)
            setSaid('')
            void onSay(body)
              .then(() => { setSaying(''); onClose() })
              .catch((err: unknown) => {
                setSaid(err instanceof Error ? err.message : 'That would not send.')
              })
              .finally(() => setSending(false))
          }}>
            <input
              value={saying}
              disabled={sending}
              maxLength={2000}
              placeholder={`Message ${nameIn(world, space?.id ?? null, user)}`}
              onChange={(e) => setSaying(e.target.value)} />
            {/* Only once there is something to send. An enabled button beside
                an empty box is a button that does nothing. */}
            {saying.trim() && (
              <button className="icb" type="submit" disabled={sending}
                aria-label="Send">
                <Icon name="send" size={15} />
              </button>
            )}
          </form>
        )}
        {said && <p className="hint saysaid">{said}</p>}

        <div className="acts">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  )
}
