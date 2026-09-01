/**
 * The desktop shell, where there is one.
 *
 * Everything here is absent in a browser and must read as absent rather than
 * as broken: the same build is served to both, and a page that assumes the
 * bridge is there is a page that throws on the web. So this is one typed view
 * of the bridge, and everything asks `shell()` first.
 */

export type AppAudioSession = { pid: number; name: string; active: boolean }

export type Shell = {
  version: string
  platform: string
  /** A count, a picture to draw it with, and what the tray should say. */
  /**
   * Where to look for the server, told to the shell rather than only to the
   * page.
   *
   * The shell decides what to load before any page exists, so a page that
   * works out an address and keeps it to itself leaves the shell opening the
   * copy inside the installer for ever.
   *
   * Optional because an older shell will not have them, and a client that
   * assumes otherwise breaks on the version somebody has not updated yet.
   */
  setServer?: (url: string) => void
  clearServer?: () => void
  /**
   * The window buttons, when this shell has handed them to the page.
   *
   * Absent in a shell that still gives them to Windows, which is the whole
   * point of asking: drawing our own beside those would be two sets. Absent
   * on macOS too, where hiding the bar leaves the traffic lights.
   */
  windowButtons?: boolean
  minimise: () => void
  toggleMaximise: () => void
  close: () => void
  /** Which glyph the middle one shows. Older shells answer neither. */
  isMaximised?: () => Promise<boolean>
  onMaximised?: (cb: (maximised: boolean) => void) => void
  setBadge: (count: number, icon: string | null, tooltip: string) => void
  flashTaskbar: () => void
  /**
   * The three things that belong to the installed app rather than the page.
   *
   * Optional because a shell built before these existed has the bridge and
   * not the calls, and asking one of those for them is the crash the whole
   * of this file is shaped to avoid. Everything here is per-machine: the
   * login item belongs to this Windows user on this PC, not to an account.
   */
  getSystemPrefs?: () => Promise<{
    launchOnStartup: boolean
    minimiseToTray: boolean
    hardwareAcceleration: boolean
  }>
  setSystemPref?: (key: string, value: boolean) => Promise<unknown>
  /** Registers a global key. False when the system already has it. */
  setPushToTalk: (accelerator: string | null) => Promise<boolean>
  onPushToTalk: (cb: (down: boolean) => void) => void
  appAudio: {
    available: () => Promise<{ available: boolean; reason: string | null }>
    sessions: () => Promise<AppAudioSession[]>
    start: (pid: number) => Promise<{ ok: boolean; error?: string }>
    stop: () => Promise<boolean>
    current: () => Promise<number | null>
    onData: (cb: (chunk: ArrayBuffer) => void) => void
  }
  /**
   * Choosing what to share.
   *
   * Electron will not answer getDisplayMedia by itself: the main process is
   * asked which source to use and asks the page, and until the page answers
   * the request simply waits. Nothing answered it, so pressing share in the
   * desktop app did nothing at all — no picker, no error, no refusal — while
   * the same button worked in a browser, which draws its own.
   */
  /**
   * Updating the app itself.
   *
   * The desktop half of this has been in the shell all along and the client
   * asked it nothing — so an update downloaded quietly in the background and
   * waited for a quit that nobody knew to make, with no sign on screen that
   * there was anything to restart into.
   *
   * `updateState` exists because the events are one-shot: an update found on
   * the sign-in screen, or downloaded in a previous session, was announced
   * before there was a banner to hear it.
   */
  /**
   * Watch what this machine is doing, or stop.
   *
   * The shell reads what is playing and what is running, matches the running
   * list against its own games list, and drops the rest - so only a match
   * ever crosses to this page. "We check whether a game is running" is a
   * different promise from "we upload what you are running", and only the
   * first is being made.
   *
   * Told again whenever the switches change, because turning one off has to
   * mean the shell stops reading and says so once - not that it goes quiet
   * and leaves somebody shown as playing whatever they last played.
   */
  watchActivity?: (want: { game: boolean; music: boolean }) => Promise<void>
  /** What it saw: a finished line, or nothing at all. */
  onActivity?: (cb: (activity: unknown) => void) => void
  /**
   * What the update that just installed was for, once.
   *
   * The shell keeps the release's own notes across the restart and answers
   * with them on the first launch of the version they belong to, forgetting
   * them in the same breath - so there is nothing here to remember, and this
   * cannot come back tomorrow.
   *
   * It has answered since the desktop build was written. Nothing in this
   * client asked, so the notes were kept, offered and dropped every time.
   */
  whatsNew?: () => Promise<{ version: string; notes: string } | null>
  updateState: () => Promise<{
    stage: 'idle' | 'available' | 'downloading' | 'ready' | 'error'
    version: string
    percent: number
    error: string
  }>
  onUpdate: (cb: (event: string, payload: unknown) => void) => void
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => Promise<boolean>
  share: {
    onChoose: (cb: (sources: ShareSource[]) => void) => void
    choose: (id: string | null, audio?: boolean) => void
    /**
     * Whether this shell can be told not to send the sound.
     *
     * Absent in a desktop build older than the choice, which always sends it.
     * Asked before the switch is drawn, because a switch that is read by
     * nothing is worse than no switch: it reads as a preference that was
     * ignored rather than one that was never offered.
     */
    canChooseShareAudio?: boolean
  }
}

