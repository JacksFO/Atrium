import { may } from './permissions'
import type { Id, Message } from './wire'

/**
 * What somebody may do to a message, and what saying so means on the wire.
 *
 * The rules are the server's and it enforces them; this decides what to
 * *offer*, which is a different job. Offering something that will be refused
 * is worse than not offering it — but so is hiding something somebody is
 * allowed to do, because a gated control is absent rather than disabled and
 * reads as a feature nobody built.
 */

export type MessageAction = 'react' | 'reply' | 'edit' | 'delete' | 'pin' | 'copy'

export type Who = {
  id: Id
  /** What the server said this person may do in this channel. */
  permissions: readonly string[]
}

/**
 * The actions to offer on one message.
 *
 * Editing is yours alone — the server allows it only for what you wrote, and
 * offering it on somebody else's is offering a refusal.
 *
 * Deleting is yours, or a permission. Pinning is its own permission, and
 * falls back to managing messages: the two were one thing before pinning was
 * separated out, and a server set up under the old rule should not lose it.
 */
export function actionsFor(m: Message, who: Who): MessageAction[] {
  const mine = m.author_id === who.id
  /* Copying is the client's own doing and needs nobody's permission. */
  const out: MessageAction[] = ['copy']

  /* A reply is a message. It was offered to everybody, including somebody
     who cannot write in the channel — who would then compose one and be
     refused by the server, which is the thing this file exists to avoid. */
  if (may(who.permissions, 'send_messages')) out.unshift('reply')

  if (may(who.permissions, 'add_reactions')) out.unshift('react')

  if (mine) out.push('edit')
  if (mine || may(who.permissions, 'manage_messages')) out.push('delete')
  if (may(who.permissions, 'manage_pins') || may(who.permissions, 'manage_messages')) {
    out.push('pin')
  }
  return out
}

/* ---- what each one says down the socket ---- */

export const reactFrame = (messageId: Id, emoji: string) =>
  ({ t: 'react', messageId, emoji } as const)

export const editFrame = (messageId: Id, body: string) =>
  ({ t: 'edit', messageId, body } as const)

export const deleteFrame = (messageId: Id) =>
  ({ t: 'delete', messageId } as const)

/**
 * What this client is watching, whole rather than a change.
 *
 * Two changes arriving out of order cannot leave the server believing
 * somebody is watching something they closed — and the server sends this on
 * to the room, so a person sharing can be shown who is actually looking.
 */
export const watchingFrame = (keys: readonly string[]) =>
  ({ t: 'watching', keys: [...keys] } as const)

export const readFrame = (channelId: Id) =>
  ({ t: 'read', channelId } as const)

/**
 * An edit with nothing left in it.
 *
 * The server refuses an empty body outright, which would leave somebody who
 * cleared the box and pressed Enter with a message that did not change and no
 * word about why. So it is a question here instead: they almost certainly
 * meant to delete it.
 */
export const editIsDelete = (body: string): boolean => body.trim() === ''
