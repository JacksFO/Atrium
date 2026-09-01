import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Anything worked out from the world has to watch the world's counter.
 *
 * The world is held in a ref and mutated in place, so its identity never
 * changes. A `useMemo` listing `world` is listing something that never moves,
 * and it will hand back its first answer for the life of the session. The
 * counter the world publishes is the only thing that says it changed.
 *
 * This has now been wrong twice. The conversations memo had it and carried a
 * comment explaining why; the channels memo beside it did not, and listed
 * `space` instead - which changes only when somebody opens a different
 * server. So dragging a channel wrote the new order in, said so, and the list
 * on screen stayed as it was until you opened another server and came back.
 * Reported exactly that way. Headings were fine, because nothing memoised
 * them.
 *
 * Read from the source: what is being checked is a dependency array, which
 * exists only in the source.
 */
const NEWLINE = String.fromCharCode(10)
/*
 * Read with one kind of line ending, whatever is on disk.
 *
 * This looked for a closing paren followed by a newline, and git hands the
 * file back with CRLF - so after any checkout the search found nothing, every
 * memo came back as an empty string, and the test reported that this file
 * works nothing out from the world at all. It works five things out from it.
 */
const src = readFileSync(resolve(process.cwd(), 'src/ui/Shell.tsx'), 'utf8')
  .split(String.fromCharCode(13) + String.fromCharCode(10))
  .join(String.fromCharCode(10))

/** Each `useMemo(...)` call in Shell, as its text up to the closing paren. */
function memos(): string[] {
  const out: string[] = []
  let at = src.indexOf('useMemo(')
  while (at >= 0) {
    out.push(src.slice(at, src.indexOf(')' + NEWLINE, at) + 1))
    at = src.indexOf('useMemo(', at + 1)
  }
  return out
}

describe('a value worked out from the world', () => {
  it('is something this file actually does', () => {
    const reading = memos().filter((m) => m.includes('world'))
    expect(reading.length).toBeGreaterThan(1)
  })

  it('always lists the counter that says the world changed', () => {
    const guilty = memos()
      .filter((m) => m.includes('world'))
      .filter((m) => {
        const deps = m.slice(m.lastIndexOf('['), m.lastIndexOf(']'))
        return !deps.includes('version')
      })

    expect(guilty.map((m) => m.slice(0, 60)), 'these will hand back a stale answer for ever')
      .toEqual([])
  })
})
