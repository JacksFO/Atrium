/**
 * What the server actually sends, written down.
 *
 * Every one of these is here because getting it wrong cost a day. The old
 * client had no types on the wire at all, so a field could be read under the
 * wrong name, in the wrong shape, or not at all, and nothing said so — the
 * app simply drew something wrong and carried on. A list of the ones that
 * happened, because they are the argument for this file existing:
 *
 *   presence carried `online: boolean` and was read as a status word, so
 *   `status` came out undefined and every dot in the app stayed grey;
 *
 *   an attachment goes out under `url` and was sent as `path`, so the server
 *   skipped it silently and the picture never arrived;
 *
 *   an ordinary message is `kind: 'text'`, not `'default'`, and asking it the
 *   other way round made every message in every channel disappear;
 *
 *   `POST /api/roles` answers with the whole role list rather than the role
 *   just made, so `r.role.id` was undefined and its callers acted on nothing.
 *
 * Taken from the server's own columns and routes rather than from what the
 * client wished were true. Where the server is loose — a column that is a
 * string of anything — this is loose in the same way, because a type that
 * lies is worse than no type.
 */

/** Every id the server issues is a uuid string. The client never invents one. */
export type Id = string

/* ---------------------------------------------------------------- people -- */

/**
 * How somebody has chosen to appear. Four words, and the client's own
 * vocabulary differs — `idle` and `dnd` here, `away` and `busy` on screen.
 * The translation lives in one place; this is the half the server speaks.
 */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

/** The typefaces and effects a name can wear. Anything else is refused. */
export type NameFont = 'default' | 'display' | 'mono' | 'serif' | 'system'
export type NameEffect = 'none' | 'glow' | 'gradient' | 'shimmer' | 'outline'

/**
 * A person, as every route that returns one returns them.
 *
 * These are the PUBLIC_USER_COLUMNS on the server, and no more: what is here
 * is what anybody may see. A password hash or an email cannot be leaked by
 * this type because neither is in it.
 */
export type User = {
  id: Id
  username: string
  discriminator: string
  verified: number
  display_name: string
  /* No nickname here. It is what one SERVER calls somebody, and this record
     is shared - the same person is in the directory once and drawn in every
     server they are in, so a name on the row is a name in all of them. See
     world.nicknames, and nameIn() in lib/names. */
  bio: string
  /** A hex colour or empty. Also the colour a name is drawn in. */
  accent: string
  /** The second colour an effect paints with. Empty means none chosen. */
  accent_2: string
  name_font: NameFont
  name_effect: NameEffect
  avatar_path: string | null
  banner_path: string | null
  /* No role. Every account is the same kind of account - what anybody may
     do is decided inside the server they are in, and nowhere else. */
  status_text: string
  /** When the status stops being shown, or 0 for no timer on it. */
  status_until?: number
  presence: Presence
  created_at: number
}

/* -------------------------------------------------------------- messages -- */

/**
 * What a message is, beyond somebody talking.
 *
 * `text` is the ordinary one — not `default`, which is the assumption that
 * made every message vanish. A pin writes a line into the conversation saying
 * it happened, and that arrives here as a message with an empty body.
 */
/*
 * `call` is a call that happened here, which the server has always written
 * and this client has never drawn — so a call left no trace in the
 * conversation it happened in, and somebody who was away had no way of
 * knowing anybody had rung.
 */
export type MessageKind = 'text' | 'pin' | 'call' | 'poll'

/**
 * A question asked in a channel.
 *
 * The counts are on the message, not fetched separately: a poll IS a message,
 * so a change to it arrives the way every other change to a message does and
 * there is nothing to keep in step.
 */
export type Poll = {
  question: string
  /** Whether one answer is allowed or several. */
  multi: boolean
  /** When it stops taking answers, or null for one that does not. */
  closesAt: number | null
  closed: boolean
  /** How many people have answered — not how many votes were cast, which are
   *  different numbers once several answers are allowed. */
  voters: number
  options: Array<{
    idx: number
    text: string
    votes: number
    /** Of the votes cast, rounded on the server so everybody sees the same
     *  number rather than disagreeing by a percent. */
    share: number
    mine: boolean
  }>
}

