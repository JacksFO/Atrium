import type { DmSummary } from './load'
import type { Id, User } from './wire'
import type { World } from './world'

/**
 * Conversations.
 *
 * A DM is a channel with people in it rather than a server — the same table,
 * the same messages, the same everything except that it belongs to nobody.
 * Which is also why a group is not a separate idea: it is one of these with
 * more than two people in it, and the only thing that has to be worked out is
 * how many.
 */

export type Conversation = {
  id: Id
  /** Everybody in it except you. */
  others: User[]
  group: boolean
  /** What to call it, which is the people in it. */
  name: string
  /** The other person, when there is exactly one. */
  peer: User | null
}

/** Somebody a conversation names who is otherwise unknown to this app. */
function stranger(id: Id): User {
  return {
    id, username: 'someone', discriminator: '0000', verified: 0,
    display_name: 'Someone', bio: '', accent: '', accent_2: '',
    name_font: 'default', name_effect: 'none', avatar_path: null,
    banner_path: null, status_text: '', presence: 'offline',
    created_at: 0,
  }
}

/* A conversation belongs to nobody, so nothing here can be renamed by a
   server: two people in a DM see the names they chose for themselves,
   whatever a server they are both in calls one of them. */
const nameOf = (u: User) => u.display_name || u.username

/**
 * A conversation, worked out from who is in it.
 *
 * The name is the people rather than anything stored: a group's stored name
 * was fixed when it was made, and somebody leaving does not rename a row in
 * a table. Somebody you talk to but share no server with is not in any
 * roster — they still have a name, and there is somewhere to show it, so an
 * unknown id becomes "Someone" rather than nothing.
 */
export function conversation(w: World, dm: DmSummary): Conversation {
  const ids = (dm.members ?? [])
    .map((m) => m.user_id ?? m.id)
    .filter((x): x is Id => !!x)
  const others = ids
    .filter((id) => id !== w.me.id)
    .map((id) => w.people.get(id) ?? stranger(id))

  const group = others.length > 1
  const peer = group ? null : others[0] ?? null
  const name = others.length
    ? others.map(nameOf).join(', ')
    : dm.name || 'Conversation'

  return { id: dm.id, others, group, name, peer }
}

/**
 * When something was last said in a conversation, as far as this client knows.
 *
 * The server sends no time on a conversation row, so this is what has
 * actually arrived: the newest message held for that channel. A conversation
 * nothing has been read from yet has none, and sorts to the bottom — except
 * where something is waiting in it, which is a conversation with news in it
 * and belongs above the silent ones rather than under them.
 */
const lastAt = (w: World, id: Id): number => {
  /* Kept for every channel, loaded or not — a message arriving in a
     conversation nobody has opened has to be able to lift it to the top, and
     the messages themselves are only held for channels somebody has read. */
  const known = w.lastAt.get(id) ?? 0
  if (known) return known
  const held = w.messages.get(id)
  const last = held?.[held.length - 1]
  if (last) return last.created_at
  return (w.unread.get(id) ?? 0) > 0 ? 1 : 0
}

/**
 * Every conversation, named, newest first.
 *
 * They came back in whatever order the server happened to store them, so the
 * one somebody had just been talking in could be anywhere in the list. Sorted
 * here rather than where they are drawn, because every place that draws them
 * wants the same order.
 */
export const conversations = (w: World): Conversation[] =>
  w.dms.map((d) => conversation(w, d))
    /* Stable, so conversations nothing is known about keep the order the
       server sent rather than shuffling on every render. */
    .sort((a, b) => lastAt(w, b.id) - lastAt(w, a.id))

/**
 * The conversation with one person, if there is one.
 *
 * Found by who is in it rather than by a stored name, so it keeps working
 * after somebody renames themselves.
 */
export const conversationWith = (w: World, userId: Id): Conversation | null =>
  conversations(w).find((c) => !c.group && c.peer?.id === userId) ?? null
