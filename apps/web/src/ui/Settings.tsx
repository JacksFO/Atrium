import {
  Children, cloneElement, createContext, isValidElement, useCallback, useContext,
  useEffect, useId, useRef, useState,
} from 'react'
import type { Settings } from '../lib/settings'
import type { World } from '../lib/world'
import { MePane } from './MePane'
import { Changelog } from './Changelog'
import { isDesktop, shell } from '../lib/shell'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'
import type { IconName } from './Icon'
import { Aside, AsideCard } from './SettingsWindow'
import { THEMES } from './theme'
import { Scene } from './Scene'
import { seedOf } from './Avatar'
import { AutoGate, GATE_MAX, GATE_MIN } from '../lib/autogate'
import { isWatching } from '../lib/attention'
import { listen, BAR_MAX, type Meter } from '../lib/micmeter'
import { playPing } from '../lib/sound'
import { runningBuild } from '../lib/stale'
import { versionLabel } from '../lib/whichBuild'

/**
 * The settings panes, and the rows they are built from.
 *
 * The window around them is in SettingsWindow.tsx. Only that was rewritten:
 * these carry the API calls, the permission checks and the aria-labelling
 * that took several passes to get right, so they were moved rather than
 * written again.
 *
 * A pane may put something in the window's third column with <Aside>. That is
 * for what a pane can *show* rather than say - a live preview, a level meter,
 * a test button - because "cosy" and "compact" mean nothing until you see
 * them, and the only way to find out whether your microphone worked used to
 * be joining a call and asking somebody.
 */

export type PaneId =
  | 'account' | 'profile' | 'privacy' | 'blocked'
  | 'appearance' | 'chat' | 'voice' | 'notifications' | 'accessibility'
  | 'about' | 'whatsnew'

export const GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [PaneId, string, IconName]>]> = [
  /*
   * Two of these used to be listed and had nothing behind them, which is a
   * menu item that opens a page saying it does not exist. Profile is the
   * account pane — everything it would have held is there — and privacy is
   * genuinely not built, so it is not offered.
   */
  ['You', [
    ['account', 'My account', 'user'],
    /*
     * Its own pane, and the only place a block can be lifted.
     *
     * Everywhere else you unblock somebody is a menu on their name, and a
     * name is exactly what stops being reachable: block somebody and then
     * leave the server you met them in, and there is nowhere left in the
     * app they appear. A decision you cannot undo is a different decision
     * from the one the button offered.
     */
    ['blocked', 'Blocked people', 'ban'],
  ]],
  ['App', [
    ['appearance', 'Appearance', 'brush'],
    ['chat', 'Chat', 'chat'],
    ['voice', 'Voice & video', 'mic'],
    ['notifications', 'Notifications', 'bell'],
    ['accessibility', 'Accessibility', 'globe'],
  ]],
  ['This build', [
    ['whatsnew', 'What’s new', 'layers'],
    ['about', 'About', 'info'],
  ]],
]

/**
 * Which setting was searched for, if any.
 *
 * Through a context rather than a prop: a row is three or four components
 * below the screen that knows, and threading "was I searched for" through
 * every pane and every card between them would touch thirty call sites to
 * tell one row something.
 */
export const Wanted = createContext<{ title: string | null; shown: () => void }>({
  title: null,
  shown: () => {},
})

/**
 * A setting: what it is called, what it means, and the thing that sets it.
 *
 * The control takes its name from the title beside it. Every switch and
 * slider in this screen was a button or an input with nothing to announce -
 * twenty-one of them - so a screen reader read out "switch" twenty-one times
 * and never said what any of them was for. The words are already on the row;
 * this ties them to the control rather than asking whoever adds the next
 * setting to remember an aria-label.
 *
 * Not a <label>: that names a form control and does nothing at all for a
 * button, and most of these are buttons.
 */
const Row = ({ title, detail, children }: {
  title: string
  detail?: string
  children: React.ReactNode
}) => {
  const id = useId()
  const mine = useRef<HTMLDivElement>(null)
  const wanted = useContext(Wanted)
  const asked = wanted.title === title

  /*
   * Brought into view and lit for a moment when it was searched for.
   *
   * Opening the pane is only half of an answer: a setting eight rows down a
   * scrolling pane is still somewhere to hunt for, which is the thing the
   * search box exists to stop.
   */
  useEffect(() => {
    if (!asked) return
    mine.current?.scrollIntoView({ block: 'center' })
    const t = setTimeout(() => wanted.shown(), 1600)
    return () => clearTimeout(t)
  }, [asked, wanted])

  return (
    <div className={asked ? 'row lit' : 'row'} ref={mine} data-row={title.toLowerCase()}>
      <span className="txt">
        <span className="t" id={id}>{title}</span>
        {detail && <span className="d">{detail}</span>}
      </span>
      {Children.map(children, (child) => (
        isValidElement(child)
          /* Anything that named itself keeps its own name: a row can hold a
             pair of buttons that need telling apart, and the title cannot
             tell them apart. */
          && !(child.props as { 'aria-label'?: string })['aria-label']
          && !(child.props as { 'aria-labelledby'?: string })['aria-labelledby']
          ? cloneElement(child as React.ReactElement<Record<string, unknown>>,
            { 'aria-labelledby': id })
          : child
      ))}
    </div>
  )
}

