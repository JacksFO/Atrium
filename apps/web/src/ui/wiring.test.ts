import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Connections that nothing else can see are broken.
 *
 * These read the source, which is not how a test usually earns its keep — but
 * the failures they catch are ones where every library underneath is correct
 * and the app is still wrong, and twice in a row that has been the shape of
 * it: the emoji table was right and nothing passed it to the renderer, and
 * the GIF import was right and nothing called it. Both times the whole suite
 * stayed green with the wiring torn out.
 *
 * Where a connection can be asserted through what the app actually does
 * instead, it is: the shortcode test in MessageActions reads the drawn
 * message, and Composer.test presses Enter and watches what is sent. These
 * are the ones left inside a hook, where there is nothing to press and no
 * output to read.
 */

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8')

describe('a GIF from the panel', () => {
  /*
   * The send path checks every attachment against the ledger written when a
   * file was uploaded here. A provider's CDN address has no row there, so the
   * message is not sent without the picture — it is refused outright. Picking
   * a GIF said nothing and sent nothing.
   */
  it('is imported before it is attached', () => {
    const src = read('useUpload.ts')
    expect(src).toContain('importGif(server, g)')
  })

  it('and its provider address is never what goes on the message', () => {
    const src = read('useUpload.ts')
    /* `sendableUrl` is what to *fetch*, and it belongs in the preview and in
       the import request — never in the url an attachment carries. */
    const attaching = src.slice(src.indexOf('const addGif'), src.indexOf('const remove'))
    expect(attaching).not.toMatch(/url:\s*sendableUrl/)
  })
})

describe('the members pane', () => {
  /*
   * Rank decides everything there: who can be acted on, and which roles can
   * be handed out. Those rules are the server's, and they are tested on their
   * own in members.test — what this asks is that the pane consults them
   * rather than working it out again alongside, because a second opinion
   * about rank is a control offered for something about to be refused.
   */
  it('asks the rank rules rather than deciding for itself', () => {
    const src = read('ServerSettings.tsx')
    expect(src).toContain('mayActOn(')
    expect(src).toContain('grantableRoles(')
    /* And no hand-rolled comparison of positions beside them. */
    expect(src).not.toMatch(/\.position\s*[<>]/)
  })
})

