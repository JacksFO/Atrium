import type { Id, User } from './wire'
import type { World } from './world'

/**
 * Who is watching one stream.
 *
 * The server sends every occupant's list of what they have asked to watch,
 * and this is the one place it is turned round: from "what is each person
 * watching" into "who is watching this". Somebody sharing wants the second
 * question answered and the wire carries the first.
 *
 * Yourself excluded, always. You know whether you are watching it, and
 * counting yourself makes "2 spectators" mean something different depending
 * on who is reading it.
 *
 * Sorted by name rather than left in the order the map happens to hold,
 * because that map is rebuilt from scratch every time anybody in any call
 * starts or stops watching anything - so an unsorted list reshuffles under
 * the pointer while somebody is reading it.
 */
export function watchersOf(world: World, key: string, me: Id): User[] {
  return [...world.watchers.entries()]
    .filter(([id, keys]) => id !== me && keys.includes(key))
    .map(([id]) => world.people.get(id))
    .filter((u): u is User => !!u)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}

const nameOf = (u: User) => u.display_name || u.username || ''
