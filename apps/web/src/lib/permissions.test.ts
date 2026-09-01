import { describe, expect, it } from 'vitest'
import { CHANNEL_PERMISSIONS, CONVERSATION_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, VOICE_PERMISSIONS, may, outranks, permissionMeta, rankValue, type PermissionId } from './permissions'

describe('the list of what exists', () => {
  /* A gated feature is absent rather than disabled, so a permission that
     nothing offers reads as a feature nobody built — which is how the same
     thing got reported twice as missing. */
  it('names every permission exactly once', () => {
    const ids = PERMISSIONS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every one of them in a group, and invents none', () => {
    const grouped = PERMISSION_GROUPS.flatMap(([, ids]) => ids)
    const known = new Set(PERMISSIONS.map((p) => p.id))
    expect(new Set(grouped).size).toBe(grouped.length)
    for (const id of grouped) expect(known.has(id)).toBe(true)
    for (const p of PERMISSIONS) expect(grouped).toContain(p.id)
  })

  it('gives each one words somebody can act on', () => {
    for (const p of PERMISSIONS) {
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.detail.length).toBeGreaterThan(0)
    }
  })

  it('says which one it is even for a name it does not know', () => {
    expect(permissionMeta('invented_later').label).toBe('invented_later')
  })
})

describe('what a channel can have an opinion about', () => {
  /* Renaming the server happens to a server, not in a room — a row for it
     per channel would be a switch that does nothing. */
  it('leaves out the ones that are not about a room', () => {
    for (const id of ['manage_space', 'kick_members', 'create_invite'] as PermissionId[]) {
      expect(CHANNEL_PERMISSIONS).not.toContain(id)
    }
  })

  it('and a voice room has fewer again', () => {
    expect(VOICE_PERMISSIONS.length).toBeLessThan(CHANNEL_PERMISSIONS.length)
    for (const id of VOICE_PERMISSIONS) expect(CHANNEL_PERMISSIONS).toContain(id)
  })

  it('with everything it offers being a permission that exists', () => {
    const known = new Set(PERMISSIONS.map((p) => p.id))
    for (const id of CHANNEL_PERMISSIONS) expect(known.has(id)).toBe(true)
  })
})

describe('may they', () => {
  it('reads the list the server sent, and nothing else', () => {
    expect(may(['send_messages'], 'send_messages')).toBe(true)
    expect(may(['send_messages'], 'manage_roles')).toBe(false)
  })

  it('and says no when there is no list at all', () => {
    expect(may(undefined, 'send_messages')).toBe(false)
    expect(may([], 'send_messages')).toBe(false)
  })
})

describe('who outranks whom', () => {
  it('puts the owner above everything', () => {
    expect(outranks('owner', 99)).toBe(true)
    expect(outranks(99, 'owner')).toBe(false)
  })

  it('puts holding no role below every role there is', () => {
    expect(outranks(0, undefined)).toBe(true)
    expect(rankValue(undefined)).toBe(-1)
  })

  it('and nobody outranks themselves', () => {
    expect(outranks(5, 5)).toBe(false)
    expect(outranks('owner', 'owner')).toBe(false)
  })
})

