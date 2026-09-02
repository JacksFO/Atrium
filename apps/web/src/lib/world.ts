import { Held } from './held'
import { namesMe } from './named'
import { Presences } from './presence'
import type { DmSummary, Friend } from './load'
import type { Activity,
  Assignment, Category, ChannelPref, Channel, Id, Message, ReadyFrame, Role, ServerEvent,
  Space, User,
} from './wire'

/**
 * Everything the app knows, and what each event does to it.
 *
 * The old client rebuilt this whole thing from the server on almost every
 * change, and assembled it partly from a frame the server sends once and
 * never again — so a channel you had just made was not in it, and a role you
 * had just renamed still had its old name, until the connection was remade.
 * It looked like it worked because every change asked for a fresh copy, and a
 * fresh copy built from a photograph is still the photograph.
 *
 * So this is held, and events change it in place. An event that carries the
 * new thing puts it in; one that only says something happened is the reason
 * to go and ask. Which of the two each event is, is written down here rather
 * than decided at each call site.
 */

export type World = {
  me: User
  spaces: Space[]
  channels: Channel[]
  categories: Category[]
  roles: Role[]
  assignments: Assignment[]
  /** Everybody the app has heard of, by id — the roster, your friends, and
   *  whoever wrote a message you can see. */
  people: Map<Id, User>
  presence: Presences
  /** What the server says you may do, per server and per channel. Never
   *  worked out here — see Held. */
  held: Held
  /**
   * Who is in each server.
   *
   * `people` is everybody this client has heard of — the rosters of every
   * server, plus friends, plus whoever wrote a message you can see. Drawn
   * from that, a member list shows the same everybody in every server, which
   * is the independence rule broken in the one place people look at it.
   *
   * So which roster somebody came from is kept rather than flattened away.
   */
  membersBySpace: Map<Id, Set<Id>>
  /**
   * What each server calls people, by server and then by person.
   *
   * Two levels rather than one flat map because a nickname is a fact about a
   * pair. It used to be a column on the account, so being renamed in one
   * server renamed you in every other and in your conversations with people
   * who had never heard of it - and there was nowhere in the shape of the
   * data to put the difference.
   *
   * A server nobody has been renamed in has no entry, which is nearly all of
   * them.
   */
  nicknames: Map<Id, Map<Id, string>>

  /**
   * Channels somebody has muted.
   *
   * Held as the set rather than as the rows: nothing here reads a level or a
   * lapse time, and a set is the question everything actually asks.
   */
  muted: Set<Id>
  /**
   * What you asked to be told about each channel, where you asked at all.
   *
   * `muted` above answers "is there a bell on this row", which is all the
   * channel list needs. This is the whole answer — which of the four levels,
   * and when a mute lapses — because the menu that sets it has to show what
   * is already set and say how long is left. The server only sends the
   * channels somebody has actually said something about, so an absent entry
   * means "whatever my default is".
   */
  prefs: Map<Id, ChannelPref>
  /** Loaded per channel, as you look at them. */
  messages: Map<Id, Message[]>
  /**
   * What is waiting, per channel.
   *
   * Counted by the server at sign-in and kept in step here afterwards: a
   * message arriving somewhere nobody is looking adds one, and reading a
   * channel clears it. Asking the server again for every message would be a
   * request per message to learn something this already knows.
   */
  unread: Map<Id, number>
  /** When each channel was last read, as the server last said. */
  lastRead: Map<Id, number>
  /**
   * How far from the end you had got in each channel.
   *
   * Not from the server and never sent to it — it is "where I was a minute
   * ago", which stops mattering the moment the tab closes. It lives here
   * rather than in the pane that reads it because that pane is unmounted
   * whenever you look at anything else, which is exactly when the position
   * has to survive; and here rather than in a module, so signing out forgets
   * it along with everything else about you.
   */
  parked: Map<Id, number>
  /** When somebody last made or revoked an invite here, so an open pane can
   *  ask again. Not the invites themselves: those are asked for. */
  invitesAt: number
  /**
   * Which of those has your name in it.
   *
   * Sent in the opening frame and kept in step here afterwards. A count says
   * how much is waiting; this says whether any of it is waiting for you,
   * which is the difference between a badge you will look at later and one
   * you will look at now.
   */
  mentioned: Set<Id>
  /** The servers whose members and roles have been fetched. */
  loaded: Set<Id>
  /**
   * Who is watching what, by the person doing the watching.
   *
   * Nothing streams until somebody asks for it, so until the server started
   * carrying this nobody outside your own browser knew who had asked — and a
   * picture of who is watching your screen could not be drawn at all.
   */
  watchers: Map<Id, string[]>
  /**
   * Who is standing in which voice room, whether or not you are in it.
   *
   * The server has sent this all along and the client kept only the watch
   * lists out of it, so a room you were not in said "Nobody in here" however
   * many people were - the roster it read comes from the media server, and
   * you only have one of those once you have joined. Which is exactly
   * backwards: who is in there is what you want to know *before* deciding to
   * go in.
   */
  voice: Map<Id, Occupant>
  /** When something was last said in each channel, loaded or not. */
  lastAt: Map<Id, number>
  /**
   * What each person is doing, where they are letting it be seen.
   *
   * The opening frame has always carried these and the socket has always sent
   * changes to them, and both were thrown away here — so the whole of rich
   * presence was built, wired at both ends, and connected to nothing.
   */
  activities: Map<Id, Activity[]>
  /** Where Text and Voice sit in each server's list — see LoosePlace. */
  looseOrder: Record<Id, { text: number; voice: number }>
  /** Conversations, and the people you have added. Fetched rather than in the
      opening frame, so they are held here beside everything else. */
  dms: DmSummary[]
  friends: Friend[]
  /**
   * Who you have blocked, by id.
   *
   * A set because the only question ever asked of it is membership, once
   * per message drawn. Their words are hidden where the server cannot
   * refuse them - a channel in a server you share is other people's as
   * well, and one reader's decision is not a veto on what everybody else
   * can see, so it is applied here and nowhere else.
   */
  blocked: Set<Id>
  /**
   * Who is stopped from talking, and until when.
   *
   * Keyed by server and person, because a timeout belongs to one server: the
   * same account can be timed out in one and talking freely in another. The
   * value is a moment, so whether it is over is a comparison against the
   * clock rather than something that has to be swept.
   */
  timeouts: Map<string, number>
}

