import { reloadApp } from '../lib/reload'
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Api } from '../lib/api'
import { EVERY_MS, isStale, runningBuild } from '../lib/stale'
import { clearToken, readToken, writeToken } from '../lib/session'
import { httpBase } from '../lib/server'
import { useSettings } from '../lib/settings'
import { Boundary } from './Boundary'
import { playReconnect, setSoundEnabled } from '../lib/sound'
import { isWatching, onAttentionChange, watchAttention } from '../lib/attention'
import { SharePicker } from './SharePicker'
import { Shell } from './Shell'
import { InviteCard } from './InviteCard'
import { inviteFromPath } from '../lib/invitelink'
import { SignIn } from './SignIn'
import { ThemeProvider } from './theme'
import { useWorld } from './useWorld'

/**
 * The app, or the way into it.
 *
 * The token is read once, when this first runs, rather than on every render:
 * reading storage is a call that can throw, and doing it repeatedly is both
 * wasteful and a way for two parts of the app to disagree about whether
 * somebody is signed in.
 */
export function App() {
  /*
   * Whether anybody is actually looking at this window.
   *
   * Written onto the document so the stylesheet can stop every animation at
   * once — a name shimmering away on somebody's second monitor while they
   * play a game on the other one is work nobody asked for and nobody sees.
   */
  useEffect(watchAttention, [])


  /*
   * An invite somebody arrived with, from the address they opened.
   *
   * Read once, at the start, and taken straight out of the address bar: a
   * reload should put somebody back in the app rather than offer them the
   * same invite again - and an invite that has been used says "expired",
   * which is a confusing thing to be shown after joining successfully.
   */
  const [invite, setInvite] = useState<string | null>(() => inviteFromPath())
  useEffect(() => {
    if (invite) window.history.replaceState(null, '', '/')
  }, [invite])

  const [token, setToken] = useState(readToken)
  /*
   * Empty in a browser, which means "wherever this page came from"; an
   * address in the packaged desktop app, which has no page from a server to
   * be relative to.
   */
  const server = useMemo(() => new Api({ base: httpBase() }), [])
  server.setToken(token)
  const { settings, set, reset } = useSettings()

  /* One switch for every tone the app has. Told the sound module rather than
     checked at each call site: there are a dozen of those and one of them
     would eventually forget to ask. */
  useEffect(() => { setSoundEnabled(settings.sounds) }, [settings.sounds])

  const signIn = useCallback((t: string) => {
    writeToken(t)
    setToken(t)
  }, [])

  const signOut = useCallback(() => {
    /* Cleared first, so a request that fails on the way out cannot leave
       somebody signed in to a session they asked to end. */
    clearToken()
    setToken('')
    void new Api({ base: httpBase() }).post('/api/logout').catch(() => {})
  }, [])

  return (
    <ThemeProvider
      id={settings.theme}
      fontSize={settings.fontSize}
      look={{
        density: settings.density,
        wallpaper: settings.wallpaper,
        lineHeight: settings.lineHeight,
        reduceMotion: settings.reduceMotion,
      }}
    >
      {token
        ? (
          <Signed
            server={server}
            token={token}
            onOut={signOut}
            settings={settings}
            set={set}
            reset={reset}
          />
        )
        /* Somebody following an invite with no account gets the code
           filled in for them, on the tab for making one. */
        : <SignIn server={server} onIn={signIn}
            {...(invite ? { invite } : {})} />}

      {/*
        * And somebody already signed in is shown what they have been invited
        * to, over the app, with the same card a conversation shows. Which
        * server, how many people are in it, and a button - rather than being
        * dropped into a server they never agreed to join.
        */}
      {invite && token && (
        <div className="scrim"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setInvite(null) }}>
          <div className="invite-arrival">
            <InviteCard server={server} code={invite} />
            <button className="btn" onClick={() => setInvite(null)}>Close</button>
          </div>
        </div>
      )}
    </ThemeProvider>
  )
}

/**
 * Signed in: connect, load, and draw.
 *
 * Nothing is drawn from a half-loaded world. The old client rendered whatever
 * it had and filled in as things arrived, which is how a server with one
 * member in it and a list of channels belonging to nowhere ended up on
 * screen — and looked like data loss rather than a first paint.
 */
