/**
 * How much somebody wants to be told about, and where the answer comes from.
 *
 * There were two settings and only one of them did anything. A channel could
 * be set to All messages, Only @mentions or Nothing - and the code behind it
 * asked only "is this channel silenced", which is true for Nothing and for a
 * running mute and false for everything else. So Only @mentions was a choice
 * somebody could make, that was written down, that came back when they looked
 * at the menu, and that changed nothing at all.
 *
 * And a channel set to "Use my default" had no default to use. The words were
 * there, the fallback was not, and there was nowhere to say what your default
 * for a server should be.
 *
 * So: one rule, in one place, with the order written down. A channel says what
 * it wants, and where it has nothing to say the server decides.
 *
 * Pure, because every part of it is a question about settings and none of it
 * needs a message, a socket or a clock it does not get given.
 */

/** What somebody actually gets told about. */
export type Level = 'all' | 'mentions' | 'nothing'

/** What a channel can be set to, including deferring to the server. */
export type ChannelLevel = Level | 'default'

export type ChannelSetting = {
  level: ChannelLevel
  /** When a mute lapses, or null for no mute. */
  mutedUntil: number | null
}

export type SpaceSetting = {
  level: Level
  mutedUntil: number | null
  /** Whether @everyone and @here should stop counting as being named. */
  suppressEveryone: boolean
}

/** What a server is set to before anybody changes anything. */
export const SPACE_DEFAULT: SpaceSetting = {
  level: 'all', mutedUntil: null, suppressEveryone: false,
}

const muted = (until: number | null | undefined, now: number): boolean =>
  until !== null && until !== undefined && until > now

/**
 * The level that actually applies here, and why in this order.
 *
 * A mute is the loudest thing anybody can say and it is always temporary, so
 * it wins wherever it is set - somebody muting a channel for an hour means
 * that hour, whatever the server says.
 *
 * Then the channel, because it is the more specific of the two, and then the
 * server, because that is what "use my default" was always meant to mean.
 */
export function levelFor(
  channel: ChannelSetting | undefined,
  space: SpaceSetting | undefined,
  now: number,
): Level {
  if (muted(channel?.mutedUntil, now)) return 'nothing'
  if (channel && channel.level !== 'default') return channel.level
  if (muted(space?.mutedUntil, now)) return 'nothing'
  return space?.level ?? SPACE_DEFAULT.level
}

/** How a message touches you, which is what a level is answered against. */
export type Named = {
  /** By name, by handle, or by a role you hold. */
  me: boolean
  /** By @everyone or @here, which is a different kind of naming. */
  everyone: boolean
}

/**
 * Whether to make a noise about this one.
 *
 * `suppressEveryone` belongs here rather than beside the level, because it is
 * not a level - it is a claim about what counts as being named, and it has to
 * be answered before "only mentions" can mean anything. Somebody who has
 * turned it off and set Only @mentions is asking for the messages that are
 * about them and not the ones about everybody, and there is no way to say
 * that with a level alone.
 */
export function wantsTelling(
  level: Level, named: Named, suppressEveryone = false,
): boolean {
  if (level === 'nothing') return false
  if (level === 'all') return true
  /* Only mentions, so it has to name you - and @everyone counts unless
     somebody has said it should not. */
  return named.me || (named.everyone && !suppressEveryone)
}

/** The whole question, for the one place that asks it about a real message. */
export function tellMeAbout(
  named: Named,
  channel: ChannelSetting | undefined,
  space: SpaceSetting | undefined,
  now: number,
): boolean {
  return wantsTelling(levelFor(channel, space, now), named, space?.suppressEveryone ?? false)
}

/** What a level is called on screen. */
export const LEVEL_LABEL: Record<ChannelLevel, string> = {
  default: 'Use my default',
  all: 'All messages',
  mentions: 'Only @mentions',
  nothing: 'Nothing',
}

/**
 * Whether a channel should show nothing at all - no badge, no count.
 *
 * Asked of the channel and the server together, which is the whole point:
 * muting a server used to silence its sounds and leave a red number on its
 * tile, because the counting asked a set of muted channel ids and a muted
 * server never put its channels in it.
 *
 * "Only mentions" is deliberately not quiet. A badge there would have to say
 * how many of the waiting messages name you, and nothing counts that - so the
 * honest choices are a number that is wrong and a number that is the whole
 * count. It stays the whole count.
 *
 * Takes the two maps rather than the world, so this file still knows nothing
 * about anything but settings.
 */
export function quietIn(
  channelId: string,
  spaceId: string | null | undefined,
  channels: ReadonlyMap<string, ChannelSetting>,
  spaces: ReadonlyMap<string, SpaceSetting>,
  now: number,
): boolean {
  return levelFor(
    channels.get(channelId),
    spaceId ? spaces.get(spaceId) : undefined,
    now,
  ) === 'nothing'
}