export function emptyWorld(me: User): World {
  return {
    me,
    spaces: [], channels: [], categories: [], roles: [], assignments: [],
    people: new Map([[me.id, me]]),
    presence: new Presences(),
    held: new Held(),
    messages: new Map(),
    unread: new Map(),
    lastRead: new Map(),
    parked: new Map(),
    invitesAt: 0,
    mentioned: new Set(),
    muted: new Set(),
    prefs: new Map(),
    membersBySpace: new Map(),
    nicknames: new Map(),
    looseOrder: {},
    dms: [], friends: [], blocked: new Set(), timeouts: new Map(),
    lastAt: new Map(), activities: new Map(),
    loaded: new Set(), watchers: new Map(), voice: new Map(),
  }
}

/**
 * Somebody's row, from wherever it came.
 *
 * The newest wins, so the caller feeds the oldest source first: the frame
 * captured at sign-in, then anything fetched since. Remembering the sign-in
 * snapshot of yourself *after* a fresh roster is what put your own name back
 * to plain Online a frame after it had been drawn correctly.
 */
export function remember(w: World, u: User | undefined): void {
  if (!u?.id) return
  w.people.set(u.id, u)
  w.presence.remember(u)
}

/** What the ready frame says, replacing whatever was known. */
export function applyReady(w: World, f: ReadyFrame): World {
  w.channels = f.channels ?? []
  w.categories = f.categories ?? []
  w.roles = f.roles ?? []
  w.assignments = f.assignments ?? []
  /* And what everybody was doing when this arrived, which the frame has
     always carried. */
  /*
   * Who is already standing in a voice room.
   *
   * The frame has carried this from the start and nothing read it, so on
   * every connect - which includes every reload - each room went back to
   * looking empty until the next person moved. It is announced on a change
   * and only on a change, so with nobody moving it stayed that way.
   */
  w.voice = new Map()
  for (const v of f.voice ?? []) {
    const id = v.userId ?? v.user_id
    const channelId = v.channelId ?? v.channel_id
    if (!id || !channelId) continue
    w.voice.set(id, {
      channelId,
      muted: !!v.muted,
      deafened: !!(v.deafened ?? v.deaf),
      /* The opening frame carries these too, so a moderation control drawn
         before the first voice-state event knows which way it is set. */
      serverMuted: !!v.serverMuted,
      serverDeafened: !!v.serverDeafened,
      sharing: !!v.sharing,
    })
  }

  w.activities.clear()
  for (const [id, list] of Object.entries(f.activities ?? {})) {
    if (list?.length) w.activities.set(id, list)
  }
  for (const u of f.members ?? []) remember(w, u)
  remember(w, f.user)
  w.me = f.user
  w.presence.replaceHere(f.online ?? [])
  w.held.replace(f.permissionsBySpace, f.channelPermissions)
  w.looseOrder = f.looseOrder ?? {}
  /* Whole, like everything else here: this is the server's answer, and a
     leftover from a previous connection would hide somebody who has since
     been unblocked - silently, and only for that session. */
  w.blocked = new Set(f.blocked ?? [])
  w.prefs = new Map((f.channelPrefs ?? []).map((p) => [p.channelId, p]))
  w.muted = new Set(
    (f.channelPrefs ?? [])
      .filter((p) => p.mutedUntil !== null || p.level === 'nothing')
      .map((p) => p.channelId),
  )
  w.unread = new Map(
    (f.unread ?? []).filter((u) => u.channelId).map((u) => [u.channelId, Number(u.count) || 0]),
  )
  /* Whole, rather than merged: this is the server's answer for every channel
     at once, and a leftover from a previous connection would mark a line in
     a channel that has been read since. */
  w.lastRead = new Map(
    (f.readState ?? [])
      .filter((r) => r.channel_id && r.last_read_at)
      .map((r) => [r.channel_id, Number(r.last_read_at) || 0]),
  )
  w.mentioned = new Set(f.mentionChannels ?? [])
  return w
}

