import type { ChannelKind, User } from '../lib/wire'
import { Avatar } from './Avatar'

/**
 * The top of a conversation, before anything was said in it.
 *
 * Not decoration. A channel opening on a blank rectangle reads as one that
 * failed to load, and this is the only thing that says the difference between
 * "nothing has been said here" and "nothing arrived". It is also where the
 * one fact worth repeating goes: everything here stays on your own server.
 *
 * Shown only when the whole conversation is on screen. Once there is more
 * above than has been fetched it would be a beginning in the middle.
 */
export function Intro({ name, kind, topic, peer, group, atStart }: {
  name: string
  kind: ChannelKind | null
  topic: string
  /** Their picture, in a conversation with one person. */
  peer: User | null
  group: boolean
  /** Whether what is loaded really is the start of it. */
  atStart: boolean
}) {
  if (!atStart || !kind) return null
  const dm = kind === 'dm'

  return (
    <div className="intro">
      <div className="gl">
        {peer
          ? <Avatar user={peer} size="xl" />
          : <span className="hg">{dm ? '@' : '#'}</span>}
      </div>
      <h2>{dm ? name : `Welcome to #${name}`}</h2>
      {!dm && topic && <p className="tp2">{topic}</p>}
      <p>
        {group
          ? 'This is the beginning of the group. It exists as long as somebody '
            + 'is in it, and everything here stays on your own server.'
          : dm
            ? 'This is the beginning of your conversation. Everything here '
              + 'stays on your own server.'
            : 'This is the beginning of the channel. Everything here stays on '
              + 'your own server.'}
      </p>
    </div>
  )
}
