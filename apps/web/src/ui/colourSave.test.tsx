import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Choosing a colour should not be a conversation with the server.
 *
 * A native colour input fires while the pointer moves, and every one of those
 * events was a save. Measured in the live log rather than guessed at: one
 * person picking one colour sent 241 writes in a minute, 106 of them inside a
 * single second. Each is a row written AND a broadcast to everybody who can
 * see the person choosing - so the cost of one person dragging a slider lands
 * on the whole server.
 *
 * The role picker was worse: changing a role tells every member that roles
 * have changed, and each of them then asks for the whole list again.
 *
 * The preview is unaffected either way, because it reads from what is on
 * screen rather than from what has been saved.
 */

const panes = {
  'MePane.tsx': readFileSync(resolve(process.cwd(), 'src/ui/MePane.tsx'), 'utf8'),
  'ServerSettings.tsx': readFileSync(resolve(process.cwd(), 'src/ui/ServerSettings.tsx'), 'utf8'),
}

describe('colour pickers', () => {
  for (const [file, src] of Object.entries(panes)) {
    it(`${file} has one`, () => {
      /* Or the assertions below are about a file that no longer has a
         picker in it, and would pass by saying nothing. */
      expect(src).toContain('type="color"')
    })

    it(`${file} does not save on every pointer move`, () => {
      const immediate = [...src.matchAll(/type="color"[\s\S]{0,240}?onChange=\{[^}]*\}/g)]
        .map((m) => m[0])
        .filter((block) => /\bsave\(/.test(block) && !/saveSoon\(/.test(block))
      expect(immediate, `saves straight from onChange in ${file}`).toEqual([])
    })

    it(`${file} waits for the dragging to stop`, () => {
      expect(src).toContain('const saveSoon =')
      expect(src).toContain('clearTimeout(later.current)')
    })

    /* Closing the panel mid-drag must not lose the colour just chosen: the
       timer is cleared, and whatever it was holding goes now. */
    it(`${file} still sends what it was holding when it unmounts`, () => {
      const cleanup = src.slice(src.indexOf('useEffect(() => () => {'))
      expect(cleanup).toContain('unsaved.current')
      expect(cleanup.slice(0, 400)).toContain('clearTimeout')
    })
  }

  /* Typed fields were already right, and must stay that way — a name saved
     per keystroke is the same fault with a different input. */
  it('and text fields still save when you leave them, not as you type', () => {
    const me = panes['MePane.tsx']
    expect(me).toContain("onBlur={() => name !== me.display_name && save({ display_name: name })}")
    expect(me).not.toMatch(/onChange=\{\(e\) => save\(\{ display_name/)
  })
})
