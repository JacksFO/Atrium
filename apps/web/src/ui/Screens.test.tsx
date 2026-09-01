import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { drawn } from './mount'
import { SignIn } from './SignIn'
import { SettingsWindow } from './SettingsWindow'
import { Home } from './Home'
import { Friends } from './Friends'
import { ChannelPerms } from './ChannelPerms'
import { TileMenu } from './TileMenu'
import { Pip } from './Pip'
import { emptyCall } from '../lib/call'
import { DEFAULTS } from '../lib/settings'
import { emptyWorld, type World } from '../lib/world'
import type { Api } from '../lib/api'
import type { Channel, Space, User } from '../lib/wire'
import { SHARE_PRESETS } from '../lib/sharequality'

/**
 * Every screen, drawn once.
 *
 * Not a test of what any of them says — that is each one's own job. This asks
 * the one question nothing else does: does it render at all? A component that
 * throws on a shape it did not expect typechecks perfectly and takes the whole
 * screen with it, and half of these are behind a permission or a call and so
 * are never reached by anything else here.
 */

const me: User = {
  id: 'me', username: 'me', discriminator: '0001', verified: 0, display_name: 'Me',
  bio: '', accent: '', accent_2: '', name_font: 'default',
  name_effect: 'none', avatar_path: null, banner_path: null,
  status_text: '', presence: 'online', created_at: 0,
}

const world = (): World => emptyWorld(me)
const server = {
  get: async () => ({}), post: async () => ({}),
  patch: async () => ({}), put: async () => ({}), delete: async () => ({}),
} as unknown as Api
const noop = () => {}

const space = { id: 's1', name: 'Somewhere', description: '', icon_path: null, banner_path: null,
  owner_id: 'me', position: 0, created_at: 0 } as Space
const channel = { id: 'c1', space_id: 's1', name: 'general', kind: 'text',
  topic: '', position: 0, category_id: null } as Channel

const draws = (name: string, el: React.ReactElement) => {
  it(name, () => { expect(() => renderToStaticMarkup(el)).not.toThrow() })
}

/* The ones drawn over the window go through a portal, which the string
   renderer cannot follow — so they are mounted instead. */
const draws2 = (name: string, el: React.ReactElement) => {
  it(name, () => { expect(() => drawn(el)).not.toThrow() })
}

describe('every screen draws', () => {
  draws('the way in', <SignIn server={server} onIn={noop} />)

  draws('settings', (
    <SettingsWindow world={world()} settings={DEFAULTS} set={noop} reset={noop}
      onOut={noop} onClose={noop} server={server} onMe={noop} onArrange={noop} />
  ))

  draws('home', (
    <Home world={world()} call={emptyCall()} channels={[]} chats={[]}
      onOpen={noop} onJoin={noop} onNav={noop} phone={false} server={server}
      onSettings={noop} onNewServer={noop} />
  ))

  draws('friends, with nobody in it', (
    <Friends world={world()} friends={[]} tab="online" onTab={noop}
      onOpenDm={noop} onAccept={noop}
      onRemove={noop} onAdd={noop} onWho={noop} onNav={noop} phone={false} />
  ))

  /* Behind manage_roles, so nothing else has ever drawn it. */
  draws2("a channel's permissions", (
    <ChannelPerms server={server} world={world()} space={space}
      target={{ what: 'channels', id: channel.id, name: channel.name, kind: 'text' }}
      onClose={noop} />
  ))

  /* And a heading's, which is the same panel asked of a different row — the
     route for it existed all along and nothing ever opened it. */
  draws2("a heading's permissions", (
    <ChannelPerms server={server} world={world()} space={space}
      target={{ what: 'categories', id: 'k1', name: 'Rooms' }}
      onClose={noop} />
  ))

  /* Behind a call, and behind a right-click inside one. */
  draws2("a tile's options", (
    <TileMenu streamKey="share:pat" call={emptyCall()} me="me" label="Pat"
      master={100} onClose={noop} onVolume={noop} onWatch={noop}
      onFull={noop} onPopOut={noop} quality={SHARE_PRESETS[0]!} />
  ))

  /* Draws nothing when there is nothing to keep in the corner, which is the
     ordinary case and the one most likely to be got wrong. */
  it('the corner window, with nothing to put in it', () => {
    expect(renderToStaticMarkup(
      <Pip call={emptyCall()} world={world()} onOpen={noop} onStop={noop} />,
    )).toBe('')
  })
})

