import type { Api } from './api'
import { remember, type World } from './world'
import type { Category, Assignment, Channel, Id, Role, Space, User } from './wire'

/**
 * Fetching the parts of the world that are not in the opening frame.
 *
 * The frame the server sends when the socket opens carries the channels, the
 * roles and who holds them — and it is sent once and never again. So anything
 * that changes one of those has to be fetched, and this is what does it.
 *
 * Each of these is separate on purpose. The old client had one function that
 * fetched everything and was called on every event, which is both wasteful
 * and — because the frame it read from never refreshed — often wrong anyway.
 */

/**
 * A conversation as the list route describes it: who is in it and when it was
 * last used.
 *
 * Not a channel, though it was called DmChannel - it is neither a row in the
 * channels table (that is DirectChannel) nor the thing drawn on screen (that
 * is Conversation, which resolves the members into names and a picture).
 * Three shapes for one idea, and one name that could have meant any of them.
 */
export type DmSummary = {
  id: Id
  name: string
  members: Array<{ user_id?: Id; id?: Id }>
  /**
   * When something was last said in it.
   *
   * The list is ordered by this, and until the server sent it the ordering
   * only existed for as long as the tab did: a message arriving live lifted
   * a conversation, and a reload put it back wherever it had been created.
   */
  last_at?: number
}

export type FriendState = 'accepted' | 'incoming' | 'outgoing'
export type Friend = User & { state: FriendState }

/** The servers somebody is in, in the order they arranged them. */
export async function loadSpaces(s: Api): Promise<Space[]> {
  const r = await s.get<{ spaces?: Space[] }>('/api/spaces')
  return r.spaces ?? []
}

/**
 * The roles of one server, and who holds them.
 *
 * Both together, because they are one answer: a role list without its
 * assignments is a list of headings nobody is under, which is exactly how a
 * hoisted role came to show an empty group.
 */
export async function loadRoles(
  s: Api,
  spaceId: Id,
): Promise<{ roles: Role[]; assignments: Assignment[] }> {
  const r = await s.get<{ roles?: Role[]; assignments?: Assignment[] }>(
    `/api/roles?spaceId=${encodeURIComponent(spaceId)}`,
  )
  return {
    /* The server does not repeat which space each role is in, and the client
       needs it to keep two servers' roles apart — grouping by all of them put
       two "Owner" headings in one member list. */
    roles: (r.roles ?? []).map((x) => ({ ...x, space_id: x.space_id ?? spaceId })),
    assignments: r.assignments ?? [],
  }
}

/** Everybody in one server. */
export async function loadMembers(
  s: Api, spaceId: Id,
): Promise<{ members: User[]; nicknames: Record<Id, string> }> {
  const r = await s.get<{ members?: User[]; nicknames?: Record<Id, string> }>(
    `/api/spaces/${encodeURIComponent(spaceId)}/members`,
  )
  /*
   * The names come beside the records, not on them.
   *
   * A nickname is what one server calls somebody, and a record is shared -
   * the same person is in the directory once and drawn in every server they
   * are in. Putting the name on the record is exactly what made one
   * nickname follow somebody into every other server, so it is kept apart
   * here and looked up per server where it is drawn.
   */
  return { members: r.members ?? [], nicknames: r.nicknames ?? {} }
}

export async function loadFriends(s: Api): Promise<Friend[]> {
  const r = await s.get<{
    friends?: User[]; incoming?: User[]; outgoing?: User[]
  }>('/api/friends')
  return [
    ...(r.friends ?? []).map((u) => ({ ...u, state: 'accepted' as const })),
    ...(r.incoming ?? []).map((u) => ({ ...u, state: 'incoming' as const })),
    ...(r.outgoing ?? []).map((u) => ({ ...u, state: 'outgoing' as const })),
  ]
}

export async function loadDms(s: Api): Promise<DmSummary[]> {
  const r = await s.get<{ dms?: DmSummary[] }>('/api/dms')
  return r.dms ?? []
}

/**
 * The channels of one server.
 *
 * There was nothing that could do this. Channels arrived once, in the frame
 * the socket opens with, and every later change was expected to arrive as an
 * event carrying the channel itself - which works for one being made,
 * renamed or deleted, and not at all for a server that was not yours when
 * the frame was built. Making one and joining one both push only
 * `spaces-changed`, so a brand new server came up with its headings and
 * nothing under them until the socket dropped and the frame was rebuilt.
 */
export async function loadChannels(s: Api, spaceId: Id): Promise<Channel[]> {
  const r = await s.get<{ channels?: Channel[] }>(
    `/api/channels?spaceId=${encodeURIComponent(spaceId)}`,
  )
  return r.channels ?? []
}

/** What is pinned in a channel. Asked for alongside the messages, because a
 *  panel that exists to show them and is always empty reads as the pinning
 *  having failed rather than as the panel never asking. */
