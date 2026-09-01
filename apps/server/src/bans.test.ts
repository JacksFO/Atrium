import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  db, banFromSpace, bansOf, isBanned, isSpaceMember, joinSpace, liftBan, makeContainer,
} from './db.js'

/**
 * Being removed from a server, and not being allowed back.
 *
 * These were the same thing, and only one of them was built. Removing
 * somebody cleared their roles, cleared the permissions given to them
 * personally and dropped their socket - and then the invite link already in
 * their messages let them walk straight back in, seconds later, with nothing
 * to stop it and nothing said. The only servers where a removal meant
 * anything were the ones with no live invite, which is almost none of them.
 *
 * So the tests that matter are about the join, not about the row: a bans
 * table nothing consults is the same feature that was missing.
 */

function user(): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO users (id, username, display_name, discriminator, pass_hash, pass_salt, created_at)
     VALUES (?, ?, ?, '0001', 'x', 'y', ?)`
  ).run(id, 'u' + id.slice(0, 8), 'U' + id.slice(0, 8), Date.now())
  return id
}

function space(owner: string): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'S', owner, now)
  makeContainer(id, 'space', now)
  return id
}

describe('a ban stops the joining', () => {
  /*
   * The whole feature in one test, and the one that fails without any of it.
   *
   * Written against the state before this existed - where joinSpace simply
   * joined - it is the failure the ban was built for: the second joinSpace
   * put them straight back in.
   */
  it('so the same invite does not let them back in', () => {
    const boss = user(), them = user()
    const sp = space(boss)

    joinSpace(them, sp)
    expect(isSpaceMember(them, sp)).toBe(true)

    banFromSpace(sp, them, boss, 'kept shouting')
    // Whatever else happens, they are out of it - the ban does not do this,
    // the route does, and this is the state a join is attempted from.
    db.prepare('DELETE FROM container_members WHERE container_id = ? AND user_id = ?')
      .run(sp, them)

    joinSpace(them, sp)
    expect(isSpaceMember(them, sp)).toBe(false)
  })

  /* And lifting it is not a trapdoor that stays shut. */
  it('until it is lifted, and then it does', () => {
    const boss = user(), them = user()
    const sp = space(boss)

    banFromSpace(sp, them, boss, '')
    joinSpace(them, sp)
    expect(isSpaceMember(them, sp)).toBe(false)

    expect(liftBan(sp, them)).toBe(true)
    joinSpace(them, sp)
    expect(isSpaceMember(them, sp)).toBe(true)
  })

  /*
   * Per server, which is the whole reason it is keyed on the pair.
   *
   * Nobody running a server here has the standing to say somebody is
   * unwelcome everywhere, and an account is not a server's to end - that is
   * the same mistake removal made when it set removed_at on the account.
   */
  it('and reaches exactly the one server it was made in', () => {
    const boss = user(), them = user()
    const here = space(boss), elsewhere = space(boss)

    banFromSpace(here, them, boss, '')
    joinSpace(them, here)
    joinSpace(them, elsewhere)

    expect(isSpaceMember(them, here)).toBe(false)
    expect(isSpaceMember(them, elsewhere)).toBe(true)
  })
})

describe('the row itself', () => {
  /*
   * Banning somebody who already left is the ordinary case, not an edge one:
   * the argument ends, they go, and the decision is made afterwards. So this
   * cannot depend on them being in the server at the time.
   */
  it('can be written about somebody who is not in the server', () => {
    const boss = user(), them = user()
    const sp = space(boss)

    expect(isSpaceMember(them, sp)).toBe(false)
    banFromSpace(sp, them, boss, 'left before anybody could')
    expect(isBanned(them, sp)).toBe(true)
  })

  /* Twice, so a second ban updates the reason rather than silently doing
     nothing - which is what INSERT OR IGNORE would have done. */
  it('and banning them again replaces the reason', () => {
    const boss = user(), them = user()
    const sp = space(boss)

    banFromSpace(sp, them, boss, 'first')
    banFromSpace(sp, them, boss, 'second')
    const rows = bansOf(sp)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('second')
  })

  /* Bounded on the way in, because it is stored and handed back out. */
  it('and a reason cannot be arbitrarily long', () => {
    const boss = user(), them = user()
    const sp = space(boss)

    banFromSpace(sp, them, boss, 'x'.repeat(5000))
    expect(String(bansOf(sp)[0]?.reason ?? '')).toHaveLength(500)
  })

  /* Lifting one that is not there is not an error, but it is not a lift
     either - the route needs the difference to answer 404. */
  it('and lifting one that does not exist says so', () => {
    const boss = user(), them = user()
    expect(liftBan(space(boss), them)).toBe(false)
  })

  /*
   * The list has to name people, and has to survive them.
   *
   * created_by is set null when the account that decided it is removed, and
   * that must not lift the ban: who decided it and whether it holds are two
   * different questions, and the row answers the second one.
   */
  it('and names the person, without needing them to still exist', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    banFromSpace(sp, them, boss, 'why')

    const named = bansOf(sp)[0]
    expect(named?.id).toBe(them)
    expect(named?.username).toBeTruthy()

    db.prepare('DELETE FROM users WHERE id = ?').run(boss)
    expect(isBanned(them, sp)).toBe(true)
    expect(bansOf(sp)).toHaveLength(1)
  })

  /* And it goes when the server does, like everything else about a server. */
  it('and goes when the server does', () => {
    const boss = user(), them = user()
    const sp = space(boss)
    banFromSpace(sp, them, boss, '')

    db.prepare('DELETE FROM spaces WHERE id = ?').run(sp)
    expect(isBanned(them, sp)).toBe(false)
  })
})

/**
 * And the routes, which cannot be reached without standing a server up.
 *
 * Read from the source, like the invite-revoke tests next door. What is
 * being checked is not the wiring - typescript has that - but the handful of
 * decisions that would be silently wrong: which permission each one asks
 * for, and where the ban is written relative to the invite being spent.
 */
const admin = readFileSync(join(__dirname, 'routes', 'admin.ts'), 'utf8')
  .split('\r\n').join('\n')
const spaces = readFileSync(join(__dirname, 'routes', 'spaces.ts'), 'utf8')
  .split('\r\n').join('\n')

function route(src: string, opener: string): string {
  const from = src.indexOf(opener)
  expect(from, `${opener} exists`).toBeGreaterThan(-1)
  const to = src.indexOf('\n  app.', from + 10)
  expect(to, `${opener} is bounded`).toBeGreaterThan(from)
  return src.slice(from, to)
}

describe('the three routes', () => {
  it('each ask for ban_members, and not for something adjacent', () => {
    for (const opener of [
      "app.post('/api/admin/members/:id/ban'",
      "app.get('/api/admin/bans'",
      "app.delete('/api/admin/bans/:id'",
    ]) {
      expect(route(admin, opener)).toContain("'ban_members'")
    }
  })

  /*
   * Holding it is enough on its own.
   *
   * Needing kick_members as well to ban somebody who is in the server is how
   * a role ends up being given the weaker permission to make the stronger
   * one work - and then somebody has both when only one was meant.
   */
  it('and banning does not also demand kick_members', () => {
    expect(route(admin, "app.post('/api/admin/members/:id/ban'"))
      .not.toContain('kick_members')
  })

  /* The removal and the kick share one function, so the next thing that has
     to be cleared is cleared for both. */
  it('and the removal is the same code the kick runs', () => {
    expect(route(admin, "app.post('/api/admin/members/:id/ban'"))
      .toContain('removeFromSpace(id, target_space)')
    expect(route(admin, "app.delete('/api/admin/members/:id'"))
      .toContain('removeFromSpace(id, target_space)')
  })
})

describe('taking an invite', () => {
  const accept = route(spaces, "app.post('/api/invites/:code/accept'")

  it('refuses a banned account', () => {
    expect(accept).toContain('isBanned(user.id, spaceId)')
  })

  /*
   * Before the use is spent, not after.
   *
   * The other order burns one of the invite's uses on somebody who cannot
   * join - so a banned person holding a ten-use link could quietly empty it,
   * and whoever made it would find it dead with nobody let in.
   */
  it('and before it spends one of the invite’s uses', () => {
    const refusal = accept.indexOf('isBanned(user.id, spaceId)')
    const spend = accept.indexOf('uses_left = uses_left - 1')
    expect(refusal).toBeGreaterThan(-1)
    expect(spend).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(spend)
  })

  /* And the card is told, so it says so rather than offering a button that
     is about to fail. */
  it('and the preview says whether they are barred', () => {
    expect(route(spaces, "app.get('/api/invites/:code'"))
      .toContain('banned: spaceId ? isBanned(user.id, spaceId) : false')
  })
})