export type Attachment = {
  id: Id
  message_id: Id
  filename: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  /** Signed on the way out, plain in the table. Sent back exactly as given. */
  path: string
  is_gif: number
  /**
   * A small copy, for the size a picture is actually drawn at.
   *
   * Null where there is no sensible one - a GIF, or something already
   * smaller than the copy would be - and null for everything sent before
   * thumbnails existed. A reader falls back to the full picture, so absent
   * is slower and never broken.
   */
  thumb_path?: string | null
}

export type Reaction = { emoji: string; count: number; me: boolean }

export type Message = {
  id: Id
  channel_id: Id
  author_id: Id
  body: string
  created_at: number
  edited_at: number | null
  deleted_at: number | null
  kind: MessageKind
  reply_to: Id | null
  pinned_at: number | null
  reactions: Reaction[]
  attachments: Attachment[]
  /** On a call row: when it finished, or null while it is still going. */
  call_ended_at?: number | null
  /** And whether it was ever picked up. 1 until somebody answers. */
  call_missed?: number
  /** On a poll: the question, the answers and where the votes are. */
  poll?: Poll
}

/**
 * An attachment on its way *out*, which is a different shape from one coming
 * back. `url` is the whole signed string the upload answered with — the
 * server takes the stored name off it itself, and an attachment under any
 * other key is not refused, it is skipped.
 */
export type OutgoingAttachment = {
  url: string
  filename: string
  is_gif?: boolean
  width?: number
  height?: number
  /** The signed url of the small copy, when one was worth making. */
  thumb?: string
}

/* -------------------------------------------------- servers and channels -- */

/**
 * What a channel is.
 *
 * All four arrive in the same list and live in the same table, which is the
 * right shape - a channel is a stream of messages, and what contains it is a
 * separate fact. What was wrong was saying so in two vocabularies: this named
 * only the two kinds a server has, while the frame the socket opens with puts
 * conversations in the very same array, and the components that draw one
 * matched on 'dm' against a type that said it could not happen.
 *
 * So a test could not put a conversation in a list of channels, while the
 * running app did it on every sign-in. The compiler was right and the runtime
 * was lying.
 */
export type ChannelKind = 'text' | 'voice' | 'dm' | 'group'

type ChannelBase = {
  id: Id
  name: string
  topic: string
  position: number
}

/**
 * A room in a server. It has a server, always - that is what makes it one -
 * and it may sit under a heading.
 */
export type ServerChannel = ChannelBase & {
  kind: 'text' | 'voice'
  space_id: Id
  category_id: Id | null
  /**
   * How long somebody has to wait between messages here. Nought is off.
   *
   * Optional because a client talking to a server from before this existed
   * gets rows without it, and "the column is not there" and "the channel is
   * not slowed" should behave the same way.
   */
  slowmode_seconds?: number
  /*
   * A colour somebody picked for it, or null for the one its id gives it.
   *
   * Null rather than a default, because "nobody has chosen" and "somebody
   * chose the colour that happens to be the default" want to behave
   * differently: the first follows the palette if it ever changes, and the
   * second does not.
   */
  colour?: string | null
}

/**
 * A conversation. It belongs to the people in it rather than to a server, so
 * it has neither a server nor a heading, and saying `null` here is what stops
 * anything reaching for one.
 *
 * True of every row in the live database: all eleven conversations have no
 * server, and all twelve rooms have one. This is a description, not a wish.
 */
export type DirectChannel = ChannelBase & {
  kind: 'dm' | 'group'
  space_id: null
  category_id: null
}

export type Channel = ServerChannel | DirectChannel

/** Narrowing, where it is easier to ask than to match on the kind. */
export const isServerChannel = (c: Channel): c is ServerChannel =>
  c.kind === 'text' || c.kind === 'voice'

