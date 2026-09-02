import { useCallback, useEffect, useRef, useState } from 'react'
import { Gateway, type ConnState } from '../lib/gateway'
import { wsBase } from '../lib/server'
import { loadCategories, loadChannels, loadDms, loadFriends, loadMembers, loadRoles, loadSpaces, loadWorld } from '../lib/load'
import type { Api } from '../lib/api'
import { apply, emptyWorld, remember, type Refetch, type World } from '../lib/world'
import type { Category, Channel, Id, ReadyFrame, User } from '../lib/wire'

/**
 * The world, kept current.
 *
 * Held in a ref and published by a counter rather than kept in state as an
 * object. That is deliberate: the world contains Maps and is changed in
 * place, and copying the whole thing on every presence tick — which is what
 * an immutable store would do — is the cost this app cannot afford. Sixty
 * people going online at sign-in would be sixty copies of everything.
 *
 * What comes back is a snapshot function rather than the object, so nothing
 * can hold a stale reference and read from it later.
 */
export function useWorld(server: Api, token: string) {
  const ref = useRef<World | null>(null)
  const [version, bump] = useState(0)
  const [conn, setConn] = useState<ConnState>('connecting')
  /* How many goes it has had, so the page can say so rather than turning a
     spinner that means nothing. */
  const [tries, setTries] = useState(0)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const gatewayRef = useRef<Gateway | null>(null)
  /* Published as state as well as held in a ref: anything that subscribes to
     it — the typing line, the call — needs to re-run when it appears, and a
     ref changing is not a reason for React to do anything. */
  const [gateway, setGateway] = useState<Gateway | null>(null)

  const changed = useCallback(() => bump((n) => n + 1), [])

  useEffect(() => {
    if (!token) return
    let alive = true

    /* From the same address the HTTP calls use, which in the packaged
       desktop app is not the one this page was served from. */
    const url = `${wsBase()}/gateway`
    const g = new Gateway({ url })
    gatewayRef.current = g
    setGateway(g)

    const offState = g.onState((s, n) => {
      if (!alive) return
      setConn(s)
      setTries(n)
    })

    const off = g.on((e) => {
      if (!alive) return

      /* The opening frame is what the world is built from, so the first one
         loads everything; a later one is a reconnection, and then what is on
         screen may be an hour out of date. */
      if (e.t === 'ready') {
        const frame = e as ReadyFrame
        const world = ref.current ?? emptyWorld(frame.user)
        ref.current = world
        apply(world, frame)
        void loadWorld(server, world)
          .then(() => { if (alive) { setReady(true); changed() } })
          .catch((err: unknown) => {
            if (alive) setError(err instanceof Error ? err.message : 'Could not load.')
          })
        return
      }

      const world = ref.current
      if (!world) return
      const effect = apply(world, e)

      if (effect.say) setError(effect.say)

      /* Only what the event actually made wrong. The old client asked for
         everything every time, which is both wasteful and — with a frame that
         never refreshed — often wrong anyway. */
      /* One event can make two things wrong at once - accepting a friend
         request changes the friend list and opens a conversation - so this
         takes a list as readily as a name. */
      if (effect.refetch) for (const what of [effect.refetch].flat()) void refetch(what, world)

      changed()
    })

    async function refetch(what: Refetch, w: World) {
      try {
        if (what === 'spaces') {
          w.spaces = await loadSpaces(server)
          /*
           * And the headings, which is most of why anything asks for this.
           *
           * Four events map to a spaces refetch and three of them are not
           * about the space rows at all: a heading made, renamed or deleted,
           * and channels reordered. Reloading only the spaces answered none
           * of them - so a category made in one window never appeared, and a
           * new server's own two headings arrived whenever something else
           * happened to refresh, which is why they seemed to turn up late.
           *
           * Asked of every space rather than the one that changed, because
           * the event does not say which. They are a handful of rows each and
           * this happens when somebody edits a server, not on a timer.
           */
          const heads = await Promise.all(
            w.spaces.map((sp) => loadCategories(server, sp.id).catch((): Category[] => [])),
          )
          w.categories = heads.flat()

          /*
           * And the channels, for the same reason and one worse.
           *
           * The headings were being reloaded and the channels under them were
           * not, so a server somebody had just made or just joined came up
           * with two empty headings - which reads as a server that is broken
           * rather than one that is new. It looked like slowness because it
           * did eventually fix itself: the socket would drop at some point,
           * and the frame it reopens with is the only thing that had ever
           * carried a channel list.
           *
           * The conversations are kept, because they are not any server's and
           * this only speaks for the servers.
           *
           * And only for a server nothing is known about yet, which is nearly
           * always none of them. Every other way a channel list changes -
           * made, renamed, deleted, reordered - has an event of its own that
           * carries the change, so the only thing this can be answering is a
           * server that has just appeared. Asking every server every time
           * would put one request per server on the wire each time anybody
           * renamed one.
           */
          const known = new Set(w.channels.map((c) => c.space_id))
          const fresh = w.spaces.filter((sp) => !known.has(sp.id))
          if (fresh.length) {
            const lists = await Promise.all(
              fresh.map((sp) => loadChannels(server, sp.id).catch((): Channel[] => [])),
            )
            w.channels = [...w.channels, ...lists.flat()]
          }
        }
        if (what === 'friends') {
          const friends = await loadFriends(server)
          w.friends = friends
          /*
           * And into `people`, which is where every name on screen is looked
           * up. Sign-in did this and a refetch did not - so somebody who added
           * you arrived in the friend list under an id this client had never
           * heard of, and the request read as being from "Someone" until the
           * page was reloaded. The event that announces a request carries no
           * user to read it from; this is the only place it can come from.
           */
          for (const f of friends) remember(w, f)
        }
        /*
         * The conversations, which nothing ever asked for.
         *
         * `'dms'` was one of the names a refetch could carry and no event
         * returned it and no branch here honoured it - so it was dead at both
         * ends, and the list only ever changed by reloading the page.
         */
        if (what === 'dms') {
          const dms = await loadDms(server)
          w.dms = dms
          /* And when each was last used, so a conversation that has just been
             opened sorts where it belongs rather than at the bottom. Only
             where nothing newer is known, as at sign-in. */
          for (const d of dms) {
            const at = Number(d.last_at) || 0
            if (at > (w.lastAt.get(d.id) ?? 0)) w.lastAt.set(d.id, at)
          }
        }
        if (what === 'roles') {
          const got = await Promise.all(w.spaces.map((sp) => loadRoles(server, sp.id)))
          w.roles = got.flatMap((r) => r.roles)
          w.assignments = got.flatMap((r) => r.assignments)
        }
        if (what === 'members') {
          const lists = await Promise.all(
            w.spaces.map((sp) => loadMembers(server, sp.id)
              .then((roll) => ({ id: sp.id, list: roll.members, nicknames: roll.nicknames }))
              .catch(() => ({ id: sp.id, list: [] as User[], nicknames: {} as Record<Id, string> }))),
          )
          for (const { id, list, nicknames } of lists) {
            for (const u of list) remember(w, u)
            /*
             * And who is in which, which is what the member list is drawn
             * from.
             *
             * This remembered the people and stopped there, so somebody
             * joining a server you were looking at was added to the people
             * you know about and not to that server's roster - and the member
             * list, which filters the people by the roster, went on showing
             * exactly who it had shown before. They turned up when you opened
             * another server and came back, because that reloads the whole
             * space, which is how it was reported: "they only appear if I
             * refresh".
             *
             * Only when the request actually answered. An empty list from a
             * failed fetch would empty the roster and take everybody off
             * screen, which is far worse than being one person out of date.
             */
            if (list.length > 0) {
              w.membersBySpace.set(id, new Set(list.map((u) => u.id)))
              /* And the names this server gives them, on the same condition
                 and for the same reason: a failed fetch must not read as
                 "nobody here has a nickname any more". */
              w.nicknames.set(id, new Map(Object.entries(nicknames)))
            }
          }
        }
        if (alive) changed()
      } catch {
        /* A refetch that fails leaves what was known rather than emptying it.
           Showing nothing because one request failed is worse than showing
           something a moment out of date. */
      }
    }

    g.open(token)
    return () => {
      alive = false
      off()
      offState()
      g.close()
      gatewayRef.current = null
      setGateway(null)
    }
  }, [server, token, changed])

  return {
    world: ref.current,
    gateway,
    version,
    conn,
    tries,
    /* Ask it to go again, when it has stopped asking on its own. */
    retry: () => gatewayRef.current?.retry(),
    error,
    ready,
    clearError: useCallback(() => setError(''), []),
    /*
     * Say the world has changed, for anything that changes it directly.
     *
     * Dragging a channel writes the new order into the world and asks the
     * server afterwards, so the screen moves under the hand rather than two
     * round trips later. It said so by setting an unrelated piece of state to
     * the value it already had - which React drops, because setting state to
     * what it already is is not a change. So the reorder happened, was
     * correct, and was invisible until something else caused a render.
     */
    changed,
    /* The answer comes back with it, so a caller with something worth
       keeping - a message - can tell whether it went. False when there is
       no gateway at all, which is the same thing from the caller's side. */
    send: useCallback((payload: unknown) => gatewayRef.current?.send(payload) ?? false, []),
  }
}
