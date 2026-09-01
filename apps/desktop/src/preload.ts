import { contextBridge, ipcRenderer } from 'electron'

/**
 * The entire bridge between the web app and the operating system.
 *
 * Everything here is an explicit, named capability. The renderer never gets
 * `require`, `ipcRenderer`, or any way to name an arbitrary channel — if it
 * did, a single XSS in the message list would become code execution on the
 * machine, which is a far worse outcome than the stolen token we already
 * fixed once.
 */
const bridge = {
  version: process.env.ATRIUM_VERSION ?? '0.1.0',
  platform: process.platform,

  minimise: () => ipcRenderer.send('win:minimise'),
  toggleMaximise: () => ipcRenderer.send('win:toggle-maximise'),
  close: () => ipcRenderer.send('win:close'),

  /**
   * Whether the page is the one drawing the window buttons.
   *
   * This shell has no titleBarOverlay, so nothing else will draw them. An
   * older shell does not have this at all, which is exactly the answer the
   * page needs from it: it still has the Windows buttons, and a page that
   * drew its own beside them would show two sets.
   *
   * Not on macOS, where hiding the title bar leaves the traffic lights and
   * the same three buttons drawn again would be four too many.
   */
  windowButtons: process.platform !== 'darwin',
  isMaximised: (): Promise<boolean> => ipcRenderer.invoke('win:is-maximised'),
  onMaximised: (cb: (maximised: boolean) => void) => {
    ipcRenderer.on('win:maximised', (_e, maximised: boolean) => cb(!!maximised))
  },

  notify: (title: string, body: string) =>
    ipcRenderer.send('app:notify', String(title).slice(0, 200), String(body).slice(0, 500)),

  flashTaskbar: () => ipcRenderer.send('app:flash'),

  /**
   * Reading and writing the clipboard, for the message box's right-click
   * menu. Present only in the desktop shell; on the web the app falls back
   * to navigator.clipboard, which needs no bridge.
   */
  clipboard: {
    read: (): Promise<string> => ipcRenderer.invoke('clip:read'),
    write: (text: string) => ipcRenderer.send('clip:write', String(text).slice(0, 100_000)),
  },

  /**
   * The unread badge on the taskbar button, and the tray tooltip.
   *
   * The picture is drawn by the app rather than here, because the main
   * process has no DOM to draw with - so this takes a PNG data URL. The main
   * process checks its shape and its length before believing a word of it: a
   * string from the page is a string from the page.
   *
   * Null clears it, which is what "you have read everything" looks like.
   */
  setBadge: (count: number, icon: string | null, tooltip: string) =>
    ipcRenderer.send(
      'app:badge',
      Math.max(0, Math.min(Number(count) || 0, 9999)),
      typeof icon === 'string' ? icon.slice(0, 64_000) : null,
      String(tooltip ?? 'Atrium').slice(0, 120),
    ),

  /**
   * Which server to load the app itself from.
   *
   * The main process needs this before there is a page to ask, so the
   * first-run screen hands it over as soon as it is known.
   */
  setServer: (url: string) => ipcRenderer.send('app:set-server', String(url).slice(0, 300)),
  clearServer: () => ipcRenderer.send('app:clear-server'),
  /* Used by the page shown when the server will not answer, to ask for the
     next attempt now rather than waiting out the backoff. */
  retry: () => ipcRenderer.send('app:retry'),

  /** Register a global push-to-talk key. Returns false if it is already taken. */
  setPushToTalk: (accelerator: string | null): Promise<boolean> =>
    ipcRenderer.invoke('ptt:register', accelerator),

  /**
   * Saved sign-in details.
   *
   * The password is encrypted by the operating system (DPAPI on Windows,
   * Keychain on macOS) through Electron's safeStorage, and the ciphertext
   * lives in the app's userData folder. That folder survives updates, which
   * is the point: reinstalling should not mean retyping.
   *
   * Never localStorage. A stored password there is readable by any script
   * that ever runs in the page.
   */
  saveLogin: (server: string, username: string, password: string): Promise<boolean> =>
    ipcRenderer.invoke('creds:save', server, username, password),
  loadLogin: (server: string): Promise<{ username: string; password: string } | null> =>
    ipcRenderer.invoke('creds:load', server),
  forgetLogin: (server: string): Promise<boolean> => ipcRenderer.invoke('creds:forget', server),
  credentialsEncrypted: (): Promise<boolean> => ipcRenderer.invoke('creds:available'),


  /** Launch on startup, tray behaviour, hardware acceleration. */
  getSystemPrefs: (): Promise<{
    launchOnStartup: boolean
    minimiseToTray: boolean
    hardwareAcceleration: boolean
  }> => ipcRenderer.invoke('sys:get'),
  setSystemPref: (key: string, value: boolean): Promise<unknown> =>
    ipcRenderer.invoke('sys:set', key, value),

  /**
   * Watch what this machine is doing, and stop watching.
   *
   * Nothing is read until this is called with something true, and the two are
   * separate because they are separate things to agree to. What comes back is
   * already the finished line - the shell does the matching, so the list of
   * what is running never crosses even this bridge.
   */
  watchActivity: (want: { game: boolean; music: boolean }): Promise<boolean> =>
    ipcRenderer.invoke('presence:watch', want),
  onActivity: (cb: (activity: unknown) => void) => {
    ipcRenderer.removeAllListeners('presence:update')
    ipcRenderer.on('presence:update', (_e, activity) => cb(activity))
  },

  /**
   * What the release you have just restarted into said it changed.
   *
   * Answers once and then forgets, so the card cannot come back on the next
   * launch. Null when this is not the first launch after an update, which is
   * almost every launch.
   */
  whatsNew: (): Promise<{ version: string; notes: string } | null> =>
    ipcRenderer.invoke('update:whatsNew'),

  /** Updates. Checking and downloading are separate, deliberate steps. */
  checkForUpdate: (): Promise<{ supported: boolean; version?: string | null; reason?: string; error?: string }> =>
    ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
  /**
   * What the updater last said, for a banner that mounted after it said it.
   *
   * The events are one-shot and the banner lives in the chat view, which does
   * not exist until somebody has signed in - so an update found on the
   * sign-in screen, or downloaded in a previous session, was announced to
   * nobody. This is how the banner catches up.
   */
  updateState: (): Promise<{
    stage: 'idle' | 'available' | 'downloading' | 'ready' | 'error'
    version: string
    percent: number
    error: string
  }> => ipcRenderer.invoke('update:state'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('update:version'),

  onUpdate: (cb: (event: string, payload: unknown) => void) => {
    for (const name of ['available', 'none', 'progress', 'ready', 'error']) {
      ipcRenderer.removeAllListeners(`update:${name}`)
      ipcRenderer.on(`update:${name}`, (_e, payload) => cb(name, payload))
    }
  },

  onPushToTalk: (cb: (down: boolean) => void) => {
    ipcRenderer.removeAllListeners('ptt:state')
    ipcRenderer.on('ptt:state', (_event, down: boolean) => cb(Boolean(down)))
  },

  /**
   * The sound of one program, for sharing a game without sharing everything
   * else the machine is playing.
   */
  appAudio: {
    available: (): Promise<{ available: boolean; reason: string | null }> =>
      ipcRenderer.invoke('appaudio:available'),
    sessions: (): Promise<Array<{ pid: number; name: string; active: boolean }>> =>
      ipcRenderer.invoke('appaudio:sessions'),
    start: (pid: number): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('appaudio:start', pid),
    stop: (): Promise<boolean> => ipcRenderer.invoke('appaudio:stop'),
    /** The pid whose sound belongs to the share that just started, if any. */
    current: (): Promise<number | null> => ipcRenderer.invoke('appaudio:current'),
    onData: (cb: (chunk: ArrayBuffer) => void) => {
      ipcRenderer.removeAllListeners('appaudio:data')
      ipcRenderer.on('appaudio:data', (_event, chunk: Uint8Array) => {
        // Copied out of the transferred view: what arrives is a window onto
        // a buffer the bridge reuses, and holding it would hand the audio
        // layer bytes that change under it.
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        cb(copy.buffer)
      })
    },
    offData: () => ipcRenderer.removeAllListeners('appaudio:data'),
  },

  /**
   * Choosing what to share.
   *
   * Drawn by the app rather than by the platform, so that what was chosen is
   * known - which is what lets the sound of a window follow the window.
   */
  share: {
    onChoose: (cb: (sources: Array<{
      id: string; name: string; isScreen: boolean
      thumbnail: string | null; icon: string | null
    }>) => void) => {
      ipcRenderer.removeAllListeners('share:choose')
      ipcRenderer.on('share:choose', (_event, sources) => cb(sources))
    },
    /**
     * What was picked, and whether its sound goes with it.
     *
     * The second argument is newer than the first. An older main process
     * ignores it and always sends the sound, which is what it did before
     * there was a choice — so the page checks `canChooseShareAudio` and does
     * not offer a switch that would do nothing.
     */
    choose: (id: string | null, audio?: boolean) =>
      ipcRenderer.send('share:chosen', id, audio !== false),
    canChooseShareAudio: true,
  },
}

/*
 * Under both names, for now.
 *
 * The page is served by the server and the shell is installed, so the two
 * are updated at different moments and often days apart: a page that had
 * only learnt the new name would find nothing in a shell that still gave the
 * old one, and everything through this bridge - push to talk, the share
 * picker, the saved password, the update itself - would quietly stop. The
 * update is the worst of those to lose, because it is how the shell would
 * have caught up.
 *
 * The old name goes once nothing is running that asks for it.
 */
/**
 * And only to a page that is actually the app.
 *
 * A preload runs for whatever is loaded in its window, so until now the
 * bridge above - the clipboard, notifications, the screen-share picker, the
 * stored address of the server - was handed to any page that got itself
 * loaded here. The main process is careful about which those are, but that
 * left one check standing between an unfamiliar page and all of this, and a
 * single check is a thing that can be got wrong once. It was: it compared
 * addresses by prefix, so a host whose name merely began with the server's
 * was allowed.
 *
 * Asked of the main process rather than worked out here, because only it
 * knows which server this copy is pointed at, and that can change while the
 * app is running.
 */
function partOfTheApp(): boolean {
  /*
   * The page shown when the server cannot be reached is one of ours and is
   * loaded from disk. Named exactly, rather than trusting file:// - the main
   * process is the only thing that can load one, but this is the layer that
   * is not supposed to depend on that being true.
   */
  if (location.protocol === 'file:' && /\/offline\.html$/.test(location.pathname)) return true

  const here = `${location.protocol}//${location.host}`
  try {
    const allowed = ipcRenderer.sendSync('app:where-allowed') as unknown
    return Array.isArray(allowed) && allowed.includes(here)
  } catch {
    /*
     * Fails open, deliberately.
     *
     * The handler is registered before any window exists, so the only way
     * this throws is a mistake of ours - and an app that will not start is a
     * worse outcome than a second layer of defence not applying. Nothing a
     * page can do reaches this: the preload runs in its own world before any
     * script on the page.
     */
    return true
  }
}

if (partOfTheApp()) {
  contextBridge.exposeInMainWorld('atrium', bridge)
  contextBridge.exposeInMainWorld('jackscord', bridge)
}
