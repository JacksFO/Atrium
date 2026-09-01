import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Settings } from '../lib/settings'
import type { World } from '../lib/world'
import type { Api } from '../lib/api'
import type { User } from '../lib/wire'
import { Icon, type IconName } from './Icon'
import { useEscape } from './useEscape'
import { shell } from '../lib/shell'
import { runningBuild } from '../lib/stale'
import { versionLabel } from '../lib/whichBuild'
import { findSettings } from '../lib/settingsIndex'
import { GROUPS, Pane, Wanted, type PaneId } from './Settings'
import { ServerPane, serverPanesFor, type ServerPaneId } from './ServerSettings'
import type { Space } from '../lib/wire'

/**
 * The settings window.
 *
 * A window over the app rather than the app replaced. It used to fill
 * everything under the top bar, so opening settings looked like leaving
 * Atrium — there was nothing of the app left on screen to say you had not.
 *
 * Three columns, and the third is the point of the rewrite. A pane used to be
 * a column of rows and nothing else, so every setting had to be *described*:
 * "cosy" and "compact" mean nothing until you see them, and the only way to
 * find out whether your microphone worked was to join a call and ask somebody.
 * The third column is whatever the pane can show instead of say — a live
 * preview, a level meter, a test button, the sidebar you are rearranging.
 *
 * Panes put things there with <Aside>, which is a portal rather than a prop:
 * the state a preview needs belongs to the pane that owns the controls, and
 * lifting it into this component to hand back down would put every pane's
 * innards in one place.
 *
 * Your settings and a server's are one window. They were two, reached two
 * different ways, and "which of the two windows was that in" is the same
 * problem as "which pane was that in" with an extra step. The server's group
 * appears only when you are in one, and lists only the panes your permissions
 * allow - a gated pane is absent, not disabled.
 */

/**
 * Whether there is room for the pane list and a pane side by side.
 *
 * There is not, on a phone. Two columns at 360px leaves about 210px for the
 * pane, which is narrower than a row of a label and the control it belongs
 * to - the dropdowns in Voice ran off the side of the screen and the pane
 * list's own buttons came out 135px wide, under a fingertip's worth of
 * target. So on a phone the list and the pane are two screens instead, which
 * is what every other phone settings screen does and for the same reason.
 *
 * Asked of the same breakpoint the stylesheet uses, so the two cannot drift
 * apart. Guarded because jsdom has no matchMedia and several tests render
 * this window.
 */
const NARROW = '(max-width:820px)'

