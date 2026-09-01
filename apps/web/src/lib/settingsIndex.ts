import type { PaneId } from '../ui/Settings'
import { isDesktop } from './shell'

/**
 * Every setting, by the name it is called and the names people call it.
 *
 * A settings screen is a filing cabinet: you know the app can do the thing
 * and you do not know which drawer somebody filed it in. Nine panes is small
 * enough to hunt through and large enough to be annoying, and hunting is the
 * whole of what a search box replaces.
 *
 * The words are the point. Somebody looking for push to talk types "ptt", and
 * somebody looking for the microphone types "mic" - neither of which appears
 * in any label. Searching only the labels finds what somebody already knew
 * the name of, which is the case that did not need help.
 *
 * Kept beside the panes rather than derived from them: the panes render one
 * at a time, so there is no moment when the app can see all of its own
 * settings. `settingsIndex.test.ts` checks every entry names a real pane, and
 * that nothing here has drifted from a title the screen no longer draws.
 */
export type Indexed = {
  /** As the row is titled, so a result reads like the thing it opens. */
  title: string
  pane: PaneId
  /** What that pane is called, for the line under the result. */
  where: string
  /** Other ways of asking for it. Lowercase; matched as substrings. */
  words?: readonly string[]
  /*
   * Only in the desktop app.
   *
   * A row the browser does not draw must not be findable in the browser
   * either, or search is the one place a setting appears which is absent
   * everywhere else - which is the same "it exists but is broken" reading
   * that hiding it was meant to avoid.
   */
  desktop?: true
}

export const SETTINGS_INDEX: readonly Indexed[] = [
  // ---- Appearance --------------------------------------------------------
  { title: 'Arrange the columns', pane: 'appearance', where: 'Appearance',
    words: ['layout', 'panels', 'move', 'order', 'rearrange'] },
  { title: 'Text size', pane: 'appearance', where: 'Appearance',
    words: ['font', 'bigger', 'smaller', 'zoom', 'scale'] },
  { title: 'Density', pane: 'appearance', where: 'Appearance',
    words: ['compact', 'cosy', 'tight', 'spacing'] },
  { title: 'Wallpaper', pane: 'appearance', where: 'Appearance',
    words: ['background', 'art', 'picture'] },
  { title: 'Line spacing', pane: 'appearance', where: 'Appearance',
    words: ['leading', 'height', 'gap'] },
  { title: 'Theme', pane: 'appearance', where: 'Appearance',
    words: ['dark', 'light', 'colour', 'color', 'contrast'] },

  // ---- Chat --------------------------------------------------------------
  { title: 'Big emoji', pane: 'chat', where: 'Chat',
    words: ['jumbo', 'large', 'emoji'] },
  { title: 'Shortcodes', pane: 'chat', where: 'Chat',
    words: ['emoji', 'colon', 'smiley', ':fire:'] },
  { title: 'Link previews', pane: 'chat', where: 'Chat',
    words: ['embeds', 'unfurl', 'cards', 'thumbnails'] },
  { title: 'Show the game you are playing', pane: 'chat', where: 'Chat',
    words: ['status', 'presence', 'rich presence', 'activity', 'playing'] },
  { title: 'Show what you are listening to', pane: 'chat', where: 'Chat',
    words: ['spotify', 'music', 'presence', 'now playing'] },

  // ---- Voice & video -----------------------------------------------------
  /* In the Notifications pane, where the row actually is. The index said
     Voice & video, so searching "ptt" opened a pane the row is not on - and
     the index test only checks that a title is drawn somewhere, not that it
     is drawn where it says it is. */
  { title: 'Hold a key to talk', pane: 'notifications', where: 'Notifications',
    words: ['push to talk', 'ptt', 'hotkey', 'walkie'] },
  { title: 'Input sensitivity', pane: 'voice', where: 'Voice & video',
    words: ['voice activation', 'vad', 'gate', 'threshold', 'automatic'] },
  { title: 'Activation threshold', pane: 'voice', where: 'Voice & video',
    words: ['sensitivity', 'gate', 'level', 'vad'] },
  { title: 'Microphone', pane: 'voice', where: 'Voice & video',
    words: ['mic', 'input', 'device', 'capture'] },
  { title: 'Output', pane: 'voice', where: 'Voice & video',
    words: ['speaker', 'headphones', 'headset', 'device'] },
  { title: 'Echo cancellation', pane: 'voice', where: 'Voice & video',
    words: ['echo', 'feedback', 'aec'] },
  { title: 'Noise suppression', pane: 'voice', where: 'Voice & video',
    words: ['noise', 'background', 'fan', 'keyboard'] },
  { title: 'Automatic gain', pane: 'voice', where: 'Voice & video',
    words: ['agc', 'volume', 'loudness', 'normalise'] },
  { title: 'How loud everybody is', pane: 'voice', where: 'Voice & video',
    words: ['volume', 'output level', 'loud'] },

  // ---- Notifications -----------------------------------------------------
  { title: 'Tell me about messages', pane: 'notifications', where: 'Notifications',
    words: ['notifications', 'alerts', 'desktop', 'toast', 'popup'] },
  { title: 'Sounds', pane: 'notifications', where: 'Notifications',
    words: ['sound', 'ping', 'chime', 'audio', 'mute'] },
  { title: 'Unread count in the tab', pane: 'notifications', where: 'Notifications',
    words: ['badge', 'title', 'favicon', 'count'] },

  // ---- Accessibility -----------------------------------------------------
  { title: 'Less motion', pane: 'accessibility', where: 'Accessibility',
    words: ['reduce motion', 'animation', 'still', 'motion sickness'] },

  // ---- You ---------------------------------------------------------------
  { title: 'Account', pane: 'account', where: 'My account',
    words: ['username', 'handle', 'profile', 'me'] },
  { title: 'Sign out', pane: 'account', where: 'My account',
    words: ['log out', 'logout', 'leave', 'exit'] },
  { title: 'Password', pane: 'account', where: 'My account',
    words: ['change password', 'security'] },

  // ---- This build --------------------------------------------------------
  { title: 'What’s new', pane: 'whatsnew', where: 'This build',
    words: ['changelog', 'releases', 'updates', 'version'] },
  { title: 'About', pane: 'about', where: 'This build',
    words: ['version', 'build', 'licence', 'storage'] },
  { title: 'Open Atrium when I log in', pane: 'about', where: 'This build',
    desktop: true,
    words: ['startup', 'start up', 'auto start', 'autostart', 'boot', 'login',
      'log in', 'launch', 'on startup', 'start with windows', 'sign in'] },
]

/**
 * What matches, best first.
 *
 * A title that starts with what was typed comes before one that merely
 * contains it, and both come before something found only by one of its other
 * words - so typing "mic" offers Microphone before Automatic gain, which
 * contains "mic" in the middle of a word nobody was thinking of.
 */
export function findSettings(query: string, onDesktop = isDesktop()): Indexed[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<{ entry: Indexed; score: number }> = []
  for (const entry of SETTINGS_INDEX) {
    if (entry.desktop && !onDesktop) continue
    const title = entry.title.toLowerCase()
    let score = -1
    if (title.startsWith(q)) score = 0
    else if (title.includes(q)) score = 1
    else if ((entry.words ?? []).some((w) => w.startsWith(q))) score = 2
    else if ((entry.words ?? []).some((w) => w.includes(q))) score = 3
    if (score >= 0) scored.push({ entry, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title))
    .map((s) => s.entry)
}