export const isConversation = (c: Channel): c is DirectChannel =>
  c.kind === 'dm' || c.kind === 'group'

/**
 * A heading in a server's channel list.
 *
 * It always belongs to one - every path that makes one passes a server, and
 * the seeding function takes a non-null id. The `| null` here was the same
 * lie the channel type told: a case that cannot arrive, which every reader
 * then has to handle and no writer can produce.
 */
export type Category = { id: Id; space_id: Id; name: string; position: number }

/**
 * A role. `kind` has three values and not two: reading anything that is not
 * `everyone` as an ordinary role turned the server's own Owner into something
 * you could hand out, and hid every role the server calls `custom`.
 */
export type RoleKind = 'everyone' | 'owner' | 'custom'

export type Role = {
  id: Id
  space_id: Id | null
  name: string
  /** As chosen, in full. Reading only its hue threw away two thirds of it. */
  colour: string
  position: number
  /** JSON, because the server stores it that way. Parsed once, carefully. */
  permissions: string
  kind: RoleKind
  hoist: number
  created_at: number
}

/** Who holds what. Roles and holders are separate lists, joined by these. */
export type Assignment = { user_id: Id; role_id: Id }

/**
 * One of the things a person calls a server.
 *
 * The word on screen is "server" and the word in this code is "space", and
 * that gap is deliberate rather than left over. "Server" is already taken
 * here by the thing everything talks to - what lib/api.ts connects to
 * - and 43 files hold both at once. Functions take `{ server, world, space }`
 * today; calling the second one a server too would put two parameters of that
 * name in one destructuring, which is a collision rather than a preference.
 *
 * Discord has the same split for the same reason: their interface says
 * Server, their API says `guild` and `guild_id`. Two names for two things
 * that would otherwise share one.
 *
 * So: **server** is what the app talks to, **space** is what you join and make
 * channels in, and the person using the app is shown "server" for the second.
 * `space_id` on the wire and in the database means the same. If this is ever
 * renamed, `guild` is the word with an industry behind it - and it must not
 * be `server`.
 */
export type Space = {
  id: Id
  name: string
  description: string
  icon_path: string | null
  /** The strip above the channels. Null falls back to art grown from the id. */
  banner_path: string | null
  owner_id: Id
  created_at: number
}

/* ------------------------------------------------------------- the wire -- */

/**
 * The frame the server sends when the socket opens, and never again.
 *
 * That last part is the whole reason it is written down here: four things
 * were read from it and from nowhere else — the channels, the roles, who
 * holds which role, and the categories — so all four were frozen at sign-in.
 * A channel you made was not in the next bootstrap until the connection was
 * remade. Anything reading this must know it is a photograph.
 */