describe('the vocabulary and the server’s', () => {
  /*
   * Written out by hand, and it drifted. Four permissions the server had
   * always enforced were missing here — mentioning everyone, managing
   * nicknames, moving people in voice, and the audit log — so the roles panel
   * could neither show nor grant any of them, and each would have been
   * reported as something nobody had built. A fifth was here and not there:
   * a switch that turned on nothing, because the server drops a permission
   * name it does not recognise.
   *
   * Read out of the server's own source rather than duplicated into a fixture,
   * because a fixture is a third copy to keep in step with the other two.
   */
  const SERVER = (() => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'src', 'permissions.ts'), 'utf8')
    const block = src.slice(
      src.indexOf('export const PERMISSIONS'),
      src.indexOf('] as const'),
    )
    return new Set(
      [...block.matchAll(/^ {2}'([a-z_]+)',/gm)].map((m) => m[1] as string),
    )
  })()

  it('is not empty, so this is asking a real question', () => {
    expect(SERVER.size).toBeGreaterThan(10)
  })

  it('names every permission the server enforces', () => {
    const mine = new Set(PERMISSIONS.map((p) => p.id as string))
    expect([...SERVER].filter((p) => !mine.has(p))).toEqual([])
  })

  it('and names nothing the server would drop', () => {
    const mine = PERMISSIONS.map((p) => p.id as string)
    expect(mine.filter((p) => !SERVER.has(p))).toEqual([])
  })

  /*
   * And the two shorter lists, which had no check at all.
   *
   * The master list above was checked and the per-channel ones were not, so
   * the pane could offer a switch the server drops on write, or fail to offer
   * one the server reads. The second is the quieter fault: a voice room's
   * "who may talk" is decided by send_messages read in that room, and neither
   * list carried it - so the server enforced a rule the app gave nobody a way
   * to set.
   */
  const listIn = (name: string) => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'src', 'permissions.ts'), 'utf8')
    const from = src.indexOf(`export const ${name}`)
    expect(from, `${name} is in the server's source`).toBeGreaterThan(-1)
    /* From the opening bracket of the array, not from the name: the type
       annotation is `Permission[]`, so the first ] after the name closes
       that and the slice comes back empty. This file has made that mistake
       once already, in this very function. */
    const open = src.indexOf('= [', from)
    const to = src.indexOf('\n]', open)
    expect(open).toBeGreaterThan(from)
    expect(to).toBeGreaterThan(open)
    const ids = [...src.slice(open, to).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
    expect(ids.length, `${name} has entries`).toBeGreaterThan(2)
    return ids
  }

  it('and offers exactly what a channel may have an opinion about', () => {
    expect([...CHANNEL_PERMISSIONS].sort())
      .toEqual([...listIn('CHANNEL_PERMISSIONS')].sort())
  })

  it('and exactly what a voice room may', () => {
    expect([...VOICE_PERMISSIONS].sort())
      .toEqual([...listIn('VOICE_CHANNEL_PERMISSIONS')].sort())
  })

  /* A permission with no group is one the roles panel never draws, which is
     the same thing as not having it at all. */
  it('and every one of them is in a group somebody can find', () => {
    const grouped = new Set(PERMISSION_GROUPS.flatMap(([, ids]) => ids as string[]))
    expect(PERMISSIONS.map((p) => p.id).filter((id) => !grouped.has(id))).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

describe('the two smaller lists and the server’s', () => {
  /* Read out of the server the same way, because a channel that offers a
     switch the server will not accept is offering a refusal — and one that
     leaves out a rule the server honours hides a way to configure it. */
  const listNamed = (name: string): Set<string> => {
    const src = readFileSync(
      join(__dirname, '..', '..', '..', 'server', 'src', 'permissions.ts'), 'utf8')
    const from = src.indexOf(`export const ${name}`)
    const block = src.slice(from, src.indexOf(']', src.indexOf('= [', from)))
    return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string))
  }

  it('agree about what a channel can have an opinion on', () => {
    const theirs = listNamed('CHANNEL_PERMISSIONS')
    expect(theirs.size).toBeGreaterThan(5)
    expect([...theirs].sort()).toEqual([...CHANNEL_PERMISSIONS].sort())
  })

  it('and about a voice room, where most of them describe nothing', () => {
    const theirs = listNamed('VOICE_CHANNEL_PERMISSIONS')
    expect(theirs.size).toBeGreaterThan(2)
    expect([...theirs].sort()).toEqual([...VOICE_PERMISSIONS].sort())
  })
})

/**
 * The client's vocabulary is the server's vocabulary.
 *
 * Set equality against the running server, in both directions. A permission
 * the client offers and the server has never heard of is a switch that can be
 * turned on, saved into a role and then ignored by everything that checks
 * anything — which is worse than a missing one, because it looks granted. One
 * the server enforces and the client never shows cannot be granted at all.
 */
describe('every permission the client knows', () => {
  /* apps/server is the one that runs. lab/ is the prototype it grew out of
     and answers nothing, so pinning to that would pin to a fiction. */
  const src = readFileSync(resolve(process.cwd(), '../server/src/permissions.ts'), 'utf8')
  const at = src.indexOf('export const PERMISSIONS = [')
  const server = [...src.slice(at, src.indexOf(']', at))
    .matchAll(/^\s*'([a-z_]+)',?\s*$/gm)].map((m) => m[1] as string)

  it('reads the server list at all', () => {
    /* Or every comparison below passes against nothing. */
    expect(server.length).toBeGreaterThan(10)
    expect(server).toContain('view_channels')
  })

  it('is exactly the set the server has', () => {
    expect([...PERMISSIONS.map((p) => p.id)].sort()).toEqual([...server].sort())
  })

  /* Every one of them reachable, or it is a permission nobody can grant. */
  it('and every one of them is somewhere a person can find it', () => {
    const shown = new Set(PERMISSION_GROUPS.flatMap(([, ids]) => ids))
    for (const p of PERMISSIONS) expect(shown, `${p.id} is in no group`).toContain(p.id)
  })

  /* Not covered above, and the one the client writes out for itself — a
     conversation has no roles, so if these two lists disagree nothing on
     either side ever says so. */
  it('and in a conversation exactly what being in one allows', () => {
    const from = src.indexOf('export const CONVERSATION_PERMISSIONS')
    const theirs = [...src.slice(from, src.indexOf(']', src.indexOf('= [', from)))
      .matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
    expect(theirs.length).toBeGreaterThan(3)
    expect([...theirs].sort()).toEqual([...CONVERSATION_PERMISSIONS].sort())
  })

  /* A voice room decides fewer things, but never a different set. */
  it('and a voice room decides only things a channel can decide', () => {
    for (const p of VOICE_PERMISSIONS) expect(CHANNEL_PERMISSIONS).toContain(p)
  })
})