/**
 * What an event means.
 *
 * `world` is what changed here and now; `refetch` is what has to be asked for
 * because the event said something happened without saying what. Keeping them
 * apart is the point: the old client asked for everything on every event,
 * which is both wasteful and — because of the frozen frame — often wrong.
 */
/** Somebody standing in a voice room, as the server describes them. */
export type Occupant = {
  channelId: Id
  muted: boolean
  deafened: boolean
  /** Silenced by a moderator rather than by themselves. */
  serverMuted: boolean
  serverDeafened: boolean
  sharing: boolean
}

export type Refetch = 'spaces' | 'roles' | 'friends' | 'dms' | 'members'

export type Effect = {
  /** Anything that has to be fetched again, by name. */
  refetch?: Refetch | Refetch[]
  /** A channel whose messages are now wrong. */
  reloadChannel?: Id
  /** Something to say out loud. */
  say?: string
}

const NOTHING: Effect = {}

export function apply(w: World, e: ServerEvent): Effect {
  switch (e.t) {
    case 'ready':
      applyReady(w, e)
      return NOTHING

    /*
     * Somebody stopped from talking here, or let talk again.
     *
     * Kept so the member list can say so - the person it is about finds out
     * when they try to speak, and without this nobody else would find out at
     * all. Zero means it was lifted, and the row goes rather than sitting
     * there as a timeout that has already ended.
     */
    case 'member-timeout': {
      const key = `${e.spaceId}:${e.userId}`
      if (e.until > Date.now()) w.timeouts.set(key, e.until)
      else w.timeouts.delete(key)
      /* Nothing to fetch: the frame carries everything this changes, and the
         counter the caller bumps is what tells the page to redraw. */
      return NOTHING
    }

    /* Who has a socket open. A boolean, and never a word — reading it as a
       word is what left every dot in the app grey. */
    case 'presence':
      w.presence.setHere(e.userId, e.online)
      return NOTHING

    /* A profile changed. It says nothing about whether they are here, and
       claiming otherwise made every rename blink somebody out and back. */
    case 'member-update':
      remember(w, e.user)
      return NOTHING

    case 'activity':
      /* An empty list means they have stopped, which is a deletion rather
         than an empty entry — the difference between "doing nothing" and
         "not saying", and only one of them should draw a line. */
      if (e.activities.length) w.activities.set(e.userId, e.activities)
      else w.activities.delete(e.userId)
      return NOTHING

    /* The whole message, so it goes straight in. */
    case 'message':
    case 'ack': {
      const list = w.messages.get(e.message.channel_id)
      /*
       * A new list rather than a push into the old one.
       *
       * Everything else in the world is mutated in place and announced with a
       * counter, which is fine for things read as they are drawn. A list is
       * different: it is the one thing React can compare cheaply, and while
       * it was pushed into, the array handed to the message list was the same
       * array before and after - so nothing could be memoised on it and every
       * message already on screen was drawn again for every message that
       * arrived. Measured at 500 messages that was 119 ms of work to add one
       * of them. Copying the pointers instead is a few microseconds.
       */
      if (list && !list.some((m) => m.id === e.message.id)) {
        w.messages.set(e.message.channel_id, [...list, e.message])
      }
      /*
       * When something last happened here, whether or not it is loaded.
       *
       * The line above only keeps a message for a channel somebody has
       * already opened, which is right — holding every message of every
       * conversation is how a client grows without bound. But it means the
       * conversation list had nothing to sort a never-opened DM by, so a
       * message arriving in one could not lift it to the top. A number per
       * channel costs nothing and is all that ordering needs.
       */
      const seen = w.lastAt.get(e.message.channel_id) ?? 0
      if (e.message.created_at > seen) w.lastAt.set(e.message.channel_id, e.message.created_at)
      /*
       * And it is waiting, unless it is yours.
       *
       * Your own message arriving back is not something to be told about —
       * counting it puts a badge on the channel you are typing in, which
       * reads as the app having lost track of what you just did.
       *
       * Whether the channel is *open* is not decided here: the world does not
       * know what is on screen, and a message arriving in a channel somebody
       * is reading is cleared by the read that follows it.
       */
      if (e.message.author_id !== w.me.id) {
        w.unread.set(e.message.channel_id, (w.unread.get(e.message.channel_id) ?? 0) + 1)
        /* Named in it, by name or by a role you hold. Worked out from the
           body rather than asked for, because the server does not send a
           second frame per message and this is the same test it applied. */
        /* Not from somebody who has been blocked. Their message is hidden
           where it was said, so a red dot pointing at it is the app asking
           you to go and read a thing it has just refused to show you. */
        if (!w.blocked.has(e.message.author_id) && namesMe(e.message.body, w)) {
          w.mentioned.add(e.message.channel_id)
        }
      }
      return NOTHING
    }

    /* Reactions, edits and undeletes all arrive this way — the whole message
       again, under one name. Nothing listened for it, so a reaction was
       invisible until a reload. */
    case 'message-update':
    case 'message-restore': {
      const list = w.messages.get(e.message.channel_id)
      if (list) {
        const at = list.findIndex((m) => m.id === e.message.id)
        /* A new list, for the reason given where a message arrives. */
        const next = [...list]
        if (at >= 0) next[at] = e.message
        else next.push(e.message)
        w.messages.set(e.message.channel_id, next)
      }
      return NOTHING
    }

    /* Carries only an id — the channel is found rather than assumed, which is
       what the old client got wrong: it read a channel that was not there,
       compared null against the open one, and left the message on screen. */
    case 'message-delete': {
      for (const [channelId, list] of w.messages) {
        const at = list.findIndex((m) => m.id === e.id)
        /* A new list, for the reason given where a message arrives. */
        if (at >= 0) {
          w.messages.set(channelId, [...list.slice(0, at), ...list.slice(at + 1)])
          break
        }
      }
      return NOTHING
    }

    /* Read up to a point in time, which the server says out loud so every
       window this account has open agrees about it. */
    case 'read':
      w.unread.delete(e.channelId)
      w.mentioned.delete(e.channelId)
      /*
       * And when it was read, which the server says here and this threw
       * away.
       *
       * It is the same fact the ready payload carries, kept up to date for
       * the rest of the session - without it the line saying where you got
       * up to could only ever be worked out from where you were when the
       * page loaded, so leaving a channel and coming back showed nothing.
       */
      if (e.at) w.lastRead.set(e.channelId, e.at)
      return NOTHING

    case 'send-refused':
      return { say: e.detail }

    /* These carry the thing itself, so the frame is corrected here. */
    case 'channel-created':
    case 'channel-updated': {
      const at = w.channels.findIndex((c) => c.id === e.channel.id)
      if (at >= 0) w.channels[at] = e.channel
      else w.channels.push(e.channel)
      return NOTHING
    }

    case 'channel-deleted':
      w.channels = w.channels.filter((c) => c.id !== e.id)
      return NOTHING

    /* These say something happened without saying what, so they are the
       reason to ask — and the only reason. */
    /*
     * The new order, which the event states outright.
     *
     * This was grouped with the events that only say "something changed" and
     * answered with a refetch of the spaces - and the spaces are the server
     * rows, not the channels in them. Nothing in the client can reload a
     * channel list at all: it arrives once, in the opening frame. So dragging
     * a channel moved it for the person dragging it and for nobody else,
     * until they reloaded the page.
     *
     * Positions only, and only for channels already known - the server sends
     * one server's channels, so anything not held here belongs to a server
     * this client is not in.
     */
    case 'channels-reordered': {
      const at = new Map(e.channels.map((c) => [c.id, c.position]))
      for (const c of w.channels) {
        const p = at.get(c.id)
        if (p !== undefined) c.position = p
      }
      return NOTHING
    }

    case 'categories-changed':
    case 'space-update':
    case 'spaces-changed':
      return { refetch: 'spaces' }

    case 'roles-changed':
    case 'member-roles':
      return { refetch: 'roles' }

    /* Nothing to store: the pane that shows them asks the server itself, and
       what this carries is only "look again". Counted so that a pane which
       is open can notice. */
    case 'invites-changed':
      w.invitesAt = Date.now()
      return NOTHING

    /* Yours, from another window of your own. The same two facts the opening
       frame carries, kept in step the same way. */
    case 'prefs-changed': {
      w.prefs.set(e.pref.channelId, e.pref)
      const quiet = (e.pref.mutedUntil !== null && e.pref.mutedUntil > Date.now())
        || e.pref.level === 'nothing'
      if (quiet) w.muted.add(e.pref.channelId)
      else w.muted.delete(e.pref.channelId)
      return NOTHING
    }

    /* This one carries the whole answer, so there is nothing to go and ask.
       Sent to one person about one server, and it replaces that server's part
       and no other — including the channel exceptions, so a rule somebody has
       just deleted actually goes. */
    case 'permissions':
      w.held.setSpace(e.spaceId, e.permissions, e.channels)
      return NOTHING

    /*
     * Somebody asked, accepted, or went away.
     *
     * Accepting carries two things that were being thrown away. The person -
     * which is why a new friend read as "Someone" until a reload: the friend
     * list came back, but nothing put them in `people`, and `people` is where
     * every name on screen is looked up. And the conversation the server opens
     * for the pair at that same moment, so the DM existed from the instant the
     * request was accepted and neither of them could see it until they
     * reloaded - or gave up and started one by hand from Friends.
     */
    case 'friends-changed':
      if (e.user) remember(w, e.user)
      return { refetch: e.channelId ? ['friends', 'dms'] : 'friends' }

    /*
     * Sent to the blocker alone, and carrying the whole list.
     *
     * Whole rather than one id, because the list is short and the two ways
     * to change it - blocking and lifting - would otherwise be two frames
     * that have to agree. Only ever sent to the person who decided it: the
     * other side is told nothing, now or ever.
     */
    /*
     * What one server calls somebody, changed by somebody who may.
     *
     * Its own frame carrying a space rather than a member-update carrying a
     * whole user row, because the name is no longer on the row - it is a
     * fact about the pair, and a frame that did not say which server could
     * not be filed anywhere. Sent to that server's members only.
     */
    case 'nickname-changed': {
      const here = w.nicknames.get(e.spaceId) ?? new Map<Id, string>()
      /* Cleared is a deletion, not an empty string. "No nickname" and "a
         blank one" are the same thing to a reader and would be two things
         to every lookup. */
      if (e.nickname) here.set(e.userId, e.nickname)
      else here.delete(e.userId)
      w.nicknames.set(e.spaceId, here)
      return NOTHING
    }

    case 'blocks-changed':
      w.blocked = new Set(e.blocked ?? [])
      /* Nothing to refetch - the frame carries the whole list, and the
         caller re-renders after every event regardless. */
      return NOTHING

    case 'member-joined':
    case 'member-removed':
    case 'members-sync':
    case 'removed':
      return { refetch: 'members' }

    /* Nothing here changes what is known; the call layer listens for them.
       `read` is not among them any more — it clears what is waiting, and was
       listed here as well, so the second case was dead and the compiler said
       so. Two answers to one event, and the wrong one was unreachable. */
    case 'voice-state': {
      /* Rebuilt rather than merged: this is the whole occupancy every time,
         so somebody who has left should not linger in it. */
      const next = new Map<Id, string[]>()
      const rooms = new Map<Id, Occupant>()
      for (const o of e.occupants ?? []) {
        if (o.watching?.length) next.set(o.userId, o.watching)
        rooms.set(o.userId, {
          channelId: o.channelId,
          muted: !!o.muted,
          deafened: !!o.deafened,
          serverMuted: !!o.serverMuted,
          serverDeafened: !!o.serverDeafened,
          sharing: !!o.sharing,
        })
      }
      w.watchers = next
      w.voice = rooms
      return NOTHING
    }

    case 'typing':
    case 'voice-kick':
    case 'voice-moved':
    case 'voice-regrant':
    case 'rtc-signal':
    case 'share-peeked':
    case 'share-still':
    case 'share-still-ask':
    case 'call-cancel':
    /* Ringing, answering and declining are between two people and change
       nothing about what is known — the call row itself arrives as an
       ordinary message, which is what draws it. The call layer listens. */
    case 'call-incoming':
    case 'call-accept':
    case 'call-decline':
    case 'call-unavailable':
      return NOTHING

    /* Answered by the connection itself and never handed on, but named here
       so that the map is complete and the compiler stays useful. */
    case 'ping':
      return NOTHING

    case 'error':
      return { say: e.detail ?? 'Something went wrong.' }
  }
}
