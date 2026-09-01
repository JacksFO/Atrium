import type { Message, User } from './wire'

/**
 * Telling somebody about a message they are not looking at.
 *
 * The rules are separated from the browser so they can be asked without one.
 * Every one of them is about *not* notifying: the failure that matters here
 * is a notification for something somebody is already reading, or for their
 * own message, or one that arrives while the window is in front of them —
 * each of which teaches people to turn the whole thing off.
 */

export type NotifyState = {
  /** Whether they asked for these at all. */
  wanted: boolean
  /** What the browser has been asked and answered. */
  permission: 'granted' | 'denied' | 'default' | 'unsupported'
  /** Whether the window is in front of them right now. */
  visible: boolean
  /** The channel on screen, which they are by definition reading. */
  openChannel: string | null
  /** Channels and servers they have muted. */
  muted: ReadonlySet<string>
  /**
   * People they have blocked.
   *
   * The whole point of blocking somebody is that they stop reaching you, and
   * a notification is the furthest reach the app has - it makes a noise on a
   * machine nobody may be sitting at, with their name and their words in it.
   * The message was already being hidden in the conversation, so the app was
   * refusing to show it and announcing it in the same breath.
   */
  blocked: ReadonlySet<string>
}

/**
 * Whether to say anything about this message.
 *
 * Note the order: the cheap and certain reasons first, so a muted channel
 * never even asks what the browser thinks.
 */
export function shouldNotify(
  m: Pick<Message, 'author_id' | 'channel_id'>,
  me: Pick<User, 'id'>,
  s: NotifyState,
  /** The server the channel is in, which can be muted as a whole. */
  spaceId?: string | null,
): boolean {
  /* Your own message coming back. Notifying about it is the app telling you
     what you just did. */
  if (m.author_id === me.id) return false
  /* Above the mute checks: this one is about the person, not the place, and
     it holds in every channel and conversation at once. */
  if (s.blocked.has(m.author_id)) return false
  if (s.muted.has(m.channel_id)) return false
  if (spaceId && s.muted.has(spaceId)) return false
  /* Already reading it — both halves matter. A channel open in a window
     behind something else is not being read, and a window in front showing a
     different channel is not showing this message. */
  if (s.visible && s.openChannel === m.channel_id) return false
  if (s.visible) return false
  if (!s.wanted) return false
  return s.permission === 'granted'
}

/**
 * What the notification says.
 *
 * A name and where, then the words. A message that is only a picture has no
 * words, and a body reading as empty looks like a notification that failed to
 * load rather than one about a picture.
 */
export function notificationFor(
  m: Pick<Message, 'body' | 'attachments'>,
  who: string,
  where: string | null,
): { title: string; body: string } {
  const words = m.body.trim()
  return {
    title: where ? `${who} in ${where}` : who,
    body: words ? words.slice(0, 140) : (m.attachments.length ? 'Sent a picture' : ''),
  }
}

/**
 * The count in the tab, which is the only notification some people want.
 *
 * Nothing rather than a nought: a title reading "(0)" is a number somebody
 * has to look at to learn there is nothing to look at.
 */
export const tabTitle = (unread: number, name = 'Atrium'): string =>
  unread > 0 ? `(${unread}) ${name}` : name