export type ReadyFrame = {
  t: 'ready'
  user: User
  /** Only you, your friends and whoever you have a conversation with. */
  members: User[]
  channels: Channel[]
  categories: Category[]
  roles: Role[]
  assignments: Assignment[]
  /** Who has a socket open, of the people you can see. Ids, not statuses. */
  online: Id[]
  voice: VoiceMember[]
  /**
   * How much is waiting, per channel.
   *
   * `channelId`, which is what the server's own query aliases it to — this
   * said `channel_id`, and read that way every entry would have come back
   * undefined and every badge would have been drawn on nothing. Nothing read
   * it yet, so it had never bitten.
   */
  unread: Array<{ channelId: Id; count: number }>
  /**
   * When each channel was last read, so the conversation can say where you
   * got up to.
   *
   * The server has sent this from the beginning and nothing here declared
   * it, so it was dropped on arrival - which is why opening a channel with
   * unread messages in it showed no line at all, and the only way to clear
   * a badge was Read all.
   */
  readState?: Array<{ channel_id: Id; last_read_at: number | null }>
  /**
   * Where you were named and have not read it yet.
   *
   * The server has always worked this out and sent it, and nothing here
   * declared it, so it was thrown away on arrival - which is why "waiting"
   * and "waiting for you" looked identical however many times somebody was
   * mentioned. Channel ids only: what was said is in the messages.
   */
  mentionChannels?: Id[]
  /**
   * What somebody has said about particular channels.
   *
   * `channelId`, `level` and `mutedUntil` — this said `channel_id` and
   * `muted`, neither of which is on the wire, so every row read as nothing
   * and no channel was ever muted however many times somebody muted it. The
   * same mistake was in the other client, in both directions at once.
   *
   * A time rather than a flag, because a mute can lapse. Only rows that have
   * not lapsed are sent, so anything with a time on it is muted now.
   */
  channelPrefs: ChannelPref[]
  /** What they want to be told about whole servers. Absent means the default. */
  spacePrefs?: SpacePref[]
  permissionsBySpace: Record<Id, string[]>
  /** And the channels where that server-wide answer is not the answer, by
   *  server and then by channel. Only the ones that differ are sent. */
  channelPermissions: Record<Id, Record<Id, string[]>>
  /**
   * Where the two unfiled sections sit, per server.
   *
   * Text and Voice hold whatever nobody has put in a category, and they are
   * not rows in the categories table — their place in the order lives on the
   * space instead. A client drawing the list has to put every heading in one
   * order and cannot work these two out from anything else it has.
   */
  looseOrder: Record<Id, { text: number; voice: number }>
  activities: Record<Id, Activity[]>
  /**
   * Who you have blocked.
   *
   * In the opening frame rather than fetched, because their messages in a
   * shared server are hidden by this client - and a list that arrives a
   * moment later means their words appear and then vanish.
   *
   * Your own direction only. Nothing anywhere says who has blocked you.
   *
   * Optional, and read through `?? []`. A desktop build talking to a server
   * that predates this field gets a frame without it, and the answer that
   * has to hold then is "nobody is blocked" rather than a crash on the
   * opening frame.
   */
  blocked?: Id[]
}

/** What somebody wants to be told about a whole server. */
export type SpacePref = {
  spaceId: Id
  level: 'all' | 'mentions' | 'nothing'
  /** When a mute lapses, or null for no mute. */
  mutedUntil: number | null
  /** Whether @everyone and @here stop counting as being named here. */
  suppressEveryone: boolean
}

export type ChannelPref = {
  channelId: Id
  level: 'default' | 'all' | 'mentions' | 'nothing'
  /** When the mute lapses, or null when the channel is not muted. */
  mutedUntil: number | null
}

export type VoiceMember = {
  user_id?: Id
  userId?: Id
  channel_id?: Id
  channelId?: Id
  name: string
  muted: boolean
  /** The server says `deafened`; this said `deaf` while nothing read either. */
  deaf?: boolean
  deafened?: boolean
  /* Silenced by a moderator rather than by themselves - the opening frame
     carries both, so a control drawn before the first voice-state event
     already knows which way it is set. */
  serverMuted?: boolean
  serverDeafened?: boolean
  sharing: boolean
  cam?: boolean
}

export type Activity = {
  kind: 'game' | 'music'
  name: string
  detail?: string
  /** Where the track had got to when the player last said. */
  at?: number
  length?: number
  since?: number
  art?: string
}

/**
 * Everything the gateway can send after `ready`.
 *
 * All of them, named. The old client translated fifteen and dropped the other
 * nineteen on the floor — reactions, edits, a channel renamed, a role edited,
 * somebody's roles changed, being removed from a call — and each of those
 * read as a missing feature rather than as an event nobody was listening for.
 * A union means the compiler asks about a name nobody has handled.
 */
