import type { ChannelKind } from '../lib/wire'
import { Still } from './Still'
import { Report } from './Report'
import type { Api } from '../lib/api'
import { WindowButtons } from './WindowButtons'

/**
 * Where you are, across the top.
 *
 * The stylesheet has always had a row for this and nothing was drawing it —
 * so the panels fell into row one, which is `auto`, and the whole app was as
 * tall as its tallest column instead of as tall as the window. On a short
 * member list that left the app floating in the corner of a black screen.
 *
 * In the desktop build this is also the window's drag region, and it sits
 * inside the strip Windows already reserves for the window buttons: a bar
 * below that strip would be two lots of chrome for one bar. Without it there
 * is nothing to drag the window by at all.
 */
export function TopBar({ space, channel, kind, server }: {
  /** For sending a report, which is the one thing this bar can do. */
  server: Api
  /** The server, or null in the conversations. */
  space: { name: string; icon_path: string | null } | null
  /** What is open, or null when nothing is. */
  channel: string | null
  kind: ChannelKind | null
}) {
  return (
    <div className="topbar">
      {/* Always there, on the left, whatever is open. The moment somebody
          wants to report a thing is the moment it happened. */}
      <Report server={server} />
      {/*
        * Placed over the middle column.
        *
        * NOT marked no-drag, which it was: this is absolutely positioned at
        * inset 0, so it covers the whole bar, and no-drag on it cancelled the
        * drag region underneath it completely. The desktop window could not
        * be moved by its own title bar at all.
        *
        * The reasoning behind the no-drag was sound and about a different
        * element - everything inside a drag region is handed to the window
        * manager before the page sees it, so anything clickable needs it. But
        * there is nothing clickable in here. It is a server name and a
        * channel name. If a button is ever added, that button gets no-drag,
        * not the strip it sits in.
        */}
      <div className="tbin">
        {space && (
          <>
            {/* Its own icon where it has one, its initials where it does not
                — the same two the rail shows, so the two agree. */}
            <span className="tbi">
              {space.icon_path
                /* Through the same component as everywhere else. A bare img
                   here missed the stored path's signature, so the one place
                   the server's picture is drawn without it showed a broken
                   image - and being one pixel of nothing, it looked like a
                   server with no icon rather than a picture that would not
                   load. */
                ? <Still path={space.icon_path} />
                : space.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="tbn">{space.name}</span>
          </>
        )}
        {space && channel && <span className="tbs">/</span>}
        {channel && (
          <span className="tbn">
            {kind === 'text' ? '#' : kind === 'dm' ? '@' : ''}{channel}
          </span>
        )}
        {!space && !channel && <span className="tbn">Atrium</span>}
      </div>
      {/* After the name, so it is last in the reading order as it is last
          across the bar. Draws nothing at all in a browser. */}
      <WindowButtons />
    </div>
  )
}