/**
 * On or off, with whatever name the row gave it.
 *
 * The rest of the props are passed through on purpose: the row beside it
 * hands down an aria-labelledby, and a component that quietly drops what it
 * is given leaves a switch a screen reader can only call "switch". Which is
 * what this did, fifteen times over.
 */
const Switch = ({ on, onChange, ...rest }: {
  on: boolean
  onChange: (v: boolean) => void
} & React.AriaAttributes) => (
  <button className={on ? 'sw on' : 'sw'} onClick={() => onChange(!on)}
    role="switch" aria-checked={on} {...rest} />
)

/**
 * What a message looks like with the settings as they stand.
 *
 * The real classes, not a drawing of them. Text size, line spacing and
 * density are written onto the document root as --fsz, --lh and data-dens,
 * so this responds to them for the same reason the conversation behind it
 * does - there is nothing here that has to be kept in step by hand, and a
 * preview that could drift out of step would be worse than none.
 *
 * Spans rather than buttons on purpose: a real message row is built from
 * buttons that open a profile, and copying those here would add a handful of
 * controls that go nowhere and have nothing to announce themselves as.
 */
function LookLike() {
  const line = (who: string, at: string, said: string, run = false) => (
    <div className={run ? 'msg cont' : 'msg'} key={who + at}>
      <span className="ava">
        {run ? <span className="hat">{at}</span> : <span className="prevav" />}
      </span>
      <div className="mbody">
        {!run && (
          <div className="mh">
            <span className="nm">{who}</span>
            <span className="at">{at}</span>
          </div>
        )}
        <div className="bd">{said}</div>
      </div>
    </div>
  )
  return (
    <div className="prevmsgs">
      {line('Pat', '9:41', 'Is anyone about tonight?')}
      {line('Sam', '9:41', 'Give me twenty minutes and I am there.')}
      {line('Sam', '9:42', 'Starting without me is also fine.', true)}
    </div>
  )
}

