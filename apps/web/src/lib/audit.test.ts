import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { actorOf, KNOWN_ACTIONS, saidOf, type AuditEntry } from './audit'

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a1', actor_id: 'u1', actor_name: 'Pat', action: 'role.create',
  detail: '', created_at: 1, ...over,
})

describe('what an entry says', () => {
  it('is a sentence rather than a dotted name', () => {
    expect(saidOf('channel.permissions.sync')).toBe('set a channel to follow its category')
  })

  /*
   * Anything unrecognised keeps its own name. A log that hides what it does
   * not recognise is a log you cannot trust to be complete — and the name at
   * least says where to go looking.
   */
  it('and an unknown one keeps its name rather than disappearing', () => {
    expect(saidOf('something.new')).toBe('something.new')
    expect(saidOf('')).toBe('')
  })
})

describe('who did it', () => {
  it('is their name', () => {
    expect(actorOf(entry())).toBe('Pat')
  })

  /*
   * actor_id is set to null rather than deleted along with the person, so an
   * entry survives them — which is the point of a log. Their name does not,
   * and a blank where a name should be reads as the log being broken.
   */
  it('and an entry outliving its account says so', () => {
    expect(actorOf(entry({ actor_id: null, actor_name: null })))
      .toBe('An account since removed')
  })

  it('while somebody still here with no name shown is just somebody', () => {
    expect(actorOf(entry({ actor_name: null }))).toBe('Somebody')
  })
})

describe('the actions this knows how to say', () => {
  /*
   * Read out of the server, because an action added there and not here shows
   * up as a dotted name in front of somebody — which is the failure this list
   * exists to prevent, and it is invisible until it happens.
   */
  const written = (() => {
    const dir = join(__dirname, '..', '..', '..', 'server', 'src')
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join(dir, f)),
      ...readdirSync(join(dir, 'routes')).map((f) => join(dir, 'routes', f)),
    ]
    const out = new Set<string>()
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/writeAudit\([^,]+,\s*'([a-z.]+)'/g)) out.add(m[1]!)
    }
    return out
  })()

  it('is a real list, so this is asking a real question', () => {
    expect(written.size).toBeGreaterThan(15)
  })

  it('covers every action the server writes', () => {
    const mine = new Set(KNOWN_ACTIONS)
    expect([...written].filter((a) => !mine.has(a)).sort()).toEqual([])
  })
})
