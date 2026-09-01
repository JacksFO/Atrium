import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What can be attached, said in two places that have to agree.
 *
 * The client keeps its own list so somebody is told before the upload rather
 * than after it. That only works while it is the same list. It was not: it
 * refused video and PDF, which the server accepts - so a video could arrive
 * in a channel from somewhere else and be played, and could not be attached
 * from here - and it offered avif and bmp, which the server does not take, so
 * choosing one got as far as the upload and came back refused.
 */

const client = readFileSync(resolve(process.cwd(), 'src/ui/useUpload.ts'), 'utf8')
const server = readFileSync(
  resolve(process.cwd(), '../server/src/index.ts'), 'utf8')

/**
 * The mime types in one list, in whatever order it wrote them.
 *
 * To the closing `])`, not the first `]`: the server's is a Map of pairs, so
 * the first `]` is the end of its first entry and the whole comparison came
 * down to one type against seven.
 */
function kinds(text: string, from: string): string[] {
  const at = text.indexOf(from)
  const block = text.slice(at, text.indexOf('])', at))
  return [...block.matchAll(/'([a-z]+\/[\w.+-]+)'/g)].map((m) => m[1] as string).sort()
}

describe('what may be attached', () => {
  it('is a list on both sides', () => {
    /* Or the comparison below is between two empty arrays, which agree. */
    expect(kinds(client, 'const ALLOWED = new Set(').length).toBeGreaterThan(3)
    expect(kinds(server, 'const ALLOWED_MIME = new Map').length).toBeGreaterThan(3)
  })

  it('and the two lists are the same list', () => {
    const mine = kinds(client, 'const ALLOWED = new Set(')
    const theirs = kinds(server, 'const ALLOWED_MIME = new Map')
    expect(mine, 'the client and the server disagree about what can be sent')
      .toEqual(theirs)
  })

  /* The two that were actually wrong, named so their return fails loudly
     rather than as a list comparison somebody has to read. */
  it('and includes the video kinds the server takes', () => {
    const mine = kinds(client, 'const ALLOWED = new Set(')
    expect(mine).toContain('video/mp4')
    expect(mine).toContain('video/webm')
  })

  it('and offers nothing the server will refuse', () => {
    const mine = kinds(client, 'const ALLOWED = new Set(')
    expect(mine).not.toContain('image/avif')
    expect(mine).not.toContain('image/bmp')
  })
})

/**
 * And a dropped file lands.
 *
 * Nothing accepted one: the only way in was the button beside the message
 * box. The browser's answer to a page that ignores a drop is to navigate away
 * and open the file itself, so the app vanished and was replaced by the
 * picture somebody meant to send.
 */
describe('dropping a file on the app', () => {
  const hook = readFileSync(resolve(process.cwd(), 'src/ui/useFileDrop.ts'), 'utf8')
  const shell = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')

  it('is listened for, and used', () => {
    expect(hook).toContain("window.addEventListener('drop'")
    expect(shell).toContain('useFileDrop(')
  })

  /* Without preventDefault on dragover the browser refuses the drop and opens
     the file itself, whatever the drop handler says. */
  it('and the browser is stopped from opening it instead', () => {
    const over = hook.slice(hook.indexOf('const over_'))
    expect(over.slice(0, 400)).toContain('e.preventDefault()')
  })

  /*
   * Dragging over a child fires a leave for the parent and an enter for the
   * child, in that order - so a boolean flickers off and on across every
   * border inside the app. A depth does not.
   */
  it('and does not flicker crossing the things inside it', () => {
    expect(hook).toContain('depth.current += 1')
    expect(hook).toContain('depth.current === 0')
  })

  /* A drag that is not carrying files - a message being reordered, a
     selection - is not ours to interfere with. */
  it('and leaves a drag that is not files alone', () => {
    expect(hook).toContain("includes('Files')")
  })
})