/** Something the desktop can share: a whole screen, or one window. */
export type ShareSource = {
  id: string
  name: string
  isScreen: boolean
  /** A still of it, as a data URI, or nothing where one could not be taken. */
  thumbnail: string | null
  icon: string | null
}

/** The bridge, or null in a browser — which is not an error. */
export function shell(): Shell | null {
  /*
   * Either name.
   *
   * The page is served by the server and the shell is installed, so somebody
   * can be running today's page inside a shell from a fortnight ago - one
   * that only offers the old name. Reading only the new one would take push
   * to talk, the share picker, the saved password and the update itself away
   * from everybody who had not updated yet, and the update is how they would
   * have got the shell that fixed it.
   */
  const w = globalThis as unknown as {
    atrium?: Partial<Shell>
    jackscord?: Partial<Shell>
  }
  const it = w.atrium ?? w.jackscord
  /* Asked for a method rather than for the object: an older shell that
     predates a feature still has the object, and calling something it has
     never had is the crash this exists to avoid. */
  return it && typeof it.setBadge === 'function' ? (it as Shell) : null
}

export const isDesktop = (): boolean => shell() !== null

/**
 * The badge, drawn here because the main process has no DOM to draw with.
 *
 * A red disc with the number in it, or two digits and a plus past ninety-nine
 * — a taskbar badge is about sixteen pixels across and "128" in that space is
 * a smudge that says only "some".
 */
export function badgeIcon(count: number, size = 32): string | null {
  if (count <= 0) return null
  if (typeof document === 'undefined') return null
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const g = cv.getContext('2d')
  if (!g) return null

  g.fillStyle = '#E5484D'
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  g.fill()

  const label = badgeLabel(count)
  /* Sized to the label rather than fixed: "9" and "99+" in the same size is
     either a lost digit or a very small nine. */
  g.fillStyle = '#fff'
  g.font = `700 ${Math.round(size * (label.length > 2 ? 0.44 : 0.6))}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  /* A hair below centre: text sits optically high in a circle. */
  g.fillText(label, size / 2, size / 2 + size * 0.04)

  return cv.toDataURL('image/png')
}

/**
 * What the badge reads.
 *
 * A taskbar badge is about sixteen pixels across, and "128" in that space is
 * a smudge that says only "some" — so past ninety-nine it says that instead.
 *
 * Its own function because the drawing around it cannot be tested: jsdom has
 * no canvas, so a test of badgeIcon returns before it draws anything and
 * passes for having done nothing. This is the part with a decision in it.
 */
export const badgeLabel = (count: number): string =>
  count > 99 ? '99+' : String(count)

/** What the tray says, which is the same fact in words. */
export const badgeTooltip = (count: number): string =>
  count <= 0 ? 'Atrium'
    : `Atrium — ${count} unread message${count === 1 ? '' : 's'}`
