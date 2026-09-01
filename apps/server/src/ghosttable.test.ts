import { describe, expect, it } from 'vitest'
import { db } from './db.js'

/**
 * The table from before there was more than one server.
 *
 * `space`, singular, held one row: the name and description of the machine
 * itself, back when the app was one server. `spaces` replaced it and the
 * row was copied across - but the old table stayed, was still written to
 * every time the first server was renamed, and was still created empty on
 * every fresh install.
 *
 * Two tables one letter apart, one live and one a ghost that still took
 * writes. That is a trap for anybody reading a query quickly, including
 * whoever writes the next one.
 */
describe('the singular space table', () => {
  it('is not created by opening a database', () => {
    const found = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'space'"
    ).get()
    expect(found, 'the ghost table is back').toBeUndefined()
  })

  it('while the real one is there and is the plural', () => {
    /* So the test above cannot pass by the schema having failed entirely. */
    const found = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spaces'"
    ).get()
    expect(found).toBeTruthy()
  })

  it('and nothing in the server still writes to it', () => {
    /* A write to a table that does not exist throws, so this would be found
       at once - but it would be found by whoever renamed their server, which
       is not where anybody should meet it. */
    expect(() => db.prepare('SELECT 1 FROM space').get()).toThrow()
  })
})
