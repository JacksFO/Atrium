import { useCallback, useEffect, useState } from 'react'
import { PANELS, readOrder, type Panel } from './panelOrder'

/**
 * What somebody has chosen about how the app looks and behaves.
 *
 * Kept in this browser, because that is what they are: a preference about a
 * screen. The size of the text on a phone is not the size you want on a
 * desktop, and syncing it makes changing one change the other.
 *
 * Defaults are declared once, and reading merges over them — so a setting
 * added later has a value on a machine that has never seen it, rather than
 * being undefined and turning some part of the app off.
 */

export type Settings = {
  /**
   * Whether to tell people what you are playing, and what you are listening
   * to.
   *
   * Two switches rather than one, because they are different things to agree
   * to: what you are playing is a room you are in, and what you are listening
   * to is closer to what you are thinking about.
   *
   * Only the desktop app can answer either question, so a browser leaves both
   * alone and reports nothing whatever they say.
   */
  showGame: boolean
  showMusic: boolean
  /**
   * Which speaker or headset a call comes out of.
   *
   * Empty means whatever the machine is using, which is the right default and
   * the only thing a browser can promise: setSinkId is not everywhere, and
   * where it is missing this is remembered and quietly not applied rather
   * than offered as a choice that does nothing.
   */
  speaker: string
  theme: string
  /** 20, not 14. The old default was chosen against a 1440p screen and read
   *  as small everywhere else; this is the size somebody would have dragged
   *  the slider to anyway, and everything is sized in em against it. */
  fontSize: number
  density: 'cosy' | 'compact' | 'tight'
  /** Whether the generated wallpaper is drawn behind a conversation. */
  wallpaper: boolean
  /** Line height in a conversation, as a percentage. */
  lineHeight: number
  jumbo: boolean
  shortcodes: boolean
  previews: boolean
  /** Somebody who has asked for less motion gets less of it. */
  reduceMotion: boolean
  /** The widths they have dragged the panels to. */
  railTile: number
  sideWidth: number
  membersWidth: number
  /**
   * The order the columns sit in, left to right.
   *
   * Read through readOrder rather than used as stored, so an arrangement
   * written by a different version still means something - see panelOrder.ts.
   */
  panelOrder: Panel[]

  /**
   * Whether the channel list is folded away to the left.
   *
   * Kept with the settings rather than in the page, so it survives a reload:
   * somebody who folded it away wants it away, not away until they refresh.
   */
  sideShut: boolean

  /* ---- being told about things ---- */

  /** Whether the browser is asked to show one. Off until somebody says so:
   *  a permission prompt nobody asked for is refused on reflex. */
  notifications: boolean
  /**
   * The key held to talk, as Electron names one — or empty for none.
   *
   * Registered with the operating system rather than listened for on the
   * page, because it has to work while the app is behind a game. In a browser
   * there is no way to hear a key the window did not receive, so the setting
   * is simply not offered there rather than offered and quietly untrue.
   */
  pushToTalk: string
  /** The unread count in the tab, which is the only one some people want. */
  tabCount: boolean

  /* ---- what a call sounds like ---- */

  /**
   * Whether the app makes any sound at all.
   *
   * One switch for the lot. Every tone the app has — arriving, leaving,
   * sharing, a call ringing, a message landing — was written and shipped and
   * played by nothing, so there has never been anything to turn off.
   */
  sounds: boolean
  /** Which microphone, or empty for whichever the machine offers. */
  mic: string
  /** All three on by default: a call between two people in one room feeds
   *  back without echo cancellation, and that is the common case. */
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
  /**
   * Whether the app works out where "talking" starts, or you say.
   *
   * The activation threshold is the one voice setting nobody can set
   * correctly without help: a number in units nobody has, measured against a
   * microphone whose gain nobody knows, in a room nobody has measured. So the
   * honest way to pick it by hand is to talk, watch a bar and guess - which
   * is why the app does it by default and this is here for people who would
   * rather say.
   */
  gateAuto: boolean
  /** The line, when it is yours to set. Ignored while gateAuto is on. */
  gate: number
  /** How loud voices are, 0–100. A shared screen has its own, on its tile —
   *  one slider for the lot means turning down a game turns down the person
   *  telling you about it. */
  volume: number
}

export const DEFAULTS: Settings = {
  /* Both off. This is the whole of the consent for telling other people what
     you are doing, so it is a thing somebody turns on, never a thing they
     have to find and turn off. */
  showGame: false,
  showMusic: false,
  speaker: '',
  theme: 'atrium',
  fontSize: 20,
  density: 'cosy',
  wallpaper: true,
  lineHeight: 155,
  jumbo: true,
  shortcodes: true,
  previews: true,
  reduceMotion: false,
  railTile: 66,
  sideWidth: 278,
  membersWidth: 254,
  panelOrder: [...PANELS],
  sideShut: false,
  notifications: false,
  pushToTalk: '',
  tabCount: true,
  mic: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  gateAuto: true,
  gate: 8,
  sounds: true,
  volume: 100,
}

const KEY = 'atrium.settings'

export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    /* Merged over the defaults rather than trusted whole: a value written by
       an older version is missing whatever has been added since, and an
       undefined setting is a feature quietly switched off. */
    const stored = JSON.parse(raw) as Partial<Settings>
    /*
     * Every setting merged, and one of them made sense of.
     *
     * A spread takes a stored array whole, so an arrangement from a version
     * with a different set of columns would arrive with a column missing or
     * one nobody can draw. readOrder is what turns whatever is there into a
     * list of every panel exactly once.
     */
    return { ...DEFAULTS, ...stored, panelOrder: readOrder(stored.panelOrder) }
  } catch {
    return DEFAULTS
  }
}

function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* Settings that last until the tab closes are worse than settings that
       last, and much better than the app refusing to start. */
  }
}

/**
 * A width somebody chose, read back against the build that is now running.
 *
 * An update keeps everything they arranged — it lives in this browser and a
 * reload does not touch it, which is the point — but the number was written
 * by whichever build was running when they dragged it, and the limits belong
 * to the build reading it. Narrow a panel's maximum in a later version and
 * the old number sails past it.
 *
 * Nothing is written back: their number stays as they left it, so a future
 * build that widens the range gets it at full size again.
 */
export function fitWidth(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value)
  const want = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.max(min, Math.min(max, want))
}

export function useSettings() {
  const [settings, setAll] = useState<Settings>(readSettings)

  useEffect(() => { writeSettings(settings) }, [settings])

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setAll((s) => (s[key] === value ? s : { ...s, [key]: value }))
  }, [])

  const reset = useCallback(() => setAll(DEFAULTS), [])

  return { settings, set, reset }
}