export function Pane({ id, world, settings, set, reset, onOut, server, onMe, onArrange }: {
  onArrange: () => void
  id: PaneId
  world: World
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  reset: () => void
  onOut: () => void
  server: Api
  onMe: (user: User) => void
}) {
  if (id === 'appearance') {
    return (
      <>
        <h2 className="stitle">Appearance</h2>
        <p className="ssub">
          Ten themes out of seven numbers each. Only the hues move between
          them — the lightness steps are fixed, so a theme cannot come out
          unreadable.
        </p>
        {/*
          * Arranging is done on the app, not here.
          *
          * A row of four rectangles in a settings pane is a diagram, and
          * somebody moving boxes in a diagram has to work out which box is
          * which. The button leaves settings and turns the app itself into
          * the thing being arranged.
          */}
        <div className="card">
          <h4>Layout</h4>
          <Row
            title="Arrange the columns"
            detail="Servers, channels, the conversation and the member list, in whatever order suits you. Only you see it."
          >
            <button className="btn" onClick={onArrange}>Arrange</button>
          </Row>
        </div>

        <div className="card">
          <h4>Theme</h4>
          <div className="thgrid">
            {THEMES.map((t) => (
              <button key={t.id}
                className={`thsw ${settings.theme === t.id ? 'on' : ''}`}
                onClick={() => set('theme', t.id)}>
                <span className="thprev"><Scene seed={seedOf(t.id) + 11} height={54} /></span>
                <span className="thn">{t.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h4>Size and spacing</h4>
          <Row title="Text size" detail={`${settings.fontSize}px — everything is sized against this`}>
            <input type="range" className="rng" min={14} max={26}
              value={settings.fontSize}
              onChange={(e) => set('fontSize', Number(e.target.value))} />
          </Row>
          <Row title="Density" detail="How much room a message takes">
            <div className="segm">
              {(['cosy', 'compact', 'tight'] as const).map((d) => (
                <button key={d} className={settings.density === d ? 'on' : ''}
                  onClick={() => set('density', d)}>
                  {d[0]!.toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </Row>
          <Row title="Wallpaper" detail="The generated picture behind a conversation">
            <Switch on={settings.wallpaper} onChange={(v) => set('wallpaper', v)} />
          </Row>
        </div>

        <Aside>
          <AsideCard title="What it looks like">
            <LookLike />
          </AsideCard>
        </Aside>

        {/*
          * What other people are told you are doing.
          *
          * Two switches rather than one, because they are different things to
          * agree to: what you are playing is a room you are in, and what you
          * are listening to is closer to what you are thinking about. Both
          * start off - this is the whole of the consent for the feature, so
          * it is turned on, never found and turned off.
          *
          * Only the desktop app can answer either question. In a browser they
          * say so rather than sitting there doing nothing.
          */}
        <div className="card">
          <h4>What you are doing</h4>
          {!shell() && (
            <p className="hint">
              Only the app can see this. In a browser nothing is reported
              whatever these say.
            </p>
          )}
          <Row title="Show the game you are playing"
            detail="Only games the app recognises, and only while one is running">
            <Switch on={settings.showGame} onChange={(v) => set('showGame', v)} />
          </Row>
          <Row title="Show what you are listening to"
            detail="The track, and its cover on your profile">
            <Switch on={settings.showMusic} onChange={(v) => set('showMusic', v)} />
          </Row>
        </div>
      </>
    )
  }

  if (id === 'chat') {
    return (
      <>
        <h2 className="stitle">Chat</h2>
        <div className="card">
          <h4>How messages read</h4>
          <Row title="Line spacing" detail={`${settings.lineHeight}%`}>
            <input type="range" className="rng" min={120} max={200}
              value={settings.lineHeight}
              onChange={(e) => set('lineHeight', Number(e.target.value))} />
          </Row>
          <Row title="Big emoji" detail="A message of nothing but emoji is drawn large">
            <Switch on={settings.jumbo} onChange={(v) => set('jumbo', v)} />
          </Row>
          <Row title="Shortcodes" detail="Turn :fire: into 🔥 — off if you would rather write it">
            <Switch on={settings.shortcodes} onChange={(v) => set('shortcodes', v)} />
          </Row>
          <Row title="Link previews"
            detail="Asked for by this server on your behalf, so no site learns you read it">
            <Switch on={settings.previews} onChange={(v) => set('previews', v)} />
          </Row>
        </div>

        <Aside>
          <AsideCard title="What it looks like">
            <LookLike />
          </AsideCard>
        </Aside>
      </>
    )
  }

  if (id === 'accessibility') {
    return (
      <>
        <h2 className="stitle">Accessibility</h2>
        <div className="card">
          <Row title="Less motion"
            detail="Stops the shimmer on names, the typing dots and the ambient wash">
            <Switch on={settings.reduceMotion} onChange={(v) => set('reduceMotion', v)} />
          </Row>
        </div>
      </>
    )
  }

  if (id === 'blocked') {
    return (
      <>
        <h2 className="stitle">Blocked people</h2>
        <p className="ssub">
          They cannot message you, ring you, or ask to be your friend, and
          what they say in a server you share is hidden. They are not told,
          now or ever.
        </p>
        <Blocked server={server} />
      </>
    )
  }

  if (id === 'account') {
    return (
      <>
        <h2 className="stitle">My account</h2>
        {/* Read-only until now: the settings screen could change how the app
            looked and nothing whatever about the person using it. */}
        <MePane server={server} me={world.me} onSaved={onMe} />
        <div className="card">
          <Row title="Account" detail="Your name on this server, which cannot change">
            <span className="lab">@{world.me.username}</span>
          </Row>
        </div>
        <Password server={server} />
        <div className="card">
          <Row title="Sign out" detail="On this device. Nothing is deleted.">
            <button className="btn d" onClick={onOut}>Sign out</button>
          </Row>
        </div>
      </>
    )
  }

  if (id === 'notifications') {
    return (
      <>
        <h2 className="stitle">Notifications</h2>
        <p className="ssub">
          Only while you are away from the window — a notification for
          something already on screen in front of you is the one that teaches
          people to turn the lot off.
        </p>
        <Notifications settings={settings} set={set} />

        <Aside>
          <AsideCard title="Hear it">
            <p className="asp">
              The sound a message makes, so you know what you are agreeing to
              before it happens at three in the morning.
            </p>
            <TrySound on={settings.sounds} />
          </AsideCard>
        </Aside>
      </>
    )
  }

  if (id === 'voice') {
    return (
      <>
        <h2 className="stitle">Voice &amp; video</h2>
        <p className="ssub">
          Which microphone, and what is done to it on the way out.
        </p>
        <VoicePane settings={settings} set={set} />

        {/* No second meter here. There is a live one beside the sensitivity
            setting, which is where it belongs - a level bar is only useful
            next to the threshold it is being compared against. */}      </>
    )
  }

  if (id === 'whatsnew') {
    return (
      <>
        <h2 className="stitle">What’s new</h2>
        <p className="ssub">
          The last few releases, and what each of them changed.
        </p>
        <div className="card">
          <Changelog server={server} />
        </div>
      </>
    )
  }

  if (id === 'about') {
    const build = runningBuild()
    return (
      <>
        <h2 className="stitle">About</h2>
        <p className="ssub">
          Atrium, in React and TypeScript. Everything you type is drawn as
          text: this build makes no markup out of anything a person wrote,
          which is what a chat app has to get right.
        </p>

        {/*
          * Which build this is, where it came from, and how to say so.
          *
          * The pane had one row on it - a reset button - and the first
          * question of every bug report is the version, which was readable
          * only in the corner of the nav. It is stated here as well, as
          * something you can select and read out.
          */}
        <div className="card">
          <h4>This build</h4>
          <Row title="Version" detail="Baked in when the app was built. Worth putting in a bug report.">
            <span className="lab mono">{versionLabel(shell()?.version, build)}</span>
          </Row>
          {build && (
            <Row title="Build" detail="A hash of exactly what was delivered to this window.">
              <span className="lab mono">{build.slice(0, 7)}</span>
            </Row>
          )}
          {isDesktop() && <UpdateRow />}
        </div>

        <div className="card">
          <h4>This machine</h4>
          {isDesktop() && <StartupRow />}
          <Row title="Back to the defaults"
            detail="Only what is on this machine — nothing about your account">
            <button className="btn" onClick={reset}>Reset</button>
          </Row>
        </div>

        <Aside>
          <AsideCard title="Something wrong?">
            <p className="asp">
              Say what you did, what happened, and what you expected instead.
            </p>
            <p className="asp">
              Include <b className="mono">{versionLabel(shell()?.version, build)}</b> — half
              of a bug report is knowing which build it is.
            </p>
          </AsideCard>
        </Aside>
      </>
    )
  }

  /* The panes that are still to come say so rather than showing an empty
     screen, which reads as something being broken. */
  return (
    <>
      <h2 className="stitle">{id[0]!.toUpperCase() + id.slice(1)}</h2>
      <p className="ssub">Not built yet in this version.</p>
    </>
  )
}

/**
 * Start with the computer, or not.
 *
 * A property of the installed app rather than of the account, which is why it
 * is on this card and not one that follows you to another machine: the login
 * item belongs to this Windows user on this PC.
 *
 * The switch reads the shell rather than remembering: the login item can be
 * turned off outside the app - Task Manager's Startup tab does exactly that -
 * and a switch that says "on" because that is what it was last told is worse
 * than no switch, because it is confidently wrong about something the person
 * can see elsewhere.
 *
 * Started this way, Atrium waits in the tray instead of opening a window at
 * somebody who has just logged in. Everything behind it is running, so the
 * window is instant when it is asked for.
 */
export function StartupRow() {
  const [on, setOn] = useState<boolean | null>(null)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    const ask = shell()?.getSystemPrefs
    /* An older shell has the bridge but not this call. Nothing to offer, and
       nothing broken - so the row simply does not appear. */
    if (!ask) { setRefused(true); return }
    let alive = true
    void ask()
      .then((p) => { if (alive) setOn(Boolean(p.launchOnStartup)) })
      .catch(() => { if (alive) setRefused(true) })
    return () => { alive = false }
  }, [])

  /* Nothing is drawn until the shell has said which way it is. A switch
     showing "off" while it waits is a switch that is wrong for a moment and
     then moves on its own, which reads as the app changing the setting. */
  if (refused || on === null) return null

  return (
    <Row
      title="Open Atrium when I log in"
      detail="It waits in the tray rather than opening a window, so it is ready when you want it."
    >
      <Switch
        on={on}
        onChange={(want) => {
          const set = shell()?.setSystemPref
          if (!set) return
          /* Moved when the shell confirms, not when the switch is clicked.
             Windows can refuse to write the login item - a locked-down
             profile, a policy - and a switch that flips anyway would be
             claiming something that did not happen. */
          void Promise.resolve(set('launchOnStartup', want))
            .then((prefs) => {
              const said = prefs as { launchOnStartup?: boolean } | undefined
              setOn(typeof said?.launchOnStartup === 'boolean' ? said.launchOnStartup : want)
            })
            .catch(() => { setRefused(true) })
        }}
      />
    </Row>
  )
}

/**
 * Whether there is an update, asked of the shell that would know.
 *
 * Only the desktop app can answer: a page is whatever the server is serving
 * and updates by being reloaded. The row says what the state actually is
 * rather than offering a button that cannot do anything.
 */
function UpdateRow() {
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <Row title="Updates" detail={said || 'It checks on its own, quietly. This asks now.'}>
      <button className="btn" disabled={busy} onClick={() => {
        const sh = shell()
        if (!sh) return
        setBusy(true)
        setSaid('Asking…')
        void sh.updateState()
          .then((state) => {
            setSaid(
              state.stage === 'ready' ? `Version ${state.version} is ready to install.`
                : state.stage === 'downloading' ? `Downloading ${state.version}…`
                  : state.stage === 'available' ? `Version ${state.version} is available.`
                    : state.stage === 'error' ? (state.error || 'That did not work.')
                      : 'You are on the newest one.',
            )
          })
          .catch(() => setSaid('Could not ask right now.'))
          .finally(() => setBusy(false))
      }}>
        Check now
      </button>
    </Row>
  )
}

/**
 * The notification sound, on demand.
 *
 * Says so rather than doing nothing when sounds are off - a button that
 * plays silence is indistinguishable from one that is broken, and this is
 * the pane where the switch that silenced it lives.
 */
function TrySound({ on }: { on: boolean }) {
  const [said, setSaid] = useState('')
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          if (!on) { setSaid('Sounds are off, so there is nothing to hear.'); return }
          playPing()
          setSaid('That is the one.')
        }}
      >
        Play it
      </button>
      <p className="said" role="status" aria-live="polite">{said}</p>
    </>
  )
}

/**
 * Changing your password.
 *
 * The current one is asked for because the server asks for it: a session that
 * has been left open on somebody else's machine should not be a way to lock
 * the owner out of their own account.
 */
/**
 * Who you have blocked, and the way back.
 *
 * Fetched rather than read from the world, which carries ids alone - a list
 * of ids is not a list anybody can act on, and the whole reason this pane
 * exists is that the person may no longer appear anywhere else in the app.
 *
 * Nothing here says who has blocked YOU. Nothing anywhere does.
 */
/**
 * What /api/blocks actually answers with.
 *
 * Not User. The route deliberately sends a name and a face and nothing live -
 * no presence, no status, no bio - because it skips the visibility rule, and
 * anything live on it would be a standing feed on somebody you have cut off.
 * Typing it as User declares a dozen fields that are undefined at runtime,
 * which is the trap that hid the mutual-route bug: the next person to draw an
 * <Avatar> here would get a silently broken render and a type that said it
 * was fine.
 */
type BlockedPerson = Pick<User, 'id' | 'username' | 'discriminator' | 'display_name' | 'avatar_path'>

function Blocked({ server }: { server: Api }) {
  const [rows, setRows] = useState<BlockedPerson[] | null>(null)
  const [said, setSaid] = useState('')

  const load = useCallback(() => {
    void server.get<{ blocked?: BlockedPerson[] }>('/api/blocks')
      .then((r) => setRows(r.blocked ?? []))
      .catch((e: unknown) => {
        setRows([])
        setSaid(e instanceof Error ? e.message : 'That would not load.')
      })
  }, [server])

  useEffect(load, [load])

  const lift = (id: string) => {
    void server.delete(`/api/blocks/${encodeURIComponent(id)}`)
      .then(() => {
        /* The world holds the list too, and the frame that carries it only
           arrives on this account's own sockets - so the app behind this
           window is told by the same event. Reloading here is for this
           pane, which is not drawn from it. */
        setSaid('')
        load()
      })
      .catch((e: unknown) => setSaid(e instanceof Error ? e.message : 'That would not save.'))
  }

  return (
    <div className="card">
      {rows === null && <p className="hint">Reading…</p>}
      {rows?.length === 0 && !said && (
        <p className="hint">You have not blocked anybody.</p>
      )}

      {rows?.map((u) => (
        <Row
          key={u.id}
          title={u.display_name || u.username}
          detail={`${u.username}#${u.discriminator}`}
        >
          <button className="btn" onClick={() => lift(u.id)}>Unblock</button>
        </Row>
      ))}

      {/* Said once, at the bottom, because it is the thing people expect
          and do not get: lifting a block does not make you friends again. */}
      {(rows?.length ?? 0) > 0 && (
        <p className="hint">
          Unblocking somebody does not put back a friendship the block ended.
        </p>
      )}
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

function Password({ server }: { server: Api }) {
  const ids = useId()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [said, setSaid] = useState('')

  return (
    <div className="card">
      <h4>Password</h4>
      {/* The labels are tied to the boxes rather than merely sitting above
          them: a <label> that names nothing is a caption, and a screen
          reader asked about either of these boxes had nothing to say. */}
      <div className="fld">
        <label htmlFor={`${ids}-now`}>The one you have</label>
        <input id={`${ids}-now`} type="password" value={current}
          autoComplete="current-password"
          onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <div className="fld">
        <label htmlFor={`${ids}-next`}>The one you want</label>
        <input id={`${ids}-next`} type="password" value={next}
          autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)} />
      </div>
      <button className="btn p" disabled={!current || !next} onClick={() => {
        void server.post('/api/me/password', { current, next })
          .then(() => {
            setSaid('Changed.')
            /* Not left in the boxes. A password sitting in a form somebody
               has walked away from is the thing this just protected. */
            setCurrent('')
            setNext('')
          })
          .catch((e: unknown) =>
            setSaid(e instanceof Error ? e.message : 'That would not change.'))
      }}>Change it</button>
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/**
 * Turning notifications on, which is when the browser is asked.
 *
 * Asked here rather than at the first message: a permission prompt nobody
 * asked for is the thing people refuse on reflex, and a refusal is far harder
 * to undo than it was to give.
 */
function Notifications({ settings, set }: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
}) {
  const [said, setSaid] = useState('')
  const supported = typeof Notification !== 'undefined'

  return (
    <div className="card">
      <Row
        title="Tell me about messages"
        detail={supported
          ? 'While the window is behind something else, or closed.'
          : 'This browser does not have them.'}
      >
        <Switch
          on={settings.notifications && supported}
          onChange={(want) => {
            if (!want) { set('notifications', false); setSaid(''); return }
            if (!supported) { setSaid('This browser does not have notifications.'); return }
            void Notification.requestPermission().then((answer) => {
              /* Only on once the browser has actually agreed. Set first and
                 refused after, the switch says yes and nothing ever appears —
                 which reads as the feature being broken. */
              if (answer === 'granted') { set('notifications', true); setSaid('') }
              else setSaid('The browser said no. It can be changed in its own settings.')
            })
          }}
        />
      </Row>
      <Row title="Sounds"
        detail="Arriving and leaving a call, somebody sharing, a message landing, and a call ringing.">
        <Switch on={settings.sounds} onChange={(v) => set('sounds', v)} />
      </Row>
      <Row title="Unread count in the tab" detail="The only notification some people want.">
        <Switch on={settings.tabCount} onChange={(v) => set('tabCount', v)} />
      </Row>
      {isDesktop() && (
        <Row
          title="Hold a key to talk"
          detail={settings.pushToTalk
            ? `Held: ${settings.pushToTalk}. It works while the app is behind a game.`
            : 'A key the whole machine listens for, so it works behind a game.'}
        >
          <input
            className="lab"
            style={{ width: 130 }}
            value={settings.pushToTalk}
            placeholder="e.g. CommandOrControl+`"
            onChange={(e) => set('pushToTalk', e.target.value)}
          />
        </Row>
      )}
      {said && <p className="hint">{said}</p>}
    </div>
  )
}

/**
 * The microphone, and what happens to it.
 *
 * The three processing switches are on by default and want to stay that way
 * for almost everybody: two people in one room without echo cancellation is
 * a feedback loop, and that is the common case rather than the exotic one.
 * They are here because the exceptions are real — a good microphone through
 * an interface is made worse by all three.
 */
/**
 * Where "talking" starts, and who decides it.
 *
 * Automatic by default, because the manual version of this asks somebody for
 * a number in units nobody has - measured against a microphone whose gain
 * nobody knows, in a room nobody has measured - and the only honest way to
 * answer is to talk, watch a bar, and guess. The app can watch the room and
 * put the line in the gap between it and a voice.
 *
 * No slider while it is doing that, deliberately. A control showing a number
 * nothing reads is worse than no control: people set it, nothing changes, and
 * they conclude the feature is broken.
 *
 * The bar and its marker run through the same scale as the gate in a call, so
 * lining a voice up against the line here is lining it up against what will
 * actually happen.
 */
function Sensitivity({ settings, set }: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
}) {
  const [level, setLevel] = useState(0)
  const [line, setLine] = useState(settings.gate)
  /*
   * The numbers behind the bar, for when it is wrong.
   *
   * "Sometimes it does not pick up when I am talking" is not something a bar
   * can answer: the bar moves either way, and the question is whether it
   * reached the line. The loudest reading is the one that settles it - if a
   * whole sentence never got past the line, that is the diagnosis, and no
   * amount of watching a bar says so.
   *
   * Kept since this pane opened rather than over a window, so it survives a
   * sentence being said and then looked at.
   */
  const [seen, setSeen] = useState({ floor: 0, peak: 0, open: false })
  /* Held outside the listener so it can be put back to nothing without
     stopping and reopening the microphone to do it. */
  const peak = useRef(0)

  useEffect(() => {
    let meter: Meter | null = null
    let alive = true
    const gate = new AutoGate({ fixed: settings.gateAuto ? null : settings.gate })
    let last = Date.now()

    void listen(settings.mic, (l) => {
      const now = Date.now()
      gate.push(l, now - last)
      last = now
      if (l > peak.current) peak.current = l
      /*
       * Not while nobody is looking.
       *
       * Fifty readings a second, each of them two pieces of state and a
       * redraw of this pane, for a bar that is behind another window. The
       * microphone stays open - it is the same microphone either way, and
       * letting it go would mean asking for it again on the way back - but
       * the drawing stops.
       */
      if (!isWatching()) return
      setLevel(l)
      /* Read back rather than worked out again here: the line drawn is the
         line the gate is using, which is the whole point of them sharing
         one class. */
      setLine(gate.threshold)
      setSeen({ floor: gate.noiseFloor, peak: peak.current, open: gate.isOpen })
    }, {
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    }).then((m) => {
      if (!alive) { m?.stop(); return }
      meter = m
    })

    /* The microphone goes back when this pane closes. A settings screen that
       leaves the light on is the complaint nobody makes politely. */
    return () => { alive = false; meter?.stop() }
  }, [settings.mic, settings.gateAuto, settings.gate,
    settings.echoCancellation, settings.noiseSuppression, settings.autoGainControl])

  /* Drawn against the bar's own range, not the gate's: a voice goes well
     past where a hand-drawn line is allowed to stop. */
  const pct = (v: number) => `${Math.min(100, (v / BAR_MAX) * 100)}%`

  return (
    <div className="card">
      <Row
        title="Input sensitivity"
        detail="When your microphone counts as you talking rather than as the room."
      >
        <span className="segm">
          <button className={settings.gateAuto ? 'on' : ''}
            onClick={() => set('gateAuto', true)}>Automatic</button>
          <button className={settings.gateAuto ? '' : 'on'}
            onClick={() => set('gateAuto', false)}>Manual</button>
        </span>
      </Row>

      {/*
        * The bar is in the column beside this, not in the middle of it.
        *
        * It is what both settings are read against - on automatic it is the
        * only way to see what the app decided, and on manual it is what the
        * slider is aimed at - so it is a thing to *watch* while changing the
        * rows here, which is exactly what that column is for. One meter, and
        * one microphone: mirroring it would mean opening the device twice.
        */}
      <Aside>
        <AsideCard title="Microphone test">
          <p className="asp">{settings.gateAuto
            ? 'Say something. The mark is where it decided the line goes.'
            : 'Say something, and put the mark just under where your voice reaches.'}</p>
          <span className="meter">
            <span className="lvl" style={{ width: pct(level) }} />
            {/* Drawn through the same scale as the bar it sits on. Through a
                different one it sat at half the place it claimed. */}
            <span className="rng" style={{ left: pct(line) }} />
          </span>

          {/*
            * The same four things as numbers.
            *
            * A bar answers "is it hearing me" and not "why not". The one that
            * settles it is the loudest reading against the line: a whole
            * sentence that never got past the line is the whole diagnosis,
            * and watching a bar cannot tell you that it did not - by the time
            * you look, the bar has gone back down.
            */}
          <dl className="gaten">
            <div><dt>Loudest</dt><dd>{seen.peak.toFixed(1)}</dd></div>
            <div><dt>The line</dt><dd>{line.toFixed(1)}</dd></div>
            <div><dt>The room</dt><dd>{seen.floor.toFixed(1)}</dd></div>
            <div><dt>Now</dt><dd>{seen.open ? 'sending' : 'quiet'}</dd></div>
          </dl>
          <p className="asp">
            {seen.peak > 0 && seen.peak < line
              ? 'Nothing has reached the line yet — say a full sentence.'
              : 'Loudest is the highest your voice has reached since this opened.'}
          </p>
          <button className="btn" onClick={() => {
            peak.current = 0
            setSeen((s) => ({ ...s, peak: 0 }))
          }}>Start again</button>
        </AsideCard>
      </Aside>

      {!settings.gateAuto && (
        <Row title="Activation threshold" detail={`${Math.round(settings.gate)}`}>
          <input
            type="range" className="rng" min={GATE_MIN} max={GATE_MAX}
            value={settings.gate}
            onChange={(e) => set('gate', Number(e.target.value))}
          />
        </Row>
      )}
    </div>
  )
}

function VoicePane({ settings, set }: {
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
}) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([])
  const [said, setSaid] = useState('')

  /*
   * Asked for by name only once permission has been given: before that a
   * browser answers with a list of blank labels, which is a menu of empty
   * rows. So the list is fetched when this pane opens and again after asking.
   */
  const load = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return
    const all = await navigator.mediaDevices.enumerateDevices()
    setMics(all.filter((d) => d.kind === 'audioinput'))
    setOuts(all.filter((d) => d.kind === 'audiooutput'))
  }, [])

  useEffect(() => { void load() }, [load])

  const named = mics.some((m) => m.label)
  /* Whether this browser can send sound to a chosen device at all. */
  const canChooseOutput = typeof HTMLMediaElement !== 'undefined'
    && 'setSinkId' in HTMLMediaElement.prototype

  return (
    <>
      <div className="card">
        <Row title="Microphone" detail={named
          ? 'The one a call listens to.'
          : 'Their names appear once this page has been allowed to hear one.'}>
          {/* Not `lab`, which is the small uppercase style for a caption -
              worn by a menu it turned every device name into shouting. */}
          <select
            className="pick"
            value={settings.mic}
            onChange={(e) => set('mic', e.target.value)}
          >
            <option value="">Whichever the machine offers</option>
            {mics.map((m, i) => (
              <option key={m.deviceId || i} value={m.deviceId}>
                {m.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </Row>

        {/*
          * And where it comes out.
          *
          * There was no choice at all: every call played through whatever the
          * machine was using, which is wrong for anybody with a headset and
          * speakers both plugged in - the usual case for the people this is
          * for.
          *
          * Only offered where the browser can actually do it. setSinkId is
          * not everywhere, and a menu that changes nothing is worse than no
          * menu, because it takes a real problem and makes it look solved.
          */}
        {canChooseOutput && (
          <Row title="Output" detail={named
            ? 'Where a call comes out.'
            : 'Their names appear once this page has been allowed to hear one.'}>
            <select
              className="pick"
              value={settings.speaker}
              onChange={(e) => set('speaker', e.target.value)}
            >
              <option value="">Whichever the machine uses</option>
              {outs.map((o, i) => (
                <option key={o.deviceId || i} value={o.deviceId}>
                  {o.label || `Output ${i + 1}`}
                </option>
              ))}
            </select>
          </Row>
        )}

        {!named && (
          <Row title="" detail="">
            <button className="btn" onClick={() => {
              void navigator.mediaDevices.getUserMedia({ audio: true })
                .then((stream) => {
                  /* Let go of it immediately. The point was the permission,
                     and a page holding a microphone open shows a recording
                     light for as long as it is left. */
                  for (const t of stream.getTracks()) t.stop()
                  return load()
                })
                .catch(() => setSaid('The browser would not allow it.'))
            }}>Let this page hear a microphone</button>
          </Row>
        )}
        {said && <p className="hint">{said}</p>}
      </div>

      <div className="card">
        <Row title="Echo cancellation"
          detail="Two people in one room without it is a feedback loop.">
          <Switch on={settings.echoCancellation}
            onChange={(v) => set('echoCancellation', v)} />
        </Row>
        <Row title="Noise suppression" detail="Fans, keyboards, the room itself.">
          <Switch on={settings.noiseSuppression}
            onChange={(v) => set('noiseSuppression', v)} />
        </Row>
        <Row title="Automatic gain"
          detail="Evens out how loud you are. A good microphone is usually better without it.">
          <Switch on={settings.autoGainControl}
            onChange={(v) => set('autoGainControl', v)} />
        </Row>
      </div>

      <Sensitivity settings={settings} set={set} />

      <div className="card">
        <Row title="How loud everybody is" detail={`${settings.volume}%`}>
          <input
            type="range" className="rng" min={0} max={100} value={settings.volume}
            onChange={(e) => set('volume', Number(e.target.value))}
          />
        </Row>
        <p className="hint">
          Voices only. A shared screen has its own, on its tile — one slider
          for both means turning down a game turns down the person telling you
          about it.
        </p>
      </div>
    </>
  )
}