export type ServerEvent =
  | ReadyFrame
  | { t: 'presence'; userId: Id; online: boolean }
  | { t: 'member-update'; user: User }
  | { t: 'typing'; userId: Id; channelId: Id }
  | { t: 'message'; message: Message }
  | { t: 'ack'; message: Message }
  | { t: 'message-update'; message: Message }
  | { t: 'message-restore'; message: Message }
  | { t: 'message-delete'; id: Id }
  | { t: 'send-refused'; nonce?: string; detail: string }
  | { t: 'channel-created'; channel: Channel }
  | { t: 'channel-updated'; channel: Channel }
  | { t: 'channel-deleted'; id: Id; spaceId: Id | null }
  | { t: 'channels-reordered'; spaceId: Id; channels: Array<{ id: Id; position: number }> }
  | { t: 'categories-changed' }
  | { t: 'roles-changed' }
  /* Somebody made or revoked an invite. Deliberately empty: a code is a way
     into the server, so it is not sent to everybody - whoever has the pane
     open asks again through the route that checks whether they may. */
  | { t: 'invites-changed'; spaceId: Id }
  /* What you asked to be told about one channel, sent to you alone - so a
     channel muted on one machine is muted on the others. */
  | { t: 'prefs-changed'; pref: ChannelPref }
  /**
   * What somebody wants to be told about a whole server.
   *
   * The thing a channel set to "use my default" defers to. Carried to your
   * own other windows the same way a channel's is: muting a server on one
   * machine must not leave it ringing on another.
   */
  | { t: 'space-prefs-changed'; pref: SpacePref }
  | { t: 'member-roles' }
  /**
   * Somebody stopped from talking here, or let talk again.
   *
   * `until` is a moment, and 0 means it was lifted. Carried rather than
   * fetched because the member list draws it, and because the person it is
   * about should find out when it happens rather than the next time they
   * try to say something.
   */
  | { t: 'member-timeout'; userId: Id; spaceId: Id; until: number }
  /* Carries the whole answer for one server, and the channels in it where
     that answer does not hold. Declared as an empty event, all of it was
     dropped on arrival and what somebody could do only changed when they
     reloaded — which is the bug the server sends this to avoid. */
  | {
      t: 'permissions'
      spaceId: Id
      permissions: string[]
      channels?: Record<Id, string[]>
    }
  | { t: 'space-update' }
  | { t: 'spaces-changed' }
  | { t: 'friends-changed'; user?: User; channelId?: Id }
  | { t: 'member-joined' }
  | { t: 'member-removed' }
  | { t: 'members-sync' }
  | { t: 'removed' }
  /* Carries which channel, and to when. Declared as empty — the same shape
     of mistake as the permissions event — it said only that *something* had
     been read, which is not enough to clear anything. */
  | { t: 'read'; channelId: Id; at: number }
  | { t: 'activity'; userId: Id; activities: Activity[] }
  | { t: 'blocks-changed'; blocked: Id[] }
  | { t: 'nickname-changed'; spaceId: Id; userId: Id; nickname: string }
  | {
      t: 'voice-state'
      /** Everybody in a call this account is allowed to see. */
      occupants?: Array<{
        userId: Id
        channelId: Id
        /** Silenced themselves, and silenced everybody else. */
        muted?: boolean
        deafened?: boolean
        /*
         * And silenced by somebody else, which is a different fact.
         *
         * The server has sent both of these all along and this type dropped
         * them, so the app could not tell "they have muted themselves" from
         * "a moderator muted them" - and could not draw a moderation control
         * that knew which way it was already set.
         */
        serverMuted?: boolean
        serverDeafened?: boolean
        sharing?: boolean
        /** What they have asked to watch, as stream keys. */
        watching?: string[]
      }>
    }
  | { t: 'voice-kick' }
  | { t: 'voice-moved'; channelId: Id }
  | { t: 'voice-regrant' }
  | { t: 'rtc-signal'; from: Id; data: unknown }
  | { t: 'share-peeked' }
  | { t: 'share-still' }
  | { t: 'share-still-ask' }
  | { t: 'call-cancel' }
  | { t: 'call-incoming'; from: Id }
  | { t: 'call-accept'; from: Id }
  | { t: 'call-decline'; from: Id }
  | { t: 'call-unavailable' }
  | { t: 'ping' }
  | { t: 'error'; code: string; detail?: string }

