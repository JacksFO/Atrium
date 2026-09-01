import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every picture chosen for a profile goes up at the size it is drawn at.
 *
 * There are four places one can be chosen - your picture, your banner, a
 * server's icon, a server's banner - and for months all four sent the file
 * exactly as it came off the disk, while AVATAR_EDGE and BANNER_EDGE sat in
 * shrinkimage being asserted by tests that nothing acted on. Six people's
 * pictures weighed 6.1MB between them on the live server, one banner alone
 * 4.7MB, and every one of them is fetched by anybody who opens the app.
 *
 * One of the four has a browser test on it, which weighs what is actually
 * stored and is the real check. The other three have none: reaching a
 * server's settings and picking an icon is a long way to drive a harness for
 * something whose whole content is which two constants were passed.
 *
 * So this reads the call sites. It is a weaker test than weighing the bytes
 * and it catches the thing that actually went wrong here, which was not a
 * subtle failure of the resizer - it was four callers that never asked it for
 * anything.
 */

const read = (...where: string[]) =>
  readFileSync(join(__dirname, ...where), 'utf8').split('\r\n').join('\n')

const me = read('MePane.tsx')
const server = read('ServerSettings.tsx')

/** The upload calls, which are the raw ones: bytes and a content type. */
const uploads = (src: string): string[] => {
  const out: string[] = []
  /* The call may carry a type argument - server.raw<{ user }>(...) - so the
     bracket after the name is not always a round one. Matching only the round
     one found none of MePane's, and the checks below then ran over an empty
     list and passed; the count above is what caught that. */
  const re = /server\.raw[<(]/g
  for (const m of src.matchAll(re)) {
    /* From the call back to the statement it belongs to, which is where the
       shrink would have to be to have happened at all. */
    const from = Math.max(0, m.index! - 600)
    out.push(src.slice(from, m.index! + 260))
  }
  return out
}

describe('the four places a profile picture is chosen', () => {
  /* The precondition: if these stop being raw uploads this test is reading
     the wrong thing and would pass by finding nothing to check. */
  it('are all still uploaded as bytes rather than a form', () => {
    expect(uploads(me).length, 'your picture and your banner').toBe(1)
    expect(uploads(server).length, "a server's icon and its banner").toBe(2)
  })

  it('and every one of them shrinks first', () => {
    for (const call of [...uploads(me), ...uploads(server)]) {
      expect(call, 'an upload with no shrink in front of it').toContain('shrinkForUpload')
    }
  })

  /*
   * At the profile sizes, not the sizes a photograph shared in a conversation
   * gets. SMALL_ENOUGH is two hundred kilobytes, which is nothing for
   * something somebody might open full screen and a great deal for a circle
   * drawn at forty pixels.
   */
  it('at the size a profile picture is drawn, not a shared photograph', () => {
    for (const call of [...uploads(me), ...uploads(server)]) {
      expect(call).toContain('PROFILE_SMALL_ENOUGH')
      expect(call).toMatch(/AVATAR_EDGE|BANNER_EDGE/)
    }
  })

  /* And the shrunk one is what goes, rather than being computed and dropped -
     which would leave every test above passing and every picture full size. */
  it('and it is the smaller one that is sent', () => {
    expect(me).toMatch(/raw<[^>]*>\(\s*'POST',[^)]*sending, sending\.type/s)
    for (const call of uploads(server)) {
      expect(call).toMatch(/small, small\.type/)
    }
  })
})
