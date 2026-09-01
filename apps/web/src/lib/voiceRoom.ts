import type { Id } from './wire'
import type { World } from './world'

/**
 * Who is standing in each voice room, and how many of them to draw.
 *
 * The card in the channel list says who is in a room before you decide to go
 * in. That is useful for the handful of people a room usually holds and
 * nonsense for fifty: a row of fifty faces cannot fit a panel somebody can
 * drag down to two hundred pixels, and what it would do instead is push the
 * Join button out of the card.
 *
 * So a fixed few are drawn and the rest are a number. The number of faces is
 * fixed rather than worked out from the width on purpose - the panel is
 * draggable and the avatars scale with it, so anything measured would have to
 * be measured again on every drag, and the row is allowed to wrap instead.
 */

export type Face = { id: Id; name: string; sharing: boolean }

/** How many faces a room shows before the rest become a count. */
export const FACE_CAP = 9

/**
 * Everyone in every voice room, grouped once.
 *
 * The card used to scan the whole occupancy for each room it drew, which is
 * every person in a call multiplied by every room in the server, on every
 * render. Grouping once is the same answer for one pass.
 */
export function occupantsByRoom(world: World): Map<Id, Face[]> {
  const rooms = new Map<Id, Face[]>()
  for (const [id, where] of world.voice) {
    const list = rooms.get(where.channelId)
    const face: Face = {
      id,
      name: world.people.get(id)?.display_name ?? 'Someone',
      sharing: where.sharing,
    }
    if (list) list.push(face)
    else rooms.set(where.channelId, [face])
  }
  return rooms
}

/**
 * The faces to draw, and how many are not drawn.
 *
 * One under the cap is drawn rather than counted: "+1" in the space a face
 * would have taken says less than the face, and takes the same room.
 */
export function facesShown(
  here: readonly Face[], cap: number = FACE_CAP,
): { shown: Face[]; more: number } {
  if (here.length <= cap + 1) return { shown: [...here], more: 0 }
  return { shown: here.slice(0, cap), more: here.length - cap }
}