function useNarrow(): boolean {
  const ask = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(NARROW).matches
  const [narrow, setNarrow] = useState(ask)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** Where <Aside> puts what it is given. Null until the column exists. */
const AsideHost = createContext<HTMLElement | null>(null)

/**
 * The third column, written from inside a pane.
 *
 * On a phone there is no column, so what is written here follows the pane
 * instead — the previews and the sound test are worth more there than the
 * column shape is. It renders nothing only while the window is being built,
 * before the place to put it exists.
 */
export function Aside({ children }: { children: React.ReactNode }) {
  const host = useContext(AsideHost)
  return host ? createPortal(children, host) : null
}

/** A titled block in the third column. */
export function AsideCard({ title, children }: {
  title: string
  children: React.ReactNode
}) {
  return (
    <>
      <h4 className="asttl">{title}</h4>
      <div className="ascard">{children}</div>
    </>
  )
}

/*
 * There was an AsideNote here: an accented block with an icon and a title,
 * for "the one thing worth saying about a pane that has nothing to show".
 *
 * Seven of them, and they were commentary rather than settings - restating
 * what a row's own detail already said, or explaining the pane to somebody
 * who was already looking at it. The third column still earns its width with
 * things you can use: a live preview, a sound you can play, the sidebar as it
 * will look. A column that says nothing you can act on is a column that
 * teaches people not to read it.
 */

export function SettingsWindow({
  world, settings, set, reset, onOut, onClose, server, onMe, openOn, onArrange,
  space = null, permissions = [], onChanged = () => {},
}: {
  world: World
  settings: Settings
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  reset: () => void
  onOut: () => void
  onClose: () => void
  /** Start arranging the columns, which happens on the app rather than here. */
  onArrange: () => void
  server: Api
  onMe: (user: User) => void
  /** Where to land, for somebody who asked for a particular pane rather than
   *  for settings. "All the release notes" opened on the account, which is
   *  the one pane it certainly did not mean. */
  openOn?: PaneId | ServerPaneId
  /** The server being looked at, if any. Its group is only offered in one. */
  space?: Space | null
  /** What this account may do in that server. */
  permissions?: readonly string[]
  /** Something changed in the server that the rest of the app reads. */
  onChanged?: () => void
}) {
  /*
   * Every group, with the server's on the end when there is one.
   *
   * Built here rather than imported whole, because the last group is named
   * after the server it is about - "Jack's Place", not "Server" - and its
   * contents depend on what this account may do in it.
   */
  const groups: ReadonlyArray<
    readonly [string, ReadonlyArray<readonly [PaneId | ServerPaneId, string, IconName]>]
  > = (() => {
    if (!space) return GROUPS
    const mine = serverPanesFor(permissions)
    /*
     * Nothing to offer means no heading either.
     *
     * The window this replaced had a screen for it - "there is nothing here
     * you can change in here" - because it had nothing else to show. This
     * one is full of your own settings, so the honest thing is for the server
     * simply not to appear. A heading with nothing under it is worse than the
     * sentence was.
     */
    if (mine.length === 0) return GROUPS
    /*
     * The server goes above "This build", not after it.
     *
     * That last group is about the copy of Atrium you are running rather
     * than about you or about anywhere you are - so it belongs at the end of
     * the list whatever else is in it. Appending the server after it put a
     * server's settings below the version number, which reads as an
     * afterthought stuck on the bottom.
     */
    const build = GROUPS[GROUPS.length - 1]!
    const rest = GROUPS.slice(0, -1)
    return [
      ...rest,
      [space.name, mine.map(([id, label, , icon]) => [id, label, icon] as const)] as const,
      build,
    ]
  })()

  const serverIds = new Set(groups.flatMap(([, items]) => items)
    .map(([id]) => id)
    .filter((id): id is ServerPaneId => !GROUPS.flatMap(([, i]) => i).some(([p]) => p === id)))

  /* Otherwise the account, which is what somebody who came here to change
     their name or their picture is looking for. */
  const [pane, setPane] = useState<PaneId | ServerPaneId>(openOn ?? 'account')
  /* The key cap beside the close button says ESC, so ESC closes it - but on
     a phone, where a pane is its own screen, it steps back to the list
     first. Leaving the whole window on one press would throw away where you
     were, which is not what a back gesture means anywhere else. */
  useEscape(() => {
    if (narrowRef.current && openedRef.current) { setOpened(false); return }
    onClose()
  })

  /* Which row was asked for, so the pane it is on can point at it. Cleared
     once it has been shown: a setting that stays lit is one somebody keeps
     wondering about. */
  const [lookingFor, setLookingFor] = useState<string | null>(null)
  const wanted = useMemo(
    () => ({ title: lookingFor, shown: () => setLookingFor(null) }),
    [lookingFor],
  )

  /*
   * Looking for a setting rather than for the drawer it is in.
   *
   * In the top bar rather than over the pane list, because it searches the
   * whole window and not the column it sits in. While there is something
   * typed the results hang under the box; the pane list underneath is left
   * alone, so the place you were is still where you left it if nothing
   * matches.
   */
  const [query, setQuery] = useState('')
  /*
   * Whether the results have been dealt with.
   *
   * The words stay in the box after choosing one - somebody who landed on the
   * wrong one of two results wants the other still listed, not a list to type
   * again - but the list itself has to get out of the way, because it hangs
   * over the pane it just opened. Typing again, or coming back to the box,
   * brings it back.
   */
  const [picked, setPicked] = useState(false)
  const found = findSettings(query)
  const searching = query.trim().length > 0 && !picked

  const [asideHost, setAsideHost] = useState<HTMLDivElement | null>(null)

  /*
   * On a phone the list and the pane are two screens. Somebody who asked for
   * a particular pane lands on it; somebody who asked for settings lands on
   * the list, because on a phone the list is the screen and picking from it
   * is the whole navigation.
   */
  const narrow = useNarrow()
  const [opened, setOpened] = useState(!!openOn)
  /* useEscape is given its handler once, so it reads these rather than
     closing over whatever they were when the window opened. */
  const narrowRef = useRef(narrow)
  const openedRef = useRef(opened)
  narrowRef.current = narrow
  openedRef.current = opened

  const groupOf = (id: PaneId | ServerPaneId) =>
    groups.find(([, items]) => items.some(([p]) => p === id))?.[0] ?? ''
  const labelOf = (id: PaneId | ServerPaneId) =>
    groups.flatMap(([, items]) => items).find(([p]) => p === id)?.[1] ?? ''

  /*
   * A pane can stop being offered while you are on it - somebody's permission
   * is taken away, or they leave the server - and a window showing a pane its
   * own list no longer has is a window with no way back to anything.
   */
  const showing = groups.some(([, items]) => items.some(([p]) => p === pane))
    ? pane
    : 'account'

  const goTo = (id: PaneId, row?: string) => {
    setPane(id)
    setLookingFor(row ?? null)
    setPicked(true)
    setOpened(true)
  }

  /* Which of the two the phone is showing. On anything wider, both. */
  const showList = !narrow || !opened
  const showPane = !narrow || opened

  const find = (
    <div className="sfind">
      <Icon name="search" size={14} />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setPicked(false) }}
        onFocus={() => setPicked(false)}
        placeholder="Search settings"
        aria-label="Search settings"
      />
      {searching && (
        <div className="shits" role="listbox" aria-label="Results">
          {found.length === 0
            ? <p className="none">Nothing matches that.</p>
            : found.map((f) => (
              <button
                key={`${f.pane}:${f.title}`}
                className="shit"
                role="option"
                aria-selected={false}
                onClick={() => goTo(f.pane, f.title)}
              >
                <b>{f.title}</b>
                <span>{f.where}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )

  return (
    /*
     * Pressing the dimmed part closes it, which is what everybody tries
     * first. Mousedown on the scrim itself rather than a click, so that a
     * selection begun inside the window and released outside it is not
     * mistaken for pressing the backdrop.
     */
    <div
      className="setscrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Both classes on purpose: `settings` is what the rows, cards and the
          profile pane inside are already styled against, and `setwin` carries
          the window this now sits in. Dropping the first would have restyled
          everything under it by accident. */}
      <div className="settings setwin" role="dialog" aria-modal="true" aria-label="Settings">
        <header className="stop">
          {narrow && opened && (
            <button className="sback" onClick={() => setOpened(false)}
              title="All settings" aria-label="Back to all settings">
              <Icon name="chev" size={17} />
            </button>
          )}
          <span className="scrumb">
            {narrow
              ? <b>{opened ? labelOf(showing) : 'Settings'}</b>
              : (
                <>
                  <span>{groupOf(showing)}</span>
                  <span className="sep">›</span>
                  <b>{labelOf(showing)}</b>
                </>
              )}
          </span>
          <span className="gw" />
          {/* In the bar where there is room for it, and on the list screen
              where there is not: squeezed between a back arrow, a title and
              a close button on a 360px phone it came out 71px wide and 22
              tall, which is neither readable nor hittable. */}
          {!narrow && find}
          <button className="sx" onClick={onClose} title="Close settings" aria-label="Close settings">
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="sgrid" data-only={narrow ? (opened ? 'pane' : 'list') : undefined}>
          {showList && (
          <nav className="snav">
            {narrow && find}
            {groups.map(([group, items]) => (
              <div key={group}>
                <p className="grp">{group}</p>
                {items.map(([id, label, icon]) => (
                  <button key={id} className={id === showing ? 'on' : ''}
                    aria-current={id === showing}
                    onClick={() => {
                      setPane(id)
                      setLookingFor(null)
                      setQuery('')
                      setPicked(false)
                      /* On a phone this is what opens the pane: the list and
                         the pane are two screens, and picking from the list
                         is the whole of the navigation between them. */
                      setOpened(true)
                    }}>
                    <Icon name={icon} size={15} />{label}
                  </button>
                ))}
              </div>
            ))}

            {/*
              * Which build this is, in the corner.
              *
              * Asked for because it is the first question of every bug report
              * and there was nowhere to read it: the desktop app knew its
              * version and never said it anywhere a person could see, and a
              * page had no way at all. The spacer above it is what puts it at
              * the bottom rather than wherever the list of panes ends.
              */}
            <span className="gw" />
            <div className="sver" title="The build you are running. Worth including in a bug report.">
              <b>Atrium</b>
              <span>{versionLabel(shell()?.version, runningBuild())}</span>
            </div>
          </nav>
          )}

          {showPane && (
          <div className="smain">
            {/* A measure rather than the whole column: a label on the far left
                and a switch on the far right is a row nobody can pair up. */}
            <div className="sin">
              {/* Rows are several components below this; the one that was asked
                  for finds out through here rather than through thirty props. */}
              <Wanted.Provider value={wanted}>
                <AsideHost.Provider value={asideHost}>
                  {serverIds.has(showing as ServerPaneId) && space
                    ? (
                      <ServerPane id={showing as ServerPaneId} server={server} world={world}
                        space={space} permissions={permissions} onChanged={onChanged}
                        onClose={onClose} />
                    )
                    : (
                      <Pane id={showing as PaneId} world={world} settings={settings} set={set}
                        onArrange={onArrange} reset={reset} onOut={onOut} server={server}
                        onMe={onMe} />
                    )}
                </AsideHost.Provider>
              </Wanted.Provider>
              {/* On a phone the third column has nowhere to be a column, so
                  it follows the pane instead of disappearing. It carries the
                  previews and, in Notifications, the button that plays the
                  sound - losing those on the device most likely to be in a
                  pocket at three in the morning is the wrong way round. */}
              {narrow && <div className="saside asflow" ref={setAsideHost} />}
            </div>
          </div>
          )}

          {!narrow && <div className="saside" ref={setAsideHost} />}
        </div>
      </div>
    </div>
  )
}
