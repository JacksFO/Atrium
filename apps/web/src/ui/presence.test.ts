import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../lib/settings'

/**
 * Rich presence, and the middle of it.
 *
 * Every other part was already built. The desktop shell reads what is playing
 * and what is running, matches the running list against its own games list
 * and hands up a finished line; the server takes an activity frame and tells
 * everybody who may see that person; the client keeps them in the world,
 * formats them and has a card to draw them on.
 *
 * Nothing joined the two ends. The React port carried neither the bridge
 * declaration nor the thirty lines that pump it, so the feature was complete
 * at both ends and connected in the middle by nothing at all - which is why
 * it read as "still isn't working" rather than as an error.
 */

const at = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const pump = at('src/ui/usePresence.ts')
const shell = at('src/lib/shell.ts')
const app = at('src/ui/Shell.tsx')

describe('the pump between the shell and the socket', () => {
  it('exists and is mounted', () => {
    /* Written and never called is the exact fault this is about. */
    expect(pump).toContain('export function usePresence')
    expect(app).toContain('usePresence(')
  })

  it('and the bridge it needs is declared', () => {
    for (const name of ['watchActivity', 'onActivity']) {
      expect(shell, `${name} missing from the Shell type`).toContain(name)
    }
  })

  it('and what it hears goes to the server', () => {
    expect(pump).toContain("t: 'activity'")
  })

  /* Turning a switch off has to mean the shell stops reading and says so
     once. Simply going quiet leaves somebody shown as playing whatever they
     last played, for ever. */
  it('and says stop rather than going quiet', () => {
    const cleanup = pump.slice(pump.indexOf('return () => {'))
    expect(cleanup).toContain('game: false, music: false')
  })

  /* The switches are the only thing that knows whether to look, so a change
     to either has to reach the shell. */
  it('and asks again when the switches change', () => {
    const deps = pump.slice(pump.lastIndexOf('}, ['))
    expect(deps).toContain('game')
    expect(deps).toContain('music')
  })

  /*
   * A cover is whatever the player felt like providing - Spotify's is a
   * 211KB PNG - and sending that to everybody who can see you on every track
   * change is most of a gigabyte an hour at a hundred people. It goes up
   * once and its name goes out instead.
   */
  it('and sends a name for the cover rather than the cover', () => {
    expect(pump).toContain('publishArt')
    expect(pump).toContain('publishPixels')
    expect(pump).not.toMatch(/activities: list\b/)
  })
})

describe('the consent for it', () => {
  /* This is the whole of the consent, so it is a thing somebody turns on -
     never a thing they have to find and turn off. */
  it('starts off, both of them', () => {
    expect(DEFAULTS.showGame).toBe(false)
    expect(DEFAULTS.showMusic).toBe(false)
  })

  it('and is two switches, not one', () => {
    const settings = at('src/ui/Settings.tsx')
    expect(settings).toContain("set('showGame'")
    expect(settings).toContain("set('showMusic'")
  })
})
