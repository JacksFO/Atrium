import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { Icon } from './Icon'

/**
 * How many people are here, and how long it has been going.
 *
 * A count and a date. Who they are is nobody's business unless you are
 * friends or share a server, and that rule does not bend for a number on a
 * page - so there is nothing here that can name anybody.
 *
 * It is about this server, not about the app: every copy of Atrium is
 * somebody's own, and there is no total across them to know. What it answers
 * is "how big is the place I am in", which is a fair thing to wonder and a
 * quietly nice thing to watch move.
 */
export function Scale({ server }: { server: Api }) {
  const [scale, setScale] = useState<{ people: number; since: number | null } | null>(null)

  useEffect(() => {
    let alive = true
    void server.get<{ people: number; since: number | null }>('/api/scale')
      .then((r) => { if (alive && r) setScale(r) })
      .catch(() => {
        /* An older server has no such route. A home page without a count on
           it is the ordinary case rather than an error. */
      })
    return () => { alive = false }
  }, [server])

  if (!scale) return null

  const since = scale.since
    ? new Date(scale.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null
  /* Whole days, because "1.4 days" is arithmetic rather than an answer. */
  const days = scale.since
    ? Math.max(1, Math.floor((Date.now() - scale.since) / 86_400_000))
    : 0

  /* Small, in a corner. The long version is in the title, for anybody who
     wonders what the number is. */
  return (
    <span className="scale"
      title={`${scale.people.toLocaleString()} ${scale.people === 1 ? 'person has' : 'people have'} signed up here`
        + (since ? `, since ${since}` : '')}>
      <Icon name="people" size={13} />
      <b>{scale.people.toLocaleString()}</b>
      <span>signed up</span>
      {since && (
        <>
          <span className="scale-dot" />
          <span>{days.toLocaleString()}{days === 1 ? ' day' : ' days'}</span>
        </>
      )}
    </span>
  )
}