function Signed({ server, token, onOut, settings, set, reset }: {
  server: Api
  token: string
  onOut: () => void
  settings: ReturnType<typeof useSettings>['settings']
  set: ReturnType<typeof useSettings>['set']
  reset: ReturnType<typeof useSettings>['reset']
}) {
  const {
    world, gateway, ready, conn, tries, retry, error, clearError, send, version, changed,
  } = useWorld(server, token)
  const stale = useStale(server)

  /*
   * The connection coming back, said out loud.
   *
   * Only after it has been open once: the sound is "you are connected again",
   * and playing it on the first connection of the session is the app
   * congratulating itself for starting.
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (conn !== 'open') return
    if (wasOpen.current) playReconnect()
    wasOpen.current = true
  }, [conn])

  if (!world || !ready) {
    return (
      <div className="gate">
        <div className="gatebox" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
          <div className="gbd">
            <h2>
              {conn === 'open' ? 'Getting your things'
                : conn === 'offline' ? 'Cannot reach the server'
                  : 'Connecting'}
            </h2>
            {/*
              * Which go it is on, and then a way to ask for another.
              *
              * "Trying again" on its own is the same sentence for ever: it
              * says nothing about whether anything is happening or whether it
              * ever will, and a spinner that has been turning for a minute is
              * indistinguishable from one that is stuck. Saying which try
              * this is, and stopping after three, turns waiting into a thing
              * somebody can decide about.
              */}
            <p className="sub">
              {conn === 'reconnecting'
                ? `The connection went. Trying again — ${tries + 1} of 3.`
                : conn === 'offline'
                  ? 'It may be restarting, or your connection may have gone.'
                  : 'One moment.'}
            </p>
            {conn === 'offline' && (
              <div className="ubar">
                <span>Nothing has answered after three tries.</span>
                <button className="btn p" onClick={retry}>Try again</button>
              </div>
            )}
            {stale && (
              /* The page in this tab is no longer the page on the server.
                 Offered rather than forced: reloading in the middle of typing
                 is worse than being a version behind for another minute. */
              <div className="ubar">
                <span>There is a newer version of this app.</span>
                <button className="btn" onClick={reloadApp}>Reload</button>
              </div>
            )}
            {error && (
              <div className="err">
                <span>{error}</span>
                <button className="btn" onClick={clearError}>Try again</button>
              </div>
            )}
            <button className="btn" onClick={onOut}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    /* Around the app rather than around the page: a crash in a panel should
       leave the way out reachable, and the way out is drawn by this. */
    <Boundary>
      {/* Listening from the moment the app is up, not from the moment
          somebody presses share: the main process asks the page the instant
          getDisplayMedia is called, and a listener attached afterwards has
          already missed the question. Draws nothing until then, and nothing
          at all in a browser. */}
      <SharePicker />
      <Shell world={world} server={server} onOut={onOut} send={send}
        gateway={gateway} settings={settings} set={set} reset={reset}
        version={version}
        changed={changed}
        stale={stale} error={error} clearError={clearError} />
    </Boundary>
  )
}

/**
 * Whether a newer build is being served than the one in this tab.
 *
 * Asked rarely, and never in development — every reload there is a different
 * build, and a banner on each one is a banner nobody reads. Failures are
 * silence: a check that cannot reach the server has learned nothing, and a
 * banner for that would appear every time somebody's wifi hiccuped.
 */
function useStale(server: Api): boolean {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    const mine = runningBuild()
    if (!mine) return
    let alive = true

    const ask = () => {
      /* Not while nobody is looking. A tab left open on a second monitor for
         a week is a request every few minutes for an answer nobody is going
         to read, and the check on coming back is the one that matters. */
      if (!isWatching()) return
      void server.get<{ build?: unknown }>('/version.json')
        .then((r) => { if (alive && isStale(mine, r?.build)) setStale(true) })
        .catch(() => { /* nothing learned */ })
    }

    ask()
    const timer = setInterval(ask, EVERY_MS)
    /* And once on coming back, so somebody returning to a tab they left open
       yesterday is told about a build that landed while they were away
       rather than waiting out the rest of the interval. */
    const back = onAttentionChange((watching) => { if (watching) ask() })
    return () => { alive = false; clearInterval(timer); back() }
  }, [server])

  return stale
}
