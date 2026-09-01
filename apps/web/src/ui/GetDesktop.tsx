import { useEffect, useState } from 'react'
import { isDesktop } from '../lib/shell'
import { Icon } from './Icon'

/**
 * The offer to run this as an app instead.
 *
 * The server has answered /api/desktop all along and the client never asked,
 * so somebody in a browser had no way of learning there was an installer —
 * and the three things the app can do that a browser cannot went unmentioned
 * to exactly the people who would want them.
 *
 * Never in the desktop app itself, which would be the app offering itself.
 */

export type DesktopBuild = {
  version: string
  filename: string
  /** What actually comes down when the button is pressed. */
  bytes: number
  /** The rest, which the installer fetches itself. Null on an older server. */
  packageBytes: number | null
}

/** The installer this server has, if it has one. */
export function useDesktopBuild(): DesktopBuild | null {
  const [build, setBuild] = useState<DesktopBuild | null>(null)

  useEffect(() => {
    if (isDesktop()) return
    /*
     * And not on a phone-sized screen.
     *
     * It was shown wherever the app was not already the desktop build, so a
     * phone got a strip across the top offering a Windows installer it has
     * nowhere to put - and once the strip took its own room rather than
     * floating over things, a quarter of the screen with it.
     *
     * By width rather than by pointer type. A coarse pointer is the more
     * precise question and it is answered wrong by every desktop browser
     * pretending to be a phone, which is where this is looked at most. At
     * this width the app is in its phone layout either way, and a strip
     * that costs a quarter of the screen is wrong there whoever is holding
     * it. The offer is still in settings for anybody who wants it.
     */
    if (matchMedia('(max-width: 820px)').matches) return
    let alive = true
    void fetch('/api/desktop')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.available) setBuild(d as DesktopBuild)
      })
      .catch(() => {
        /* An older server has no such route. No offer and no error — the app
           works perfectly well without ever mentioning this. */
      })
    return () => { alive = false }
  }, [])

  return build
}

const MB = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${Math.round(bytes / 1024 / 1024)} MB`

/**
 * The sizes, kept out of the way.
 *
 * Both are worth stating — the download is a small installer that fetches the
 * rest — but they are the dullest fact about the app, so they go last rather
 * than opening the sentence.
 */
const sizes = (b: DesktopBuild) =>
  b.packageBytes ? `${MB(b.bytes)} installer, ${MB(b.packageBytes)} download` : MB(b.bytes)

export const WHY = 'Push to talk, a saved password, and share one game’s sound '
  + 'instead of your whole PC.'

const SNOOZE = 'atrium.getapp.snoozed'
const SNOOZE_MS = 7 * 24 * 60 * 60_000

/** Put away recently enough that it should stay away. */
export function snoozed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE) ?? 0)
    return Number.isFinite(at) && at > 0 && now - at < SNOOZE_MS
  } catch {
    /* No storage. Showing it is the safer wrong answer of the two. */
    return false
  }
}

export function snooze(now = Date.now()): void {
  try { localStorage.setItem(SNOOZE, String(now)) } catch { /* nothing to do */ }
}

export function GetDesktopBanner() {
  const build = useDesktopBuild()
  /*
   * Put away for a week rather than for the session or for ever.
   *
   * For the session meant it was back on every load, which is a thing you
   * dismiss over and over; for ever is a feature nobody hears about twice.
   * A week is long enough to stop being an imposition and short enough that
   * somebody who might want it is asked again.
   */
  const [hidden, setHidden] = useState(() => snoozed())

  if (!build || hidden) return null

  return (
    /*
     * One line.
     *
     * It was three - a headline, a sentence about push to talk, and the size
     * - which is a hundred pixels of advertisement, and the conversation
     * reserves room for whatever is in this strip so that a banner cannot
     * cover the header and its buttons. Three lines of it pushed the whole
     * conversation down; one barely moves it, and the sentence it dropped is
     * on the button that would tell you the same thing.
     */
    <div className="getapp">
      <Icon name="dl" size={16} />
      <b>Atrium runs better as an app</b>
      <span className="gdm">Windows · {sizes(build)}</span>
      <span className="gw" />
      <a className="gdgo" href="/download" title={WHY}>Download {build.version}</a>
      <button className="icb" title="Hide for a week" aria-label="Hide for a week"
        onClick={() => { snooze(); setHidden(true) }}>
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
