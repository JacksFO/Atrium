import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A new server's headings cannot be confused with the ones drawn for it.
 *
 * There are two kinds of heading in a channel list and only one of them is a
 * row in a table. A category is real: renameable, movable, deletable. A
 * channel filed under no category is drawn under a heading the client works
 * out from its kind - "Text" or "Voice" - which exists nowhere and cannot be
 * touched.
 *
 * Both are deliberate. Together they were a server showing two headings
 * called "Text", one above the other, meaning different things: the category
 * it was seeded with, and whatever had been made outside a category. Making
 * a channel from the empty space in the list is enough to do it, and it is
 * what made a reorder test report a heading that had plainly moved as one
 * that had not - there was no way to tell the two apart by name.
 *
 * Read from the source of both sides rather than asserted about one, because
 * the collision is between two files that have no reason to know about each
 * other.
 */

const read = (p: string) => readFileSync(p, 'utf8').split('\r\n').join('\n')

/* The labels the client invents, from the client. */
const tree = read(resolve(process.cwd(), '../web/src/lib/tree.ts'))
/* And the names a new server is seeded with, from the server. */
const spaces = read(join(__dirname, 'routes', 'spaces.ts'))

const invented = (): string[] => {
  const at = tree.indexOf("label: kind === 'text'")
  expect(at, 'the client still invents a heading from the kind').toBeGreaterThan(-1)
  const line = tree.slice(at, tree.indexOf('\n', at))
  return [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]!).filter((s) => s !== 'text')
}

const seeded = (): string[] => {
  const at = spaces.indexOf('const defaults:')
  expect(at, 'a new server is still seeded from a defaults table').toBeGreaterThan(-1)
  /* To the line that closes the table, not to the first ] - which closes the
     first row, and gave one heading out of two. */
  const to = spaces.indexOf('\n    ]', at)
  expect(to, 'the defaults table is bounded').toBeGreaterThan(at)
  const block = spaces.slice(at, to)
  /* The first string of each row is the heading. */
  return [...block.matchAll(/\['([^']+)',/g)].map((m) => m[1]!)
}

describe('the headings a new server starts with', () => {
  /* Both halves found, before anything is concluded from them being
     different - two empty lists have no names in common either. */
  it('are read from both sides', () => {
    expect(invented().length).toBe(2)
    expect(seeded().length).toBe(2)
  })

  it('share no name with the ones the client draws for itself', () => {
    const mine = new Set(invented())
    const clash = seeded().filter((n) => mine.has(n))
    expect(clash, `seeded headings clashing with invented ones: ${clash.join(', ')}`).toEqual([])
  })
})
