import type { World } from '../lib/world'
import { nameIn } from '../lib/names'
import type { Id } from '../lib/wire'

/**
 * Who is typing, in words.
 *
 * The dots are three elements and a CSS animation, and they keep hopping
 * because React leaves them alone when nothing about this line has changed.
 * The old client replaced the whole line on every typing event — one arrives
 * every couple of seconds while somebody types — which restarted the
 * animation from its first frame each time, so the dots never travelled
 * anywhere and looked static.
 *
 * The row is always here, at its own height, whether or not anybody is
 * typing. A line that appears and disappears moves the conversation above it
 * by its own height twice, which reads as the messages jumping.
 */
export function Typing({ world, spaceId, who }: {
  world: World
  /* Which server this line is in, because a nickname belongs to one - the
     same person types under a different name in two of them, and under
     their own in a conversation, which is what null means here. */
  spaceId: Id | null
  who: Id[]
}) {
  const names = who
    .map((id) => {
      const u = world.people.get(id)
      return u ? nameIn(world, spaceId, u) : ''
    })
    .filter(Boolean)

  if (!names.length) return <div className="typ" />

  const said = names.length > 2
    ? `${names.slice(0, 2).join(' and ')} and ${names.length - 2} more are`
    : `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'}`

  return (
    <div className="typ">
      <span className="tdt"><i /><i /><i /></span>
      <span><b>{said}</b> typing…</span>
    </div>
  )
}
