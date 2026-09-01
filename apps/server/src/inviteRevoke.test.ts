import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Taking back an invite is not the same act as making one.
 *
 * create_invite is held by @everyone on a new server, and it gated both - so
 * anybody who could cut a key could throw away everybody else's. The two are
 * different sizes: making one is yours to do, and revoking one somebody else
 * made is a decision about their doing.
 *
 * Read from the source because the route is declared inside a closure over
 * the app, with no way to reach it without standing a server up, and the
 * proxy this file is about is one `if`.
 */

const src = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
  .split('\r\n').join('\n')

const route = (() => {
  const from = src.indexOf("app.delete('/api/invites/:code'")
  const to = src.indexOf('\n  app.', from + 10)
  return { from, to, body: src.slice(from, to) }
})()

describe('revoking an invite', () => {
  it('is one route, bounded at both ends', () => {
    expect(route.from).toBeGreaterThan(-1)
    expect(route.to).toBeGreaterThan(route.from)
    expect(route.body.length).toBeLessThan(3000)
  })

  it('reads who made it', () => {
    expect(route.body).toContain('created_by')
    expect(route.body).toMatch(/invite\.created_by === user\.id/)
  })

  /* Yours, or you may see to the server. Both arms have to be there: one
     alone is either no rule or a rule nobody can escape. */
  it('and refuses one that is neither yours nor yours to see to', () => {
    expect(route.body).toContain("has('manage_space')")
    expect(route.body).toMatch(/if \(!mine && !permissionsFor[\s\S]{0,120}403/)
  })

  /*
   * created_by is ON DELETE SET NULL, so an invite made by somebody since
   * removed belongs to nobody. A strictly-your-own rule would leave a live
   * way into the server that no one could revoke, which is why the wider arm
   * exists - and why "nobody made it" must not read as "you made it".
   */
  it('and an invite belonging to nobody is not everybody’s', () => {
    expect(route.body).toContain('invite.created_by !== null')
  })

  /*
   * The order: permission, then existence.
   *
   * Answering "no such invite" to somebody who may not touch this server's
   * invites would let them ask, one code at a time, which codes exist.
   */
  it('and does not say whether a code exists before checking permission', () => {
    expect(route.body.indexOf('await guard(')).toBeLessThan(route.body.indexOf('404'))
  })

  it('and still writes down that it happened', () => {
    expect(route.body).toContain("'invite.revoke'")
    expect(route.body).toContain('pushInvites(')
  })
})

/**
 * And the pane draws the bin only where the server would accept it.
 *
 * A control that is always there and refuses half the time is the failure
 * this app avoids everywhere else by making it absent instead.
 */
describe('the invites pane', () => {
  const ui = readFileSync(
    join(__dirname, '..', '..', 'web', 'src', 'ui', 'ServerSettings.tsx'), 'utf8',
  ).split('\r\n').join('\n')

  it('shows a revoke button only for the ones you may revoke', () => {
    expect(ui).toContain('(i.created_by === me || mayRevokeAny) && (')
  })

  /* And says which are yours, or the missing bins read as rows that randomly
     cannot be deleted rather than as a rule. */
  it('and says which ones are yours', () => {
    expect(ui).toContain('i.created_by === me && <span className="yours">')
  })
})
