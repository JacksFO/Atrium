import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One name per thing, and no name that means something else already.
 *
 * Two habits caused every naming problem found here. A name taken by
 * something with a weaker claim to it - `Server` for the HTTP client, so the
 * thing people call a server had to be called something else. And several
 * names for one idea - a conversation was a DmChannel, a DirectChannel and a
 * Conversation, and only the last said what it was.
 *
 * These are cheap to check and expensive to notice by reading.
 */
/*
 * A word boundary, built rather than written.
 *
 * Written as an escape it arrived here as a single backslash, which in a
 * JavaScript string is a backspace character - so the pattern was "export
 * type Node" followed by an invisible control character, and it matched
 * nothing. The rule passed with the shadow sitting right there in the file,
 * which is the only kind of green worth being suspicious of.
 */
const WORD_END = String.fromCharCode(92) + 'b'

const SRC = resolve(process.cwd(), 'src')

function sources(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) out.push(p)
  }
  return out
}
const all = sources().map((p) => ({ p, text: readFileSync(p, 'utf8') }))
/*
 * Code only. A comment explaining why a name was dropped contains that name,
 * and a scanner that reads its own explanation reports the very thing it is
 * describing - which this did, on its first run.
 */
const stripped = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

const everything = all.map((f) => stripped(f.text)).join(String.fromCharCode(10))

describe('the names this client uses', () => {
  it('do not shadow a browser global', () => {
    /* `Node`, `Event`, `Element` and friends exist already. A local type of
       that name compiles, and then somebody means the other one. */
    const shadows = ['Node', 'Element', 'Event', 'Range', 'Text', 'Image', 'Selection']
      .filter((n) => new RegExp('export type ' + n + WORD_END).test(everything))
    expect(shadows, 'these type names are already browser globals').toEqual([])
  })

  it('do not give one idea two words', () => {
    /* DmChannel was neither a channel row nor the thing on screen; it was a
       third shape wearing a name that could have meant either. */
    expect(everything).not.toMatch(/\bDmChannel\b/)
  })

  it('and do not call the connection a server', () => {
    /* It holds a token and an address. Calling it Server is what left the
       thing people do call a server needing another word. */
    expect(everything).not.toMatch(/\bclass Server\b/)
    expect(everything).toMatch(/\bclass Api\b/)
  })

  it('while the names that genuinely mean "from the server" keep it', () => {
    /* So the rule above cannot be satisfied by renaming everything blindly. */
    expect(everything).toMatch(/\bServerEvent\b/)
    expect(everything).toMatch(/\bServerChannel\b/)
  })
})
