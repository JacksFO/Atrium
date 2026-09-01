import type { Call } from '../lib/call'
import type { Conversation } from '../lib/dms'
import type { Channel, Id } from '../lib/wire'
import type { World } from '../lib/world'
import { Avatar } from './Avatar'
import { useEffect, useState } from 'react'
import type { Api } from '../lib/api'
import { Icon } from './Icon'
import { Scene } from './Scene'
import { WideChangelog } from './Changelog'
import { WhileAway } from './WhileAway'
import { HomeNotice } from './HomeNotice'
import { Scale } from './Scale'
import { whatWaits } from '../lib/waiting'
import { seedOf } from './Avatar'

/**
 * Where the app opens.
 *
 * Not a dashboard. What it answers is "is there anything for me" — who is in
 * a call right now, and what was said while you were away — and then gets out
 * of the way. Anything that is not one of those two is a thing to go and
 * look at rather than a thing to be shown.
 */
export function Home({ world, call, channels, chats, onOpen, onJoin, onNav, phone, server, onSettings, onNewServer }: {
  world: World
  call: Call
  channels: readonly Channel[]
  chats: readonly Conversation[]
  onOpen: (id: Id) => void
  onJoin: (id: Id) => void
  onNav: () => void
  phone: boolean
  server: Api
  /** The way to the whole list, which lives in settings - on the pane that
   *  holds it, rather than wherever settings opens by itself. */
  onSettings: (pane?: 'whatsnew') => void
  /** Make one, or walk into somebody else's. */
  onNewServer: () => void
}) {
  const name = world.me.display_name || world.me.username
  /* A call this account can actually see. The rooms somebody is standing in
     elsewhere are not this account's business, and the client only knows
     about the one it is in. */
  const inCall = call.channel
    ? channels.find((c) => c.id === call.channel) ?? null
    : null
  /* Worked out once, because the empty state below asks the same question. */
  const waiting = whatWaits(world, chats)


  return (
    <div className="pane chatpane">
      <div className="wall"><Scene seed={seedOf(world.me.id) + 3} tall /></div>

      <div className="chd">
        {phone && (
          <button className="navtog" onClick={onNav} aria-label="Channels">
            <Icon name="menu" size={20} />
          </button>
        )}
        <span className="tt t"><Icon name="home" size={20} /> Home</span>
        <span className="tp">Where the app opens</span>
        <span className="gw" />
        {/* How big this place is, in the corner. It was a card of its own at
            the bottom of a column, which is a lot of room for two numbers
            nobody came to the page to read - but a nice thing to catch sight
            of, which is what a corner is for. */}
        <Scale server={server} />
      </div>

      <div className="stream" style={{ padding: '28px 32px 30px' }}>
        <div className="homecols">
          {/* The notice and the greeting run the full width above both
              columns: one is not about you and the other is only about you,
              and neither belongs in a column beside a list. */}
          {/*
            * The notice, above everything and across both columns.
            *
            * Above the greeting on purpose: it is the one thing on this page
            * that is not about you, and under the greeting it reads as though
            * it were. It draws nothing when there is nothing to say, which is
            * most of the time - and when it draws nothing the two columns
            * start at the top of the page together.
            */}
          {/*
            * The notice and the greeting, across both columns.
            *
            * Which of these spans decides where the right column starts, and
            * it took two goes to get right. Everything spanning - including
            * the offer of the desktop app - pushed What's new down past a
            * whole card, so it began level with nothing in particular.
            * Nothing spanning but the notice put it level with the greeting,
            * a line of text with no box round it, while the first card on the
            * left sat below it.
            *
            * The greeting and its line are the page's heading. They span, and
            * the two columns begin underneath them together - so the first
            * card on the left and the first card on the right start level.
            */}
          <div className="homehead">
            <HomeNotice />
            <h2 className="stitle">Hello, {name}</h2>
            <p className="ssub">
              {inCall
                ? `You are in ${inCall.name}.`
                : 'Nothing is going on that you are part of.'}
            </p>
          </div>

          <div className="homemain">
            <Desktop server={server} />

            {inCall && (
              <div className="card" style={{ borderColor: 'var(--accl)', background: 'var(--accs)' }}>
                <h4 style={{ color: 'var(--acc2)' }}>Live now</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', gap: 10 }}>
                    {call.members.slice(0, 5).map((m) => {
                      const person = world.people.get(m.id)
                      return person ? <Avatar key={m.id} user={person} size="lg" /> : null
                    })}
                  </span>
                  <span style={{ flex: 1, minWidth: 130 }}>
                    <span style={{ fontSize: '1.05em', fontWeight: 800, display: 'block' }}>
                      {inCall.name}
                    </span>
                    <span style={{ fontSize: '.85em', color: 'var(--fnt)' }}>
                      {call.members.length} {call.members.length === 1 ? 'person' : 'people'}
                    </span>
                  </span>
                  <button className="btn p" onClick={() => onJoin(inCall.id)}>Open</button>
                </div>
              </div>
            )}

            <WhileAway world={world} chats={chats} onOpen={onOpen} />

            {/* Nothing at all - which is not the same as an empty unread map.
                Everything waiting could be in channels somebody has muted, and
                those are deliberately not shown, so this asks what was drawn
                rather than what was held. */}
            {/*
              * Somewhere to start, on the page somebody lands on.
              *
              * The plus in the rail is where it belongs once you know it is
              * there. This is for the account that has just arrived, which is
              * every account at the beginning: nought friends, nought
              * servers, and a home page that used to say so and offer nothing
              * to do about it.
              */}
            {world.spaces.length === 0 && (
              <div className="card start">
                <h4>Servers</h4>
                <p className="hint">
                  You are not in any yet. Make one and bring the people you
                  actually talk to, or join one with a code somebody sent you.
                </p>
                <button className="btn p" onClick={onNewServer}>
                  <Icon name="plus" size={15} /> Make or join a server
                </button>
              </div>
            )}

            {chats.length === 0 && !inCall && waiting.length === 0 && (
              <div className="card">
                <h4>Nothing here yet</h4>
                <p className="hint">
                  Add somebody as a friend and start a conversation, or open a
                  server from the left.
                </p>
              </div>
            )}
          </div>

          {/* The column that is about the server rather than about you. */}
          <div className="homeside">
          {/*
          * What changed lately, beside what is waiting rather than under it.
          *
          * It used to sit in a 268px column, which is narrow enough that
          * every release note wrapped every few words and the whole thing
          * read as a tall grey ribbon. Release notes are short and there are
          * only ever a handful, so they fit side by side and the page has the
          * width to spare.
          */}
          <div className="whatsnew-wide">
          <div className="wnw-head">
            <h4><Icon name="layers" size={15} /> What&#8217;s new</h4>
            <span className="gw" />
            <button className="btn" onClick={() => onSettings('whatsnew')}>All the release notes</button>
          </div>
            <WideChangelog server={server} />
          </div>

          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Whether this server has an app to offer.
 *
 * Only where there is one, and only in the browser — offering a download of
 * the thing somebody is already running is the sort of banner people learn to
 * scroll past, and then scroll past the useful ones too.
 */
function Desktop({ server }: { server: Api }) {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    /* The packaged shell fetches this same page from this same server, so
       "is this the app" is a question about the window rather than the build. */
    if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) return
    let alive = true
    void server.get<{ available?: boolean }>('/api/desktop')
      .then((r) => { if (alive) setAvailable(!!r?.available) })
      .catch(() => { /* no build, or offline. Then there is nothing to offer. */ })
    return () => { alive = false }
  }, [server])

  if (!available) return null

  return (
    <div className="card">
      <h4>Atrium is better as an app</h4>
      <p className="hint">
        Push to talk, a badge on the taskbar, and it keeps running when the
        window is closed.
      </p>
      {/* `/download`, which redirects to whichever build is newest —
          wherever it is. There is no route under /api for it: that prefix is
          the JSON, and this answers with a file. */}
      <a className="btn p" href="/download">
        <Icon name="dl" size={15} /> Get it
      </a>
    </div>
  )
}