describe('every settings pane', () => {
  /*
   * Three were listed in the menu with nothing behind them, so opening one
   * showed a page saying it did not exist. A menu item that opens an apology
   * is worse than a menu item that is not there.
   */
  it('has something behind it', () => {
    /* Line endings normalised first: this file is CRLF in a working copy on
       Windows and LF elsewhere, and a slice that looks for '
]
' finds
       nothing at all in the first case - indexOf answers -1, the slice runs
       to the end of the file, and everything below GROUPS is read as if it
       were part of it. */
    const src = readFileSync(join(__dirname, 'Settings.tsx'), 'utf8').split('\r\n').join('\n')
    /* Only inside GROUPS. Matched across the file it also catches the
       density options, which are triples of the same shape about something
       else — the third time an extraction like this has been too broad. */
    const from = src.indexOf('export const GROUPS')
    const nav = src.slice(from, src.indexOf('\n]\n', from))
    const listed = [...nav.matchAll(/\['([a-z]+)', '[^']+', '[a-z]+'\]/g)].map((m) => m[1]!)
    const built = new Set([...src.matchAll(/id === '([a-z]+)'/g)].map((m) => m[1]!))
    expect(listed.length).toBeGreaterThan(3)
    expect(listed.filter((p) => !built.has(p))).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

describe('the top of a conversation', () => {
  const draw = (over: Partial<Parameters<typeof Intro>[0]> = {}) =>
    renderToStaticMarkup(
      <Intro name="general" kind="text" topic="" peer={null} group={false}
        atStart {...over} />,
    )

  it('says a channel is a channel', () => {
    expect(draw()).toContain('Welcome to #general')
    expect(draw()).toContain('beginning of the channel')
  })

  it('and a conversation is a conversation', () => {
    const out = draw({ kind: 'dm', name: 'Pat' })
    expect(out).toContain('beginning of your conversation')
    expect(out).not.toContain('Welcome to #')
  })

  it('and a group says what a group is', () => {
    expect(draw({ kind: 'dm', group: true })).toContain('beginning of the group')
  })

  /*
   * Only when the start really is on screen. Past a full page there is more
   * above than has been fetched, and this would be a beginning in the middle
   * of a conversation.
   */
  it('and says nothing when this is not the start', () => {
    expect(draw({ atStart: false })).toBe('')
  })
})

import { Intro } from './Intro'

/**
 * The sound of a share, while it is running.
 *
 * Which sound it is was settled when the share started — a window brings its
 * own program's, a screen brings the machine's. So there is nothing to choose
 * afterwards, only whether it goes out. A list of every running program used
 * to appear once a share began, asking a question that had already been
 * answered; it was also a child of the stage's tile grid, which handed it a
 * cell the size of somebody's video and let it draw over the whole call.
 */
describe('the stage while sharing', () => {
  const stage = readFileSync(resolve(process.cwd(), 'src/ui/Stage.tsx'), 'utf8')

  it('does not put a program list in the tile grid', () => {
    expect(stage).not.toContain('<AppAudio')
  })

  /*
   * With the share it belongs to, rather than beside it.
   *
   * It was a button of its own in the row, which is one more thing across the
   * bottom of a call for something that only means anything while a share is
   * running. It is behind the arrow on the share button now, with the other
   * thing people want mid-share - what it is being sent at - and the arrow is
   * only there while something is being shared.
   */
  it('and offers the sound with the share it belongs to', () => {
    expect(stage).toContain('controls.setShareAudio')
    /* From the menu the arrow opens, which is where the quality is too. */
    expect(stage).toContain('controls.setShareQuality')
    expect(stage).toContain('cbtnmore')
  })

  /* Drawn only where there is something to turn off: a share started without
     sound never captured any, and nothing can turn on what was never taken. */
  it('and only where there is sound to turn off', () => {
    expect(stage).toContain('call.shareAudio.has')
  })
})

/**
 * The controls, on the thing they control.
 *
 * They were behind a three-dot button, so every one of them cost a press to
 * find out what was in there. Under the pointer is where somebody's hand
 * already is.
 */
describe('a screen you are watching', () => {
  const stage = readFileSync(resolve(process.cwd(), 'src/ui/Stage.tsx'), 'utf8')
  const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

  it('carries its controls on itself', () => {
    expect(stage).toContain('className="hov"')
    for (const what of ['Full screen', 'Stop watching', 'Pop out']) {
      expect(stage, what).toContain(what)
    }
  })

  it('and shows them under the pointer, not before', () => {
    expect(css).toMatch(/\.hov\{[^}]*opacity:0/)
    expect(css).toMatch(/\.scell:hover \.hov,\.scell:focus-within \.hov\{[^}]*opacity:1/)
  })

  /* A keyboard reaches these too, and a control that is invisible while
     focused is one somebody is pressing blind. */
  it('and to a keyboard as well as a pointer', () => {
    expect(css).toContain('.scell:focus-within .hov')
  })

  /* On a touch screen there is no hover to leave, so the bar is not drawn
     and the button it replaced comes back. */
  it('and leaves the old way in where there is no hover', () => {
    expect(css).toMatch(/@media \(hover:none\)\{\.hov\{display:none\}\}/)
    expect(css).toMatch(/@media \(hover:none\)\{\.scell:has\(\.hov\) \.tr\{display:block\}\}/)
  })
})
