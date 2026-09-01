import { useState } from 'react'
import type { User } from '../lib/wire'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

/**
 * A conversation with several people in it.
 *
 * Friends only, the same rule a one-to-one conversation follows: a group is
 * not a way to open a channel to somebody who has not agreed to hear from
 * you. Everybody in it has already agreed to hear from whoever made it.
 *
 * Two people is the smallest group, which with yourself is a conversation of
 * three. One person and yourself is an ordinary conversation and there is
 * already a way to start one of those, so asking for a "group" of one would
 * quietly make the same thing by another route and confuse anybody who then
 * looked for their group.
 */

/** The most a group holds, which is what the server allows. */
const MOST = 9

function nameOf(u: User): string {
  return u.display_name || u.username
}

export function NewGroup({ friends, onCreate, onClose }: {
  friends: User[]
  onCreate: (userIds: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const full = picked.size >= MOST
  const enough = picked.size >= 2

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MOST) next.add(id)
      return next
    })
  }

  const shown = friends.filter(
    (f) => nameOf(f).toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <Modal
      title="New group conversation"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn p" disabled={!enough}
            onClick={() => onCreate([...picked])}>
            Start conversation
          </button>
        </>
      }
    >
      <div className="newgroup">
        {friends.length === 0 ? (
          /*
           * Said plainly rather than showing an empty list with a dead
           * button, which reads as the app being broken rather than as there
           * being nobody to pick.
           */
          <p className="hint">
            You have no friends yet. Add somebody first, and they can be in a
            group with you.
          </p>
        ) : (
          <>
            <div className="fld">
              <input
                autoFocus
                placeholder="Search your friends"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="ng-list">
              {shown.map((f) => {
                const on = picked.has(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    className={on ? 'ng-row on' : 'ng-row'}
                    /* Only the unpicked ones go dead when full, so somebody
                       can always take one out to swap it for another. */
                    disabled={!on && full}
                    onClick={() => toggle(f.id)}
                  >
                    <Avatar user={f} size="sm" />
                    <span className="ng-name">{nameOf(f)}</span>
                    <span className={on ? 'ng-tick on' : 'ng-tick'}>{on ? '✓' : ''}</span>
                  </button>
                )
              })}
              {shown.length === 0 && <p className="hint">Nobody by that name.</p>}
            </div>

            <p className="hint">
              {picked.size === 0
                ? 'Pick at least two people.'
                : picked.size === 1
                  ? 'One more, at least — two people and you is the smallest group.'
                  : `${picked.size} chosen${full ? ' — that is the most a group holds' : ''}.`}
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
