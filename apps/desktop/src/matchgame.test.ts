import { describe, it, expect } from 'vitest'
import { matchGame } from './matchgame'

/**
 * The promise the Activity page makes, tested rather than read.
 *
 * The page says: what is running is checked on this computer and never sent,
 * and only a game you have added is ever named. That is not a comment about
 * intent, it is a property of this function - it is handed everything and
 * returns one name or nothing - so it is worth pinning down here, where
 * breaking it fails a test rather than quietly telling ten people what
 * somebody has open.
 */

const list = {
  'escapefromtarkov.exe': 'Escape from Tarkov',
  'rocketleague.exe': 'Rocket League',
}

/* What a real machine looks like: the two hundred and eighty things Windows
   had running while this was written, in spirit. */
const busy = [
  'system', 'smss.exe', 'csrss.exe', 'explorer.exe', 'chrome.exe',
  'code.exe', 'steam.exe', 'discord.exe', 'nvcontainer.exe', 'obs64.exe',
  'onedrive.exe', 'spotify.exe', 'powershell.exe', 'taskmgr.exe',
]

describe('what it will name', () => {
  it('a game on the list, out of everything else running', () => {
    expect(matchGame([...busy, 'escapefromtarkov.exe'], list)).toBe('Escape from Tarkov')
  })

  it('whatever the case Windows happened to give it', () => {
    expect(matchGame(['EscapeFromTarkov.EXE'], list)).toBe('Escape from Tarkov')
  })
})

describe('what it will not name', () => {
  /*
   * The one that matters. A machine with two hundred programs open and no
   * game among them says nothing at all - not a guess, not the nearest
   * thing, and above all not the list it was given.
   */
  it('nothing at all, when nothing on the list is running', () => {
    expect(matchGame(busy, list)).toBe(null)
  })

  it('nothing on an empty machine, or an empty list', () => {
    expect(matchGame([], list)).toBe(null)
    expect(matchGame(busy, {})).toBe(null)
  })

  /*
   * A list entry with no name behind it is a broken row, not a game. Naming
   * it would put an empty status under somebody's name, which reads as the
   * app being broken rather than as nobody playing anything.
   */
  it('an entry that has no name behind it', () => {
    expect(matchGame(['ghost.exe'], { 'ghost.exe': '' })).toBe(null)
  })

  it('and it never hands back anything but the one name', () => {
    // The whole return value, so a future version that decided to be helpful
    // and include what else it saw fails here.
    const out = matchGame([...busy, 'rocketleague.exe'], list)
    expect(out).toBe('Rocket League')
    expect(typeof out).toBe('string')
  })
})