export async function loadPins(s: Api, channelId: Id) {
  return s.get<{ messages?: unknown[] }>(
    `/api/channels/${encodeURIComponent(channelId)}/pins`,
  )
}

/**
 * Everything, at sign-in.
 *
 * Oldest first, freshest last — the frame the socket opened with has already
 * been applied by the time this runs, and the rosters fetched here are newer
 * than it. Remembering them the other way round put a snapshot of somebody
 * from sign-in on top of the row that had just come back from the database,
 * which is what made your own name flicker back to plain Online.
 */
export async function loadWorld(s: Api, w: World): Promise<World> {
  const spaces = await loadSpaces(s)
  w.spaces = spaces

  /*
   * Your friends and your conversations, and nothing about who else is in
   * anything.
   *
   * This used to fetch the whole roster and every role assignment of every
   * server before the app would draw. One member is about 470 bytes of JSON,
   * so a server of ten thousand is four and a half megabytes, plus another
   * two of assignments — downloaded, parsed and held for a list nobody had
   * opened yet, on every sign-in, for every server. A server's members are
   * fetched when that server is opened, by loadSpace below.
   */
  const [friends, dms] = await Promise.all([
    loadFriends(s).catch(() => []),
    loadDms(s).catch(() => []),
  ])
  for (const f of friends) remember(w, f)

  w.dms = dms
  /*
   * And what the server said about when each was last used, so the order
   * survives a reload. Only where nothing newer is already known - a message
   * that arrived while this was in flight is the better answer.
   */
  for (const d of dms) {
    const at = Number(d.last_at) || 0
    if (at > (w.lastAt.get(d.id) ?? 0)) w.lastAt.set(d.id, at)
  }
  w.friends = friends
  return w
}

/**
 * Who is in one server, fetched when somebody opens it.
 *
 * Marked as loaded before the request rather than after, so opening the same
 * server twice in quick succession — which is what changing channel inside it
 * looks like — asks once.
 *
 * A server that refuses (you were removed between the list and the question)
 * contributes nobody rather than taking anything else down with it.
 */
export async function loadSpace(s: Api, w: World, spaceId: Id): Promise<void> {
  if (w.loaded.has(spaceId)) return
  w.loaded.add(spaceId)

  const [roll, got] = await Promise.all([
    loadMembers(s, spaceId).catch(() => ({ members: [], nicknames: {} })),
    loadRoles(s, spaceId).catch(() => ({ roles: [], assignments: [] })),
  ])
  const list = roll.members

  for (const u of list) remember(w, u)
  /* Who was in which. Flattened into `people` alone, every server's member
     list is every server's member list. */
  w.membersBySpace.set(spaceId, new Set(list.map((u) => u.id)))
  /* And what this server calls them. Replaced rather than merged, so a
     nickname cleared while the client was elsewhere goes when the server is
     opened again. */
  w.nicknames.set(spaceId, new Map(Object.entries(roll.nicknames)))

  /* Replaced rather than appended, so loading a server twice cannot double
     its roles — and an assignment names a role, so the roles of this space
     are what says which assignments belong to it. */
  const mine = new Set(got.roles.map((r) => r.id))
  w.roles = [...w.roles.filter((r) => r.space_id !== spaceId), ...got.roles]
  w.assignments = [
    ...w.assignments.filter((a) => !mine.has(a.role_id)),
    ...got.assignments,
  ]
}

/**
 * The headings of one server.
 *
 * Asked for again after making one rather than guessing: the server decides
 * the position and trims the name, and a heading drawn from what was typed
 * moves the moment anything else refreshes.
 */
export async function loadCategories(s: Api, spaceId: Id): Promise<Category[]> {
  const r = await s.get<{ categories?: Category[] }>(
    `/api/categories?spaceId=${encodeURIComponent(spaceId)}`,
  )
  return r.categories ?? []
}

/**
 * One server's rows, put back among everybody else's.
 *
 * Every loader here answers for a single server, and the world holds all of
 * them in one list. So the answer has to replace that server's part and
 * nothing else - and the way to get this wrong is to simply assign it, which
 * silently throws away every other server's rows.
 *
 * Written once because it was written three times: twice correctly for
 * channels, and once for categories as a plain assignment. Renaming a channel
 * in your own server emptied the headings of every other one, and the next
 * server you opened drew none of its channels, because a channel is filed
 * under a heading that was no longer there.
 */
export function replacingSpace<T extends { space_id: Id | null }>(
  all: readonly T[],
  spaceId: Id,
  fresh: readonly T[],
): T[] {
  return [...all.filter((row) => row.space_id !== spaceId), ...fresh]
}

/** The channels of one server, in the order they are shown. */
export const channelsOf = (w: World, spaceId: Id): Channel[] =>
  w.channels
    .filter((c) => c.space_id === spaceId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
