import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import type { Id } from '../lib/wire'

/**
 * What two people have in common.
 *
 * The servers you are both in, and the friends you both have. There is a
 * route that answers both together and nothing was calling it.
 *
 * The panel beside a conversation was working the servers out for itself, by
 * asking which of your own servers holds them - and it can only ask that of a
 * server whose roster has been fetched, which happens when you open one. So
 * the number was not the number of servers you share; it was the number you
 * share and had happened to visit since the app started. Fewer every time,
 * and usually none.
 *
 * The friends half was not shown at all. Only the overlap is sent, and every
 * name in it is already somebody you are friends with, so it discloses
 * nothing you could not read off your own friend list.
 */
export type Mutual = {
  spaces: Array<{ id: Id; name: string; icon_path?: string | null }>
  /* No nickname: mutual friends are not a fact about any one server, so
     there is no server whose nickname would apply. This declared one as
     optional, which is why the compiler was happy when the field went and
     the render below went on reading it. */
  friends: Array<{ id: Id; username: string; display_name?: string | null; avatar_path?: string | null }>
}

const NONE: Mutual = { spaces: [], friends: [] }

export function useMutual(server: Api, userId: Id | null): Mutual {
  const [got, setGot] = useState<Mutual>(NONE)

  useEffect(() => {
    if (!userId) { setGot(NONE); return }
    let alive = true
    /* Cleared first, so the panel never shows one person's servers under
       another person's name while the answer is in flight. */
    setGot(NONE)

    void server.get<Partial<Mutual>>(`/api/users/${encodeURIComponent(userId)}/mutual`)
      .then((r) => {
        if (alive) setGot({ spaces: r.spaces ?? [], friends: r.friends ?? [] })
      })
      /* Nothing in common and not being able to ask look the same on screen,
         which is the right way round: a panel that says "could not load your
         mutual friends" is worse than one that quietly says nothing. */
      .catch(() => { if (alive) setGot(NONE) })

    return () => { alive = false }
  }, [server, userId])

  return got
}
